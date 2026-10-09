import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';
async function post(api,url,input,subject='demo-admin'){
 let status,body;await api.handler({url,method:'POST',headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}},{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});return {status,body};
}
test('internal amendment review permissions, fixed content, receipts and concurrent decisions',{timeout:240000},async t=>{
 const previous=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID),api=await createApi({database:db,authMode:'oidc-proxy'});
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);
  const account=randomUUID();await db.query("INSERT INTO contracts.app_users(id,tenant_id,subject,email,display_name,status) VALUES($1,$2,'review-account','review@example.invalid','مدیر حساب آزمون','active')",[account,TITAN_TENANT_ID]);
  await db.query("INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key='account_manager'",[TITAN_TENANT_ID,account]);
  const data=await store.bootstrap(),template=data.templates.find(x=>x.currentPublishedVersion);
  const c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'بررسی الحاقیه',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
  const make=async extra=>(await store.amend(c.id,{title:'پیشنهاد',reason:'تغییر خدمات',body:'پس از توافق طرفین',...extra})).amendments.at(-1);
  const path=a=>`/api/contracts/${c.id}/amendments/${a.id}/review`;
  const input=(a,action,extra={})=>({action,expectedStatus:a.status,expectedRevision:a.workflow.revision,idempotencyKey:randomUUID(),comment:'توضیح بررسی',...extra});
  let a=await make();
  await t.test('submission uses server actor and duplicate receipt; stale concurrent decision cannot advance twice',async()=>{
   const d=input(a,'submit',{actor:{subject:'forged'},status:'signed'});
   for(const subject of ['demo-viewer','demo-legal','demo-finance'])assert.equal((await post(api,path(a),d,subject)).status,403);
   const results=await Promise.all([post(api,path(a),d,'review-account'),post(api,path(a),d,'review-account')]);assert.deepEqual(results.map(r=>r.status),[200,200]);
   a=(await store.contract(c.id)).amendments[0];assert.equal(a.status,'in_review');assert.equal(a.workflow.stage,'legal');assert.equal(a.workflow.revision,1);assert.equal(a.workflow.decisions.length,1);assert.equal(a.workflow.decisions[0].actor.subject,'review-account');assert.equal(a.workflow.decisions[0].key,undefined);
   const approval=input(a,'approve');assert.equal((await post(api,path(a),approval,'demo-finance')).status,403);assert.equal((await post(api,path(a),approval,'review-account')).status,403);
   const competing=await Promise.all([post(api,path(a),approval,'demo-legal'),post(api,path(a),{...approval,idempotencyKey:randomUUID()},'demo-legal')]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
   assert.equal((await post(api,path(a),approval,'demo-legal')).status,200);
   assert.equal((await post(api,path(a),{...approval,comment:'متفاوت'},'demo-legal')).status,409);
   a=(await store.contract(c.id)).amendments[0];assert.equal(a.status,'approved');assert.equal(a.workflow.stage,null);assert.equal(a.workflow.decisions.length,2);
   assert.equal((await post(api,path(a),input(a,'sign'))).status,400);
   const saved=await store.contract(c.id);for(const key of ['snapshot','document','amount','status','start','end','stages'])assert.deepEqual(saved[key],c[key]);assert.equal(saved.history.filter(e=>e.type==='amendment_reviewed').length,2);
  });
  await t.test('financial attachments require legal then finance; approved content stays fixed',async()=>{
   const model={name:'نرخ آزمایشی',bases:[{id:'base',name:'واحد',unit:'عدد',amount:200}],items:[{id:'one',title:'خدمت',quantity:10,components:[{baseId:'base',coefficient:1}]}]},plan=await store.pricing.save({model});
   let f=await make({pricingPlanId:plan.id,pricingPlanRevision:1,expectedPricingBasis:c.amendmentPricingBasis.token});const fixed=f.financial;
   f=(await post(api,path(f),input(f,'submit'),'review-account')).body.amendments.at(-1);
   f=(await post(api,path(f),input(f,'approve'),'demo-legal')).body.amendments.at(-1);assert.equal(f.status,'in_review');assert.equal(f.workflow.stage,'finance');
   assert.equal((await post(api,path(f),input(f,'approve'),'demo-legal')).status,403);
   f=(await post(api,path(f),input(f,'approve'),'demo-finance')).body.amendments.at(-1);assert.equal(f.status,'approved');assert.equal(f.workflow.revision,3);assert.deepEqual(f.financial,fixed);
   await assert.rejects(db.query("UPDATE contracts.contract_amendments SET summary='forged' WHERE id=$1",[f.id]),/immutable/i);
   await assert.rejects(db.query("UPDATE contracts.contract_amendments SET delta=jsonb_set(delta,'{financial,after,total}','1') WHERE id=$1",[f.id]),/immutable/i);
  });
  await t.test('rejection and cancellation require explanation; terminal states cannot resubmit',async()=>{
   let r=await make();r=(await post(api,path(r),input(r,'submit'))).body.amendments.at(-1);
   assert.equal((await post(api,path(r),input(r,'reject',{comment:' '}),'demo-legal')).status,400);
   r=(await post(api,path(r),input(r,'reject'),'demo-legal')).body.amendments.at(-1);assert.equal(r.status,'rejected');assert.equal((await post(api,path(r),input(r,'submit'))).status,403);
   let x=await make();assert.equal((await post(api,path(x),input(x,'cancel',{comment:''}),'review-account')).status,400);
   x=(await post(api,path(x),input(x,'cancel'),'review-account')).body.amendments.at(-1);assert.equal(x.status,'cancelled');assert.equal((await post(api,path(x),input(x,'submit'))).status,403);
  });
  await t.test('tenant boundaries, malformed requests and audit rollback',async()=>{
   const foreign=createStore(db,DEMO_TENANT_ID),fd=await foreign.bootstrap(),fc=await foreign.createContract({templateId:fd.templates.find(x=>x.currentPublishedVersion).id,customerId:fd.customers[0].id,title:'دیگر',owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
   assert.equal((await post(api,`/api/contracts/${fc.id}/amendments/${a.id}/review`,{})).status,404);
   assert.equal((await post(api,`/api/contracts/${c.id}/amendments/${randomUUID()}/review`,{})).status,404);
   assert.equal((await post(api,'/api/amendments/unexpected',{contractId:c.id})).status,404);
   const x=await make(),before=await store.contract(c.id);
   await assert.rejects(store.reviewAmendment(c.id,x.id,input(x,'submit'),{tenantId:TITAN_TENANT_ID,subject:'no-role'}),e=>e.status===403);
   for(const extra of [{idempotencyKey:null},{idempotencyKey:1},{expectedRevision:-1},{expectedRevision:'0'},{expectedStatus:null},{action:'signed'}])assert.equal((await post(api,path(x),input(x,'submit',extra))).status,400);
   const transaction=db.transaction;db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,p)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('Audit failure');return tx.query(sql,p);}}));
   try{await assert.rejects(store.reviewAmendment(c.id,x.id,input(x,'submit')),/Audit failure/);}finally{db.transaction=transaction;}
   assert.deepEqual(await store.contract(c.id),before);
  });
 }finally{await api.close();if(previous===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=previous;}
});
