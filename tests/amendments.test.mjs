import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';

async function call(api,url,body,subject='demo-admin'){
 let status,value;
 await api.handler({url,method:'POST',headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}},
 {writeHead(s){status=s;},end(b){value=JSON.parse(b);}});
 return {status,value};
}

test('amendment retries, numbering, verified actors and immutable contract terms',{timeout:240000},async t=>{
 const previous=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID);
 const api=await createApi({database:db,authMode:'oidc-proxy'});
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);
  const data=await store.bootstrap(),template=data.templates.find(x=>x.currentPublishedVersion);
  const make=title=>store.createContract({templateId:template.id,customerId:data.customers[0].id,title,owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
  const c=await make('قرارداد الحاقیه'),path=`/api/contracts/${c.id}/amendments`;
  const body={title:'الحاقیه نخست',reason:'بازبینی دامنه',body:'متن پیشنهادی پیش از توافق',idempotencyKey:randomUUID(),actor:{subject:'forged',name:'جاعل'},status:'signed'};
  await t.test('parallel retries across both routes create exactly one draft and one audit event',async()=>{
   const results=await Promise.all([call(api,path,body),call(api,'/api/amendments',{contractId:c.id,...body})]);
   assert.deepEqual(results.map(r=>r.status),[200,200]);
   const saved=await store.contract(c.id);assert.equal(saved.amendments.length,1);assert.equal(saved.amendments[0].number,1);assert.equal(saved.amendments[0].status,'draft');
   const actor=saved.amendments[0].actor;assert.equal(actor.subject,'demo-admin');assert.notEqual(actor.name,'جاعل');
   const events=saved.history.filter(e=>e.type==='amendment_created');assert.equal(events.length,1);assert.equal(events[0].amendmentId,saved.amendments[0].id);assert.deepEqual(events[0].actor,actor);
   const row=(await db.query('SELECT actor_label FROM contracts.contract_events WHERE id=$1',[events[0].id])).rows[0];assert.equal(row.actor_label,actor.name);
   for(const key of ['snapshot','document','status','amount','start','end','metadata','stages'])assert.deepEqual(saved[key],c[key],key);
  });
  await t.test('reordered and trimmed content retries are stable; changed content conflicts without mutations',async()=>{
   const retry=await call(api,path,{body:' '+body.body+' ',idempotencyKey:body.idempotencyKey,reason:body.reason,title:body.title});assert.equal(retry.status,200);assert.equal(retry.value.amendments.length,1);
   const before=await store.contract(c.id),conflict=await call(api,path,{...body,body:'متن متفاوت'});assert.equal(conflict.status,409);assert.deepEqual(await store.contract(c.id),before);
  });
  await t.test('distinct concurrent drafts get consecutive numbers and omitted keys remain supported',async()=>{
   const results=await Promise.all([call(api,path,{...body,idempotencyKey:randomUUID(),title:'دوم'}),call(api,path,{...body,idempotencyKey:randomUUID(),title:'سوم'})]);assert.ok(results.every(r=>r.status===200));
   const legacy={title:'چهارم',reason:body.reason,body:body.body};assert.equal((await call(api,path,legacy)).status,200);
   assert.deepEqual((await store.contract(c.id)).amendments.map(a=>a.number),[1,2,3,4]);
  });
  await t.test('keys are scoped to each contract; foreign contract IDs and unauthorized actors cannot write',async()=>{
   const other=await make('قرارداد دیگر');assert.equal((await call(api,`/api/contracts/${other.id}/amendments`,body)).value.amendments.length,1);
   const foreignStore=createStore(db,DEMO_TENANT_ID),foreignData=await foreignStore.bootstrap();
   const foreign=await foreignStore.createContract({templateId:foreignData.templates.find(x=>x.currentPublishedVersion).id,customerId:foreignData.customers[0].id,title:'قرارداد تننت دیگر',owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
   assert.equal((await call(api,`/api/contracts/${foreign.id}/amendments`,body)).status,404);
   assert.equal((await call(api,`/api/contracts/${foreign.id}/amendments`,{})).status,404);
   const before=await store.contract(c.id);
   for(const subject of ['demo-viewer','demo-legal','demo-finance'])assert.equal((await call(api,path,body,subject)).status,403);
   assert.deepEqual(await store.contract(c.id),before);
   const account=randomUUID();await db.query("INSERT INTO contracts.app_users(id,tenant_id,subject,email,display_name,status) VALUES($1,$2,'amendment-account','amendment@example.invalid','مدیر حساب آزمون','active')",[account,TITAN_TENANT_ID]);
   await db.query("INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key='account_manager'",[TITAN_TENANT_ID,account]);
   const allowed=await call(api,path,{...body,idempotencyKey:randomUUID()},'amendment-account');assert.equal(allowed.status,200);assert.equal(allowed.value.amendments.at(-1).actor.id,account);
  });
  await t.test('invalid keys and field limits cannot create drafts',async()=>{
   const before=await store.contract(c.id);
   for(const idempotencyKey of ['',null,123,{},'x'.repeat(121)])assert.equal((await call(api,path,{...body,idempotencyKey})).status,400);
   assert.equal((await call(api,path,{...body,title:'x'.repeat(201)})).status,400);assert.equal((await call(api,path,{...body,body:'x'.repeat(20001)})).status,400);
   assert.deepEqual(await store.contract(c.id),before);
  });
  await t.test('audit failure rolls back the draft, number and request receipt together',async()=>{
   const before=await store.contract(c.id),transaction=db.transaction;
   db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,params)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('Injected audit failure');return tx.query(sql,params);}}));
   try{await assert.rejects(store.amend(c.id,{...body,idempotencyKey:randomUUID()}),/Injected audit failure/);}finally{db.transaction=transaction;}
   assert.deepEqual(await store.contract(c.id),before);
  });
 }finally{await api.close();if(previous===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=previous;}
});
