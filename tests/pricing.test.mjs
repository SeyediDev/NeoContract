import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { calculatePricing, PricingError } from '../public/pricing.js';
import { createApi } from '../lib/http-api.mjs';
import { createStaticServer } from '../server.mjs';
import { createDatabase, DEMO_TENANT_ID, TITAN_TENANT_ID } from '../lib/database.mjs';
import { createStore } from '../lib/store.mjs';
import { backupDatabase, restoreDatabase } from '../lib/backup.mjs';

const fixture = () => ({name:'مدل آزمون',bases:[{id:'compute',name:'پردازش',unit:'هسته‌ساعت',amount:1000},{id:'storage',name:'ذخیره‌سازی',unit:'گیگابایت‌ماه',amount:200}],items:[{id:'a',title:'بسته اول',quantity:2,components:[{baseId:'compute',coefficient:3},{baseId:'storage',coefficient:5}]},{id:'b',title:'بسته دوم',quantity:4,components:[{baseId:'compute',coefficient:1}]}]});
test('shared and multiple base prices recalculate all dependent lines; client totals are ignored',()=>{
 const m=fixture();m.total=1;m.items[0].amount=1;
 const a=calculatePricing(m);assert.deepEqual(a.items.map(i=>i.amount),[8000,4000]);assert.equal(a.total,12000);
 m.bases[0].amount=2000;const b=calculatePricing(m);assert.deepEqual(b.items.map(i=>i.amount),[14000,8000]);assert.equal(b.total,22000);
 assert.deepEqual(calculatePricing(JSON.parse(JSON.stringify(b))),b,'normalized models must calculate identically after persistence');
});
test('fixed point arithmetic supports Persian digits and rounds each item once',()=>{
 const m=fixture();m.bases[0].amount='۱٬۰۰۰';m.items=[{id:'a',title:'جزئی',quantity:'۰٫۰۰۱۵',components:[{baseId:'compute',coefficient:'۰٫۱'}]}];
 assert.equal(calculatePricing(m).total,0);m.items[0].quantity='۰٫۰۰۵';assert.equal(calculatePricing(m).total,1);
 m.bases[0].amount=0;assert.equal(calculatePricing(m).total,0);
 m.bases[0].amount=999999;m.items[0].quantity='0.000001';m.items[0].components[0].coefficient='0.500001';assert.equal(calculatePricing(m).total,1);
});
test('invalid references, duplicates, precision and overflow are rejected',()=>{
 const edits=[m=>m.bases.push({...m.bases[0]}),m=>m.bases[0]=null,m=>m.items[0]=null,m=>m.items[0].components[0]=null,m=>m.items[0].components[0].baseId='missing',m=>m.items[0].components.push({...m.items[0].components[0]}),m=>m.items[0].quantity=0,m=>m.items[0].quantity='0.0000001',m=>m.items[0].quantity='99999999999.123456',m=>m.items[0].components[0].coefficient=-1,m=>m.bases[0].amount=1.5,m=>m.bases[0].amount=Number.MAX_SAFE_INTEGER,m=>m.items[0].title='<'.repeat(201),m=>m.items.forEach(i=>i.serviceCode='ABR-01')];
 for(const edit of edits){const m=fixture();edit(m);assert.throws(()=>calculatePricing(m),PricingError);}
});
test('pricing API enforces revision and tenant boundaries; contract keeps captured formulas across restart', {timeout:180000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'neocontract-pricing-'));let app,server;
 try{
  app=await createApi({dataDir:join(dir,'pg')});server=createStaticServer({apiHandler:app.handler});server.listen(0,'127.0.0.1');await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,tenant=DEMO_TENANT_ID){const r=await fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json','X-Tenant-Id':tenant},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  const created=await call('/pricing-plans','POST',{model:fixture()});assert.equal(created.status,201);const first=created.data;assert.equal(first.revision,1);assert.equal(first.total,12000);
  assert.equal((await call('/pricing-plans/'+first.id,'GET',undefined,TITAN_TENANT_ID)).status,404);
  assert.equal((await call('/pricing-plans/not-a-uuid')).status,400);
  const b=await call('/bootstrap');const base=b.data.templates.find(t=>t.code==='purchase');
  const input={templateId:base.id,customerId:b.data.customers[0].id,title:'قرارداد قیمت‌گذاری',party:'طرف آزمون',amount:999,start:'2026-10-01',end:'2027-10-01',owner:'مسئول',paymentTerms:'توافقی',services:[{code:'ABR-01',slaTier:'T1',delivery:'managed',quantity:999,unitPrice:999}],pricingPlan:{...first.model,items:first.model.items.map((i,index)=>({...i,serviceCode:index===0?'ABR-01':''}))},pricingPlanId:first.id,pricingPlanRevision:first.revision};
  const contractResult=await call('/contracts','POST',input);assert.equal(contractResult.status,201,JSON.stringify(contractResult.data));const c=contractResult.data;
  assert.equal(c.amount,12000);assert.equal(c.services[0].unitPrice,4000);assert.equal(c.services[0].quantity,2);assert.match(c.document,/پیوست قیمت‌گذاری پویا/);assert.deepEqual(c.snapshot.pricing.sourcePlan,{id:first.id,revision:1});
  const changed=fixture();changed.bases[0].amount=2000;
  const raced=await Promise.all([call('/pricing-plans/'+first.id,'PUT',{model:changed,revision:1}),call('/pricing-plans/'+first.id,'PUT',{model:changed,revision:1})]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
  const history=await call('/pricing-plans/'+first.id+'/history');assert.deepEqual(history.data.map(v=>v.revision),[2,1]);assert.equal(history.data[1].model.total,12000);
  await assert.rejects(app.db.query('UPDATE contracts.pricing_plan_versions SET actor=$1 WHERE plan_id=$2',['overwrite',first.id]),/immutable/i);
  assert.deepEqual((await call('/contracts/'+c.id)).data.snapshot,c.snapshot);
  assert.equal((await call('/contracts/preview','POST',{...input,pricingPlanRevision:999})).status,404);
  assert.equal((await call('/contracts/preview','POST',{...input,pricingPlanId:'bad-id'})).status,400);
  assert.equal((await call('/contracts/preview','POST',{...input,services:[]})).status,400);
  const backupPath=join(dir,'backup.json');await backupDatabase(app.db,backupPath);
  const restored=await createDatabase({dataDir:'memory://',seed:false});try{await restoreDatabase(restored,backupPath);const s=createStore(restored,DEMO_TENANT_ID);assert.equal((await s.pricing.get(first.id)).revision,2);assert.equal((await s.pricing.history(first.id)).length,2);assert.deepEqual((await s.contract(c.id)).snapshot,c.snapshot);}finally{await restored.close();}
  await new Promise(resolve=>server.close(resolve));server=null;await app.db.close();app=null;
  const db=await createDatabase({dataDir:join(dir,'pg')});try{const s=createStore(db,DEMO_TENANT_ID);assert.equal((await s.pricing.get(first.id)).revision,2);assert.equal((await s.pricing.history(first.id))[1].model.total,12000);assert.deepEqual((await s.contract(c.id)).snapshot,c.snapshot);}finally{await db.close();}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(app)await app.db.close();await rm(dir,{recursive:true,force:true});}
});
