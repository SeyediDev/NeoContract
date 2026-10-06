import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,TITAN_TENANT_ID} from '../lib/database.mjs';
import {provisionCustomerTenants,CUSTOMER_TENANTS} from '../lib/customer-tenancy.mjs';
import {createStore} from '../lib/store.mjs';
import {getTitanBoard} from '../lib/titan-board.mjs';
import {createApi} from '../lib/http-api.mjs';

async function request(api,url,tenant,subject='demo-admin',method='GET',payload,email='demo.admin@fanasa.example'){
 let status,body;
 const req={url,method,headers:{host:'localhost','x-tenant-id':tenant,'x-auth-request-sub':subject,'x-auth-request-email':email},socket:{remoteAddress:'127.0.0.1'}};
 if(payload!==undefined)req[Symbol.asyncIterator]=async function*(){yield Buffer.from(JSON.stringify(payload));};
 await api.handler(req,{writeHead(s){status=s;},end(b){body=b;}});
 return {status,value:JSON.parse(body)};
}

test('customer separation preserves history, rolls back conflicts and scopes pricing and SSO roles',{timeout:180000},async()=>{
 process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'});
 let api;
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1 AND subject IN ('demo-admin','demo-viewer')",[TITAN_TENANT_ID]);
  const before=(await db.query('SELECT * FROM contracts.contract_documents WHERE tenant_id=$1 ORDER BY id',[TITAN_TENANT_ID])).rows;
  await db.query("INSERT INTO contracts.tenants(id,slug,name) VALUES($1,'operator-existing','Existing')",[CUSTOMER_TENANTS[2].id]);
  await assert.rejects(()=>provisionCustomerTenants(db),/conflicts/);
  assert.equal((await db.query('SELECT count(*)::int n FROM contracts.tenants WHERE id=$1',[CUSTOMER_TENANTS[1].id])).rows[0].n,0,'partial import rolled back');
  assert.equal((await db.query('SELECT status FROM contracts.tenants WHERE id=$1',[TITAN_TENANT_ID])).rows[0].status,'active');
  await db.query('DELETE FROM contracts.tenants WHERE id=$1',[CUSTOMER_TENANTS[2].id]);
  const report=await provisionCustomerTenants(db);
  assert.equal(report.productName,'تایتان');
  assert.equal((await db.query("SELECT count(*)::int n FROM contracts.tenants WHERE status='active'")).rows[0].n,4);
  assert.equal((await db.query('SELECT status FROM contracts.tenants WHERE id=$1',[TITAN_TENANT_ID])).rows[0].status,'archived');
  assert.deepEqual((await db.query('SELECT * FROM contracts.contract_documents WHERE tenant_id=$1 ORDER BY id',[TITAN_TENANT_ID])).rows,before);
  for(const tenant of CUSTOMER_TENANTS){
   const store=createStore(db,tenant.id),board=await getTitanBoard(store),plans=await store.pricing.list();
   assert.equal(board.stats.contracts,tenant.intakes.length);
   assert.equal(board.stats.scopes,tenant.slug==='entekhab'?4:0);
   assert.equal(plans.length,tenant.intakes.length);
   for(const plan of plans){
    const c=await store.contract(plan.linkedContracts[0].id);
    assert.equal(c.metadata.migratedFrom.tenantId,TITAN_TENANT_ID);
    assert.ok(report.tenants.find(t=>t.tenantId===tenant.id).sourceContractIds.includes(c.metadata.migratedFrom.contractId));
    assert.equal(c.proposalRevision.pricing.sourcePlan.id,plan.id);
    assert.equal(c.proposalRevision.pricing.total,plan.total);
    const other=createStore(db,CUSTOMER_TENANTS.find(t=>t.id!==tenant.id).id);
    await assert.rejects(()=>other.pricing.get(plan.id),e=>e.status===404);
   }
  }
  const basalam=createStore(db,CUSTOMER_TENANTS[1].id),plan=(await basalam.pricing.list())[0];
  const model=structuredClone(plan.model);model.bases[0].amount*=2;
  const saved=await basalam.pricing.save({model,revision:plan.revision},plan.id,'migration test');
  assert.equal((await basalam.contract(plan.linkedContracts[0].id)).proposalRevision.pricing.total,saved.total);
  await db.seed();await provisionCustomerTenants(db);
  assert.equal((await basalam.pricing.get(plan.id)).revision,2);
  assert.equal((await basalam.pricing.list()).length,2);
  assert.deepEqual((await db.query('SELECT * FROM contracts.contract_documents WHERE tenant_id=$1 ORDER BY id',[TITAN_TENANT_ID])).rows,before);
  // An administrator in one tenant is a viewer in another. Never union role grants.
  await db.query('DELETE FROM contracts.app_user_roles WHERE tenant_id=$1 AND user_id IN (SELECT id FROM contracts.app_users WHERE tenant_id=$1 AND subject=$2)',[CUSTOMER_TENANTS[1].id,'demo-admin']);
  await db.query("INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT u.tenant_id,u.id,r.id FROM contracts.app_users u JOIN contracts.app_roles r ON r.tenant_id=u.tenant_id AND r.role_key='viewer' WHERE u.tenant_id=$1 AND u.subject='demo-admin'",[CUSTOMER_TENANTS[1].id]);
  api=await createApi({database:db,customerTenants:true,authMode:'oidc-proxy'});
  assert.equal((await request(api,'/api/tenants',CUSTOMER_TENANTS[0].id)).value.tenants.length,4);
  for(const t of CUSTOMER_TENANTS)assert.equal((await request(api,'/api/bootstrap',t.id)).status,200);
  assert.equal((await request(api,'/api/pricing-plans',CUSTOMER_TENANTS[1].id,'demo-admin','POST',{model})).status,403);
  assert.equal((await request(api,'/api/pricing-plans',CUSTOMER_TENANTS[0].id,'demo-admin','POST',{model})).status,201);
  assert.equal((await request(api,'/api/bootstrap',TITAN_TENANT_ID)).status,403);
  assert.equal((await request(api,'/api/bootstrap',CUSTOMER_TENANTS[0].id,'unknown-subject')).status,403,'email must not substitute a subject');
  await db.query("UPDATE contracts.app_users SET status='disabled' WHERE tenant_id=$1 AND subject='demo-admin'",[CUSTOMER_TENANTS[2].id]);
  assert.equal((await request(api,'/api/bootstrap',CUSTOMER_TENANTS[2].id)).status,403);
  assert.equal((await request(api,'/api/tenants',CUSTOMER_TENANTS[0].id)).value.tenants.length,3);
 }finally{if(api)await api.close();else await db.close();}
});
