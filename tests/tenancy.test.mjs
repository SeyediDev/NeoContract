import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { once } from 'node:events';
import { createApi } from '../lib/http-api.mjs';
import { createStaticServer } from '../server.mjs';
import { DEMO_TENANT_ID as DEMO, TITAN_TENANT_ID as TITAN } from '../lib/database.mjs';

const tokenTitan='titan-test-credential-'.padEnd(48,'t');
const tokenDemo='demo-test-credential-'.padEnd(48,'d');
async function serve(api){const server=createStaticServer({apiHandler:api.handler});server.listen(0,'127.0.0.1');await once(server,'listening');return server;}
function call(server,path,{tenant,token,method='GET',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body);
  const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{...(tenant?{'X-Tenant-Id':tenant}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...headers}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,data,text});});
  });req.on('error',reject);if(payload)req.write(payload);req.end();
 });
}
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test('tenant context is authorized on every route and isolated under concurrent HTTP requests',{timeout:180000},async t=>{
 const app=await createApi({dataDir:'memory://'});
 const secured=await createApi({database:app.db,tenantTokens:{[TITAN]:tokenTitan,[DEMO]:tokenDemo}});
 const denied=await createApi({database:app.db,authMode:'authenticated'});
 const [local,authenticated,noCredentials]=await Promise.all([serve(app),serve(secured),serve(denied)]);
 try{
  let titan,demo;
  await t.test('local selection resolves real tenants and independent seed identities',async()=>{
   const list=await call(local,'/api/tenants');assert.equal(list.status,200);assert.equal(list.data.mode,'local-demo');assert.equal(list.data.activeTenant.id,TITAN);
   [titan,demo]=await Promise.all([call(local,'/api/bootstrap',{tenant:TITAN}),call(local,'/api/bootstrap',{tenant:DEMO})]);
   assert.equal(titan.status,200);assert.equal(demo.status,200);
   assert.deepEqual(titan.data.customers.map(c=>c.name).sort(),['انتخاب','باسلام'].sort());assert.equal(demo.data.customers.length,4);
   assert.equal(titan.data.catalog.centers.length,14);assert.equal(titan.data.catalog.services.length,87);
   assert.ok(titan.data.catalog.services.every(s=>!demo.data.catalog.services.some(d=>d.id===s.id)));
   assert.ok(titan.data.templates.every(s=>!demo.data.templates.some(d=>d.id===s.id)));
   assert.ok(titan.data.contracts.every(c=>c.amount===null&&c.start===''&&c.end===''));
   assert.equal((await call(local,'/api/settings',{tenant:'no-such-tenant'})).status,404);
   assert.equal((await call(local,'/api/settings',{headers:{Host:'attacker.example'}})).status,403);
   assert.equal((await call(local,'/api/settings',{headers:{Origin:'https://attacker.example'}})).status,403);
  });
  await t.test('credentials cannot list, select or read a different tenant',async()=>{
   const list=await call(authenticated,'/api/tenants',{token:tokenTitan});assert.equal(list.status,200);assert.equal(list.data.mode,'authenticated');assert.deepEqual(list.data.tenants.map(x=>x.id),[TITAN]);
   for(const path of ['/api/tenants','/api/bootstrap','/api/catalog','/api/customers','/api/managers','/api/templates','/api/contracts','/api/settings','/api/integrations','/api/health','/api/titan/board']){
    assert.equal((await call(authenticated,path,{tenant:DEMO,token:tokenTitan})).status,403,path);
    assert.equal((await call(authenticated,path,{tenant:TITAN})).status,401,path);
   }
   assert.equal((await call(authenticated,'/api/tenants',{token:'invalid'})).status,401);
   assert.equal((await call(noCredentials,'/api/bootstrap',{tenant:TITAN})).status,401);
   assert.equal((await call(authenticated,'/api/settings',{token:tokenDemo})).data.tenantId,DEMO);
  });
  await t.test('foreign IDs cannot escape the request tenant in CRUD or document paths',async()=>{
   const foreign=demo.data.customers[0],foreignTemplate=demo.data.templates[0];
   assert.equal((await call(local,`/api/customers/${foreign.id}`,{tenant:TITAN,method:'PUT',body:{name:'overwrite'}})).status,404);
   assert.equal((await call(local,`/api/customers/${foreign.id}`,{tenant:TITAN,method:'DELETE'})).status,404);
   assert.equal((await call(local,'/api/customers',{tenant:TITAN,method:'POST',body:{name:'invalid link',parentId:foreign.id}})).status,404);
   assert.equal((await call(local,'/api/customers',{tenant:TITAN,method:'POST',body:{name:'invalid manager',managerId:demo.data.managers[0].id}})).status,404);
   assert.equal((await call(local,`/api/templates/${foreignTemplate.id}/archive`,{tenant:TITAN,method:'POST'})).status,404);
   const contract=titan.data.contracts[0];assert.ok(contract);
   for(const suffix of ['','/document'])assert.equal((await call(local,`/api/contracts/${contract.id}${suffix}`,{tenant:DEMO})).status,404);
   for(const suffix of ['/advance','/amendments','/neo-sync'])assert.equal((await call(local,`/api/contracts/${contract.id}${suffix}`,{tenant:DEMO,method:'POST',body:{}})).status,404);
   assert.equal((await call(authenticated,'/api/customers',{tenant:DEMO,token:tokenTitan,method:'POST',body:{name:'blocked'}})).status,403);
  });
  await t.test('settings, health and integrations use only their current tenant',async()=>{
   const saved=await call(local,'/api/settings',{tenant:TITAN,method:'PUT',body:{workspaceName:'تایتان آزمون',tenantId:DEMO}});assert.equal(saved.status,200);
   const results=await Promise.all(Array.from({length:12},(_,i)=>call(local,'/api/settings',{tenant:i%2?TITAN:DEMO})));
   for(const [i,r] of results.entries()){assert.equal(r.data.tenantId,i%2?TITAN:DEMO);assert.equal(r.data.workspaceName==='تایتان آزمون',Boolean(i%2));}
   const health=await call(local,'/api/health',{tenant:TITAN});assert.equal(health.data.counts.customers,2);assert.equal(health.data.counts.centers,14);assert.equal(health.data.counts.tenants,1);
   const integrations=await call(local,'/api/integrations',{tenant:TITAN});assert.equal(integrations.data.neo.status,'unavailable');assert.match(integrations.data.neo.message,/تنظیم نشده/);assert.equal(integrations.data.database.counts.customers,2);assert.deepEqual(integrations.data.sync.imports,[]);
   assert.equal((await call(local,`/api/contracts/${titan.data.contracts[0].id}/neo-sync`,{tenant:TITAN,method:'POST'})).status,409);
   const board=await call(local,'/api/titan/board',{tenant:DEMO});assert.equal(board.data.rows.length,0);
   const foreignImport=(await app.db.query("INSERT INTO contracts.catalog_imports(tenant_id,source_url,status,payload) VALUES($1,'https://example.invalid','pending',$2) RETURNING id",[DEMO,JSON.stringify({catalog:{services:[],centers:[]}})])).rows[0].id;
   assert.equal((await call(local,'/api/integrations/sync/approve',{tenant:TITAN,method:'POST',body:{importId:foreignImport}})).status,400);
  });
  await t.test('suspended tenants cannot access persisted records',async()=>{
   await app.db.query("UPDATE contracts.tenants SET status='suspended' WHERE id=$1",[TITAN]);
   assert.equal((await call(authenticated,'/api/bootstrap',{tenant:TITAN,token:tokenTitan})).status,404);
   await app.db.query("UPDATE contracts.tenants SET status='active' WHERE id=$1",[TITAN]);
  });
 }finally{await Promise.all([close(local),close(authenticated),close(noCredentials)]);await app.close();}
});
