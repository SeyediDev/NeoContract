import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createDatabase} from '../lib/database.mjs';
import {backupDatabase,restoreDatabase} from '../lib/backup.mjs';
test('backup restores into a clean migrated database and refuses overwrite or tampering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'neocontract-backup-'));const file=join(root,'backup.json');let source,target;
 try{source=await createDatabase({dataDir:'memory://'});const backup=await backupDatabase(source,file);assert(backup.rows>100);await source.close();source=null;target=await createDatabase({dataDir:'memory://',seed:false});const restored=await restoreDatabase(target,file);assert.equal(restored.counts.services,87);assert.equal(restored.counts.templates,15);await assert.rejects(restoreDatabase(target,file),/empty database/);const data=JSON.parse(await readFile(file,'utf8'));data.tables.tenants[0].name='tampered';await writeFile(file,JSON.stringify(data));await assert.rejects(restoreDatabase(target,file),/checksum/);
 }finally{if(source)await source.close();if(target)await target.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert(basename(root).startsWith('neocontract-backup-'));await rm(root,{recursive:true,force:true});}
});

test('backup restores edited customer hierarchy even when children precede parents',async()=>{
 const {createHash,randomUUID}=await import('node:crypto');
 const {DEMO_TENANT_ID}=await import('../lib/database.mjs');
 const root=await mkdtemp(join(tmpdir(),'neocontract-backup-'));const file=join(root,'hierarchy.json');let source,target;
 const parent=randomUUID(),child=randomUUID();
 try {
  source=await createDatabase({dataDir:'memory://'});
  await source.query('INSERT INTO contracts.customers(id,tenant_id,customer_code,legal_name) VALUES($1,$2,$3,$4)',[parent,DEMO_TENANT_ID,'BACKUP-PARENT','Original parent']);
  await source.query('INSERT INTO contracts.customers(id,tenant_id,customer_code,legal_name,parent_id) VALUES($1,$2,$3,$4,$5)',[child,DEMO_TENANT_ID,'BACKUP-CHILD','Child',parent]);
  await source.query('UPDATE contracts.customers SET legal_name=$1 WHERE id=$2',['Edited parent',parent]);
  await backupDatabase(source,file);await source.close();source=null;
  const {checksum,...body}=JSON.parse(await readFile(file,'utf8'));
  // A backup must restore regardless of the physical row order returned by PostgreSQL.
  const rows=body.tables.customers;body.tables.customers=[rows.find(x=>x.id===child),...rows.filter(x=>x.id!==parent&&x.id!==child),rows.find(x=>x.id===parent)];
  await writeFile(file,JSON.stringify({...body,checksum:createHash('sha256').update(JSON.stringify(body)).digest('hex')}));
  target=await createDatabase({dataDir:'memory://',seed:false});await restoreDatabase(target,file);
  const restored=(await target.query('SELECT c.parent_id,p.legal_name FROM contracts.customers c JOIN contracts.customers p ON p.tenant_id=c.tenant_id AND p.id=c.parent_id WHERE c.id=$1',[child])).rows[0];assert.deepEqual(restored,{parent_id:parent,legal_name:'Edited parent'});
 } finally {if(source)await source.close();if(target)await target.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert(basename(root).startsWith('neocontract-backup-'));await rm(root,{recursive:true,force:true});}
});
