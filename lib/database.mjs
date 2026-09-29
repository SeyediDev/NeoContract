import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';
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
    db.health = () => databaseHealth(db);
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
  });
  return databaseHealth(db);
}

export async function databaseHealth(db) {
  const migrations = (await db.query('SELECT version,name,checksum,applied_at FROM contracts.schema_migrations ORDER BY version')).rows;
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
