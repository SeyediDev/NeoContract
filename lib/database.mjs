import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const TITAN_TENANT_ID = '00000000-0000-0000-0000-000000000002';
const databaseDir = fileURLToPath(new URL('../database/', import.meta.url));
const migrationDir = resolve(databaseDir, 'migrations');
const checksum = value => createHash('sha256').update(value).digest('hex');

/** Open durable embedded PostgreSQL, or a standard PostgreSQL pool when connectionString is supplied. */
export async function createDatabase({ dataDir = resolve('.data/postgres'), connectionString, seed = true, migrate = true } = {}) {
  let db;
  if (connectionString) {
    const pool = new pg.Pool({ connectionString, max: 8, options: '-c search_path=contracts,public' });
    db = {
      backend: 'postgresql', dataDir: null,
      query: (sql, params = []) => pool.query(sql, params),
      exec: sql => pool.query(sql),
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({ query: (sql, params = []) => client.query(sql, params), exec: sql => client.query(sql) });
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    const directory = dataDir === 'memory://' ? dataDir : resolve(dataDir);
    if (directory !== 'memory://') await mkdir(dirname(directory), { recursive: true });
    const engine = await PGlite.create(directory);
    db = {
      backend: 'pglite-postgresql', dataDir: directory,
      query: (sql, params = []) => engine.query(sql, params),
      exec: sql => engine.exec(sql),
      transaction: work => engine.transaction(work),
      close: () => engine.close(),
    };
  }
  try {
    await db.exec('SET search_path TO contracts, public');
    if (migrate) await migrateDatabase(db);
    if (seed) await seedDatabase(db);
    db.seed = () => seedDatabase(db);
    db.health = tenantId => databaseHealth(db, tenantId);
    return db;
  } catch (error) { await db.close(); throw error; }
}

/** Apply each checked migration once, atomically with its ledger row; reject modified migration history. */
export async function migrateDatabase(db) {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS contracts;
    CREATE TABLE IF NOT EXISTS contracts.schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`);
  const names = (await readdir(migrationDir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of names) {
    const version = Number(name.split('_')[0]);
    const sql = await readFile(resolve(migrationDir, name), 'utf8');
    const hash = checksum(sql);
    await db.transaction(async tx => {
      // The table lock serializes migration/seed writers on an external PostgreSQL server as well.
      await tx.exec('LOCK TABLE contracts.schema_migrations IN EXCLUSIVE MODE');
      const existing = (await tx.query('SELECT checksum FROM contracts.schema_migrations WHERE version=$1', [version])).rows[0];
      if (existing) {
        if (existing.checksum !== hash) throw new Error(`Migration ${name} differs from the applied version; use a new migration.`);
        return;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO contracts.schema_migrations(version,name,checksum) VALUES($1,$2,$3)', [version, name, hash]);
    });
  }
}

/** Deterministic, idempotent seed; existing operator values and published template versions are preserved. */
export async function seedDatabase(db) {
  const core = await readFile(resolve(databaseDir, 'seed.sql'), 'utf8');
  const catalog = await readFile(resolve(databaseDir, 'fanasa-catalog.sql'), 'utf8');
  await db.transaction(async tx => {
    await tx.exec('LOCK TABLE contracts.schema_migrations IN EXCLUSIVE MODE');
    await tx.exec(core);
    await tx.exec(catalog);
    await seedTitanBase(tx, core, catalog);
    await seedIdentityBase(tx);
  });
  const { provisionTitanBoard } = await import('./titan-board.mjs');
  await provisionTitanBoard(db);
  const { provisionTitanRevisions } = await import('./titan-revisions.mjs');
  await provisionTitanRevisions(db);
  const { provisionTitanPricing } = await import('./titan-pricing.mjs');
  await provisionTitanPricing(db);
  return databaseHealth(db);
}

// Derive independent IDs from the checked-in seed, never from another tenant's live data.
function titanSeedId(id) {
  if (id === DEMO_TENANT_ID) return TITAN_TENANT_ID;
  const h = checksum(`titan-seed:${id}`);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function seedTitanBase(tx, core, catalog) {
  await tx.query("INSERT INTO contracts.tenants(id,slug,name,settings) VALUES($1,'titan','تایتان',$2) ON CONFLICT(id) DO NOTHING",[TITAN_TENANT_ID,JSON.stringify({calendar:'jalali',currency:'IRR',source:'user-request'})]);
  const remap = sql => sql.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,titanSeedId);
  const templates = core.slice(core.indexOf('INSERT INTO contract_templates'),core.lastIndexOf('INSERT INTO app_settings'));
  await tx.exec(remap(templates));
  await tx.exec(remap(catalog));
  for(const [code,name] of [['ENTEKHAB','انتخاب'],['BASALAM','باسلام']]) {
    await tx.query("INSERT INTO contracts.customers(tenant_id,customer_code,legal_name,verification_status,metadata) VALUES($1,$2,$3,'manual-unverified',$4) ON CONFLICT(tenant_id,customer_code) DO NOTHING",[TITAN_TENANT_ID,code,name,JSON.stringify({source:'user-request',legalIdentityPending:true})]);
  }
  await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'workspace',$2) ON CONFLICT(tenant_id,key) DO NOTHING",[TITAN_TENANT_ID,JSON.stringify({workspaceName:'تایتان',currency:'IRR',calendar:'jalali',contractPrefix:'TITAN'})]);
}

// Identity seed runs after tenant creation because migration 003 is applied before core seed.
export async function seedIdentityBase(tx) {
  const roles=[['platform_admin','مدیر سامانه','مدیریت کامل سامانه و کاربران'],['contract_admin','مدیر قرارداد','مدیریت قرارداد، مشتری، الگو و تنظیمات'],['legal_reviewer','بازبین حقوقی','بازبینی و پیشروی مراحل حقوقی'],['finance_reviewer','بازبین مالی','بازبینی و پیشروی مراحل مالی'],['account_manager','مدیر حساب','مدیریت مشتریان و قراردادهای پرتفوی'],['viewer','مشاهده‌گر','مشاهده اطلاعات مجاز']];
  for(const [key,label,description] of roles)await tx.query('INSERT INTO contracts.app_roles(tenant_id,role_key,label,description) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,role_key) DO NOTHING',[TITAN_TENANT_ID,key,label,description]);
  const users=[['demo-admin','demo.admin@fanasa.example','دمو · مدیر قرارداد','contract_admin'],['demo-legal','demo.legal@fanasa.example','دمو · بازبین حقوقی','legal_reviewer'],['demo-finance','demo.finance@fanasa.example','دمو · بازبین مالی','finance_reviewer'],['demo-viewer','demo.viewer@fanasa.example','دمو · مشاهده‌گر','viewer']];
  for(const [subject,email,name,role] of users){
    const user=(await tx.query("INSERT INTO contracts.app_users(tenant_id,subject,email,display_name,status,metadata) VALUES($1,$2,$3,$4,'disabled',$5) ON CONFLICT DO NOTHING RETURNING id",[TITAN_TENANT_ID,subject,email,name,JSON.stringify({demo:true,ssoProvider:'fanasa'})])).rows[0];
    // Seed only new identities; preserve the subject and access assigned by operators.
    if(!user)continue;
    await tx.query('INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key=$3 ON CONFLICT DO NOTHING',[TITAN_TENANT_ID,user.id,role]);
  }
}

export async function databaseHealth(db, tenantId) {
  const migrations = (await db.query('SELECT version,name,checksum,applied_at FROM contracts.schema_migrations ORDER BY version')).rows;
  if (tenantId) {
    const counts={tenants:1};
    for(const [key,table] of Object.entries({templates:'contract_templates',zones:'catalog_zones',centers:'catalog_centers',services:'catalog_services',customers:'customers',managers:'account_managers',contracts:'contracts'}))counts[key]=(await db.query(`SELECT count(*)::int AS n FROM contracts.${table} WHERE tenant_id=$1`,[tenantId])).rows[0].n;
    return {ok:true,backend:db.backend,durable:db.backend==='postgresql'||db.dataDir!=='memory://',tenantId,migrations,counts};
  }
  const counts = (await db.query(`SELECT
    (SELECT count(*)::int FROM contracts.tenants) AS tenants,
    (SELECT count(*)::int FROM contracts.contract_templates) AS templates,
    (SELECT count(*)::int FROM contracts.catalog_zones) AS zones,
    (SELECT count(*)::int FROM contracts.catalog_centers) AS centers,
    (SELECT count(*)::int FROM contracts.catalog_services) AS services,
    (SELECT count(*)::int FROM contracts.customers) AS customers,
    (SELECT count(*)::int FROM contracts.account_managers) AS managers,
    (SELECT count(*)::int FROM contracts.contracts) AS contracts`)).rows[0];
  return { ok: true, backend: db.backend, durable: db.backend === 'postgresql' || db.dataDir !== 'memory://', migrations, counts };
}
