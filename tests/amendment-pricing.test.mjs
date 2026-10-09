import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';
const model=amount=>({name:'نرخ مشترک خدمات',bases:[{id:'base',name:'نرخ پایه',unit:'واحد',amount,source:'استعلام آزمایشی'}],items:[{id:'one',title:'بند اول',quantity:2,components:[{baseId:'base',coefficient:3}]},{id:'two',title:'بند دوم',quantity:4,components:[{baseId:'base',coefficient:1}]}]});
async function post(api,url,input,subject='demo-admin'){
 let status,body;await api.handler({url,method:'POST',headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}},{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});return {status,body};
}
test('financial amendment snapshots bind a tenant version and server pricing basis',{timeout:240000},async t=>{
 const previous=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID),api=await createApi({database:db,authMode:'oidc-proxy'});
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);
  const data=await store.bootstrap(),template=data.templates.find(x=>x.currentPublishedVersion);
  const make=extra=>store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'الحاقیه مالی',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[],...extra});
  const c=await make({pricingPlan:model(100)}),plan=await store.pricing.save({model:model(200)});
  const reference={pricingPlanId:plan.id,pricingPlanRevision:plan.revision,expectedPricingBasis:c.amendmentPricingBasis.token};
  const input={title:'بازبینی نرخ',reason:'نرخ جدید',body:'پیشنهاد برای بررسی طرفین',idempotencyKey:randomUUID(),...reference,financial:{after:{total:1}},status:'signed'};
  const path=`/api/contracts/${c.id}/amendments`;
  await t.test('preview is read-only and recalculates both totals and all affected items',async()=>{
   const preview=await post(api,path+'/preview',reference);assert.equal(preview.status,200);const f=preview.body;
   assert.equal(f.basis.kind,'contract_pricing');assert.equal(f.basis.amount,1000);assert.equal(f.after.total,2000);assert.equal(f.comparison.delta,1000);assert.equal(f.comparison.bases.length,1);assert.equal(f.comparison.items.length,2);
   assert.deepEqual(await store.contract(c.id),c);
  });
  await t.test('stored financial draft, audit and retry preserve original terms and ignore forged amounts',async()=>{
   const saved=await post(api,path,input);assert.equal(saved.status,200);const draft=saved.body.amendments[0];
   assert.equal(draft.status,'draft');assert.equal(draft.financial.after.total,2000);assert.equal(draft.financial.sourcePlan.revision,1);assert.equal(draft.actor.subject,'demo-admin');
   for(const key of ['snapshot','document','status','amount','start','end','stages'])assert.deepEqual(saved.body[key],c[key]);
   const audit=saved.body.history.find(e=>e.type==='amendment_created');assert.equal(audit.proposedTotal,2000);assert.equal(audit.pricingDelta,1000);
   const retry=await post(api,'/api/amendments',{...input,contractId:c.id});assert.equal(retry.status,200);assert.equal(retry.body.amendments.length,1);
   const conflicting=await post(api,path,{...input,pricingPlanRevision:2});assert.equal(conflicting.status,409);
  });
  await t.test('later model versions cannot rewrite the attachment; historical versions remain selectable',async()=>{
   const before=(await store.contract(c.id)).amendments;
   await store.pricing.save({model:model(300),revision:1},plan.id);
   assert.deepEqual((await store.contract(c.id)).amendments,before);
   assert.equal((await post(api,path+'/preview',reference)).body.after.total,2000);
  });
  await t.test('scalar and unknown baselines remain distinct from model comparison and zero',async()=>{
   const scalar=await make({amount:0}),scalarPreview=await store.previewAmendment(scalar.id,{...reference,expectedPricingBasis:scalar.amendmentPricingBasis.token});
   assert.equal(scalarPreview.basis.kind,'contract_amount');assert.equal(scalarPreview.comparison.beforeTotal,0);assert.equal(scalarPreview.comparison.delta,2000);
   const unpriced=data.contracts.find(c=>c.amount===null&&!c.proposalRevision?.pricing&&!c.snapshot.pricing);assert.ok(unpriced);
   const unknown=await store.previewAmendment(unpriced.id,{...reference,expectedPricingBasis:unpriced.amendmentPricingBasis.token});
   assert.equal(unknown.basis.kind,'unknown');assert.equal(unknown.basis.amount,null);assert.equal(unknown.comparison,null);assert.equal(unknown.after.total,2000);
   const fractional=await make({amount:1000.1});await assert.rejects(store.previewAmendment(fractional.id,{...reference,expectedPricingBasis:fractional.amendmentPricingBasis.token}),e=>e.status===409);
  });
  await t.test('foreign versions, missing revisions and unexpected route suffixes cannot create amendments',async()=>{
   const foreign=await createStore(db,DEMO_TENANT_ID).pricing.save({model:model(5)}),before=await store.contract(c.id);
   assert.equal((await post(api,path,{...input,idempotencyKey:randomUUID(),pricingPlanId:foreign.id})).status,404);
   assert.equal((await post(api,path,{...input,idempotencyKey:randomUUID(),pricingPlanRevision:999})).status,404);
   assert.equal((await post(api,path,{...input,idempotencyKey:randomUUID(),expectedPricingBasis:'bad'})).status,409);
   assert.equal((await post(api,path+'/unexpected',input)).status,404);
   for(const malformed of [null,1,[]])assert.equal((await post(api,path+'/preview',malformed)).status,400);
   assert.equal((await post(api,path,null)).status,400);
   for(const subject of ['demo-viewer','demo-finance','demo-legal'])assert.equal((await post(api,path+'/preview',reference,subject)).status,403);
   assert.deepEqual(await store.contract(c.id),before);
  });
  await t.test('stale proposal basis rejects new drafts while retrying an already saved receipt remains safe',async()=>{
   const linked=(await store.contracts()).find(c=>c.metadata.dynamicPricingPlanId),linkedPlan=await store.pricing.get(linked.metadata.dynamicPricingPlanId);
   const terms={...input,pricingPlanId:linkedPlan.id,pricingPlanRevision:linkedPlan.revision,expectedPricingBasis:linked.amendmentPricingBasis.token,idempotencyKey:randomUUID()};
   const saved=await store.amend(linked.id,terms);const original=saved.amendments.at(-1).financial;
   const changed=structuredClone(linkedPlan.model);changed.bases[0].amount+=100;
   await store.pricing.save({model:changed,revision:linkedPlan.revision},linkedPlan.id);
   assert.notEqual((await store.contract(linked.id)).amendmentPricingBasis.token,terms.expectedPricingBasis);
   await assert.rejects(store.amend(linked.id,{...terms,idempotencyKey:randomUUID()}),e=>e.status===409);
   const retry=await store.amend(linked.id,terms);assert.equal(retry.amendments.length,1);assert.deepEqual(retry.amendments[0].financial,original);
  });
 }finally{await api.close();if(previous===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=previous;}
});
