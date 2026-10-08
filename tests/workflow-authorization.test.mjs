import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,TITAN_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';

async function request(api,url,subject,payload,method='POST'){
 let status,body;
 const req={url,method,headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'}};
 if(payload!==undefined)req[Symbol.asyncIterator]=async function*(){yield Buffer.from(JSON.stringify(payload));};
 await api.handler(req,{writeHead(s){status=s;},end(b){body=b;}});
 return {status,value:JSON.parse(body)};
}
const expected=c=>({expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null,comment:'بررسی نقش مرحله'});

test('SSO stage permissions, actor audit and administrator safeguards',{timeout:240000},async t=>{
 const previous=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID);
 const api=await createApi({database:db,authMode:'oidc-proxy'});
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);
  const users=(await request(api,'/api/users','demo-admin',undefined,'GET')).value.users;
  const bySubject=subject=>users.find(u=>u.subject===subject);
  const draft=await store.saveTemplate({title:'آزمون مجوز گردش',body:'قرارداد {{title}}',stages:['legal','finance','signatory'].map(role=>({id:role,name:role,role,required:true,enabled:true,slaDays:1}))});
  const template=await store.templateAction(draft.id,'publish',{revision:draft.revision,templateVersionId:draft.templateVersionId});
  const data=await store.bootstrap();
  let c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'قرارداد مجوزها',owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
  const advance=subject=>request(api,`/api/contracts/${c.id}/advance`,subject,{...expected(c),actor:{subject:'forged-admin',roles:['platform_admin']}});
  await t.test('reviewers cannot start a workflow or complete another role or signature',async()=>{
   assert.equal((await advance('demo-legal')).value.code,'stage_role_forbidden');
   assert.equal((await advance('demo-viewer')).status,403);
   c=(await advance('demo-admin')).value;
   const before=await store.contract(c.id);
   assert.equal((await advance('demo-finance')).value.code,'stage_role_forbidden');
   assert.deepEqual(await store.contract(c.id),before,'denial must not mutate steps or history');
   c=(await advance('demo-legal')).value;assert.equal(c.stages.find(s=>s.status==='active').role,'finance');
   assert.equal((await advance('demo-legal')).status,403);
   c=(await advance('demo-finance')).value;assert.equal(c.status,'awaiting_signature');
   assert.equal((await advance('demo-finance')).status,403);
   assert.equal((await advance('demo-legal')).status,403);
   c=(await advance('demo-admin')).value;assert.equal(c.status,'active');
  });
  await t.test('history records the verified identity and completion label',async()=>{
   const event=c.history.find(e=>e.completedStep?.role==='legal');
   assert.equal(event.actor.subject,'demo-legal');assert.equal(event.actor.id,bySubject('demo-legal').id);
   const step=(await db.query('SELECT completed_by_label FROM contracts.contract_process_steps WHERE id=$1',[event.completedStep.stepId])).rows[0];
   assert.equal(step.completed_by_label,bySubject('demo-legal').display_name);
  });
  await t.test('contract administrators cannot elevate to platform admin or demote themselves',async()=>{
   const patch=(user,body)=>request(api,'/api/users/'+user.id,'demo-admin',body,'PATCH');
   assert.equal((await patch(bySubject('demo-viewer'),{status:'active',roles:['platform_admin']})).status,403);
   assert.equal((await patch(bySubject('demo-admin'),{status:'active',roles:['viewer']})).value.code,'self_demotion_forbidden');
   assert.equal((await patch(bySubject('demo-viewer'),{status:'active',roles:['viewer',123]})).value.code,'invalid_role');
   const audits=(await db.query('SELECT * FROM contracts.app_user_audit')).rows;assert.equal(audits.length,0);
  });
  await t.test('the last administrator cannot be disabled by a stale session',async()=>{
   const transaction=db.transaction;
   // Simulate an administrator revoked between request authorization and transaction.
   db.transaction=async work=>{await db.query("DELETE FROM contracts.app_user_roles WHERE user_id=$1",[bySubject('demo-admin').id]);return transaction(work);};
   await db.query("INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key='contract_admin'",[TITAN_TENANT_ID,bySubject('demo-viewer').id]);
   const result=await request(api,'/api/users/'+bySubject('demo-viewer').id,'demo-admin',{status:'disabled',roles:['viewer']},'PATCH');
   db.transaction=transaction;
   assert.equal(result.value.code,'last_admin_required');
   assert.equal((await db.query('SELECT status FROM contracts.app_users WHERE id=$1',[bySubject('demo-viewer').id])).rows[0].status,'active');
  });
 }finally{await api.close();if(previous===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=previous;}
});
