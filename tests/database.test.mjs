import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase, seedDatabase, DEMO_TENANT_ID } from '../lib/database.mjs';

const tenant = DEMO_TENANT_ID;
const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;

test('PostgreSQL migrations, seed integrity, tenant constraints, transaction rollback and durability', {timeout:120000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'neocontract-pg-test-'));
  let db;
  try {
    db = await createDatabase({dataDir:join(dir,'pgdata')});
    const health = await db.health();
    assert.equal(health.backend,'pglite-postgresql');
    assert.equal(health.durable,true);
    assert.deepEqual(health.counts,{tenants:1,templates:15,zones:5,centers:14,services:87,customers:4,managers:3,contracts:0});
    assert.equal(health.migrations.length,2);
    await migrateDatabase(db);
    await seedDatabase(db);
    assert.deepEqual((await db.health()).counts,health.counts);
    assert.equal((await rows(db,'SELECT count(*)::int AS n FROM contracts.catalog_service_sla'))[0].n,0,'no invented per-service SLA assignments');
    assert.equal((await rows(db,'SELECT count(*)::int AS n FROM contracts.catalog_services WHERE delivery IS NOT NULL'))[0].n,0,'unknown delivery stays null');
    const t2=(await rows(db,"SELECT * FROM contracts.sla_tiers WHERE code='T2'"))[0];
    assert.equal(Number(t2.resolution_target_value),1);
    assert.equal(t2.resolution_target_unit,'business_day');
    const t3=(await rows(db,"SELECT * FROM contracts.sla_tiers WHERE code='T3'"))[0];
    assert.equal(Number(t3.first_response_value),1);
    assert.equal(t3.first_response_unit,'business_day');
    assert.equal(Number(t3.resolution_target_value),5);

    // A fresh tenant cannot reference another tenant's manager, template, service or contract.
    const other = randomUUID();
    await db.query('INSERT INTO contracts.tenants(id,slug,name) VALUES($1,$2,$3)',[other,'test-other','Other tenant']);
    const manager=(await rows(db,'SELECT id FROM contracts.account_managers LIMIT 1'))[0].id;
    await assert.rejects(db.query('INSERT INTO contracts.customers(tenant_id,customer_code,legal_name,account_manager_id) VALUES($1,$2,$3,$4)',[other,'X','Cross tenant',manager]),/foreign key/i);
    const template=(await rows(db,"SELECT current_version_id FROM contracts.contract_templates WHERE code='purchase'"))[0].current_version_id;
    await assert.rejects(db.query('INSERT INTO contracts.contracts(tenant_id,contract_no,title,template_version_id) VALUES($1,$2,$3,$4)',[other,'X','Cross tenant',template]),/foreign key/i);
    const service=(await rows(db,'SELECT id FROM contracts.catalog_services LIMIT 1'))[0].id;
    const tier=(await rows(db,'SELECT id FROM contracts.sla_tiers LIMIT 1'))[0].id;
    await assert.rejects(db.query('INSERT INTO contracts.catalog_service_sla(tenant_id,service_id,sla_tier_id) VALUES($1,$2,$3)',[other,service,tier]),/foreign key/i);
    await assert.rejects(db.query('UPDATE contracts.contract_template_versions SET body_template=$1 WHERE id=$2',['Changed published body',template]),/immutable/i);
    await assert.rejects(db.query('INSERT INTO contracts.contracts(tenant_id,contract_no,title,template_version_id,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)',[tenant,'BAD-DATE','Invalid dates',template,'2026-12-31','2026-01-01']),/check constraint/i);

    const id=randomUUID();
    await assert.rejects(db.transaction(async tx=>{
      await tx.query('INSERT INTO contracts.contracts(id,tenant_id,contract_no,title,template_version_id) VALUES($1,$2,$3,$4,$5)',[id,tenant,'ROLLBACK','Must rollback',template]);
      throw new Error('deliberate rollback');
    }),/deliberate rollback/);
    assert.equal((await rows(db,'SELECT count(*)::int AS n FROM contracts.contracts WHERE id=$1',[id]))[0].n,0);

    // Preserve complete service snapshot while catalog edits and process changes are independent.
    const contract=randomUUID();
    await db.transaction(async tx=>{
      await tx.query('INSERT INTO contracts.contracts(id,tenant_id,contract_no,title,template_version_id,template_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[contract,tenant,'PERSIST-1','قرارداد پایدار',template,{body:'frozen template'}]);
      await tx.query('INSERT INTO contracts.contract_services(tenant_id,contract_id,service_id,service_code,service_name_snapshot,service_snapshot,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenant,contract,service,'DEMO','نام در زمان قرارداد',{name:'نام در زمان قرارداد',tier:null,delivery:null},2]);
      await tx.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type) VALUES($1,$2,$3)',[tenant,contract,'created']);
    });
    await assert.rejects(db.query('UPDATE contracts.contracts SET template_snapshot=$1 WHERE id=$2',[{body:'changed'},contract]),/immutable/i);
    await db.query('UPDATE contracts.contracts SET metadata=$1 WHERE id=$2',[{idempotencyKey:'unique-test'},contract]);
    await assert.rejects(db.query('INSERT INTO contracts.contracts(tenant_id,contract_no,title,template_version_id,metadata) VALUES($1,$2,$3,$4,$5)',[tenant,'DUP-KEY','Duplicate',template,{idempotencyKey:'unique-test'}]),/unique constraint/i);
    await db.query('UPDATE contracts.catalog_services SET name=$1 WHERE id=$2',['نام جدید کاتالوگ',service]);
    assert.equal((await rows(db,'SELECT service_name_snapshot FROM contracts.contract_services WHERE contract_id=$1',[contract]))[0].service_name_snapshot,'نام در زمان قرارداد');
    await assert.rejects(db.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type) VALUES($1,$2,$3)',[other,contract,'cross']),/foreign key/i);
    await assert.rejects(db.query('INSERT INTO contracts.contract_services(tenant_id,contract_id,service_code,service_name_snapshot,quantity) VALUES($1,$2,$3,$4,$5)',[tenant,contract,'X','negative',-1]),/check constraint/i);

    // SQL bootstrap is independently re-executable without data loss.
    await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
    await db.close(); db=null;
    db=await createDatabase({dataDir:join(dir,'pgdata')});
    assert.equal((await rows(db,'SELECT title FROM contracts.contracts WHERE id=$1',[contract]))[0].title,'قرارداد پایدار');
    assert.equal((await rows(db,'SELECT name FROM contracts.catalog_services WHERE id=$1',[service]))[0].name,'نام جدید کاتالوگ','seed does not overwrite operator edits');
    assert.equal((await rows(db,'SELECT count(*)::int AS n FROM contracts.contract_events WHERE contract_id=$1',[contract]))[0].n,1);
  } finally {
    if(db)await db.close();
    await rm(dir,{recursive:true,force:true});
  }
});
