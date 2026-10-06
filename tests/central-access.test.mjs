import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralAccess,centralAccessFromEnv} from '../lib/central-access.mjs';
import {createDatabase,DEMO_TENANT_ID,TITAN_TENANT_ID} from '../lib/database.mjs';
import {createApi} from '../lib/http-api.mjs';

const remote1='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',remote2='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const members=[{tenant_id:DEMO_TENANT_ID,status:'active'},{tenant_id:TITAN_TENANT_ID,status:'active'}];
const configuration={baseUrl:'https://access.fanasa.net.local',tokenUrl:'https://sso.fanasa.net.local/realms/fanasa/protocol/openid-connect/token',clientId:'fanasa-contract-service',clientSecret:'test-service-secret',tenantMap:{[DEMO_TENANT_ID]:remote1,[TITAN_TENANT_ID]:remote2}};
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('fresh central decisions revoke access immediately while only the service token is cached',async()=>{
 let allowed=true,tokens=0,decisions=0,time=1000;
 const client=createCentralAccess({...configuration,now:()=>time,fetchImpl:async(url,options)=>{
  assert.equal(options.redirect,'error');
  if(url.pathname.endsWith('/token')){tokens++;assert.equal(options.body.get('client_id'),'fanasa-contract-service');assert.equal(options.body.get('scope'),'platform.catalog');return response({access_token:'service-token',token_type:'Bearer',expires_in:30});}
  assert.equal(options.headers.Authorization,'Bearer service-token');
  if(url.pathname.endsWith('/application-tenants')){assert.equal(url.searchParams.get('subject'),'subject+&');return response([{id:remote1},{id:remote2}]);}
  const body=JSON.parse(options.body);assert.equal(body.permission,'application.access');assert.equal(body.productKey,'neocontract');assert.equal(body.subject,'subject+&');decisions++;return response({allowed:allowed&&body.tenantId===remote1,roles:['platform_admin']});
 }});
 assert.deepEqual(await client.permitted('subject+&',members),[DEMO_TENANT_ID]);
 allowed=false;assert.deepEqual(await client.permitted('subject+&',members),[]);assert.equal(tokens,1);assert.equal(decisions,4);
 time+=30000;await client.permitted('subject+&',members);assert.equal(tokens,2);
});
test('unmapped or disabled local memberships cannot gain access from central admission',async()=>{
 let calls=0;const client=createCentralAccess({...configuration,fetchImpl:async()=>{calls++;throw Error('must not fetch');}});
 assert.deepEqual(await client.permitted('subject',[{tenant_id:DEMO_TENANT_ID,status:'disabled'},{tenant_id:'00000000-0000-0000-0000-000000000009',status:'active'}]),[]);assert.equal(calls,0);
});
test('central outage, redirects, invalid decisions and malformed tenant lists deny access without leaking secrets',async()=>{
 for(const failure of ['network','redirect','html','tenants','decision','oversize']){
  const client=createCentralAccess({...configuration,fetchImpl:async(url)=>{
   if(failure==='network')throw Error('test-service-secret');
   if(failure==='redirect')return new Response('secret',{status:302,headers:{location:'https://other.invalid'}});
   if(url.pathname.endsWith('/token'))return response({access_token:'service-token',token_type:'Bearer',expires_in:60});
   if(failure==='html')return new Response('test-service-secret',{headers:{'Content-Type':'text/html'}});
   if(url.pathname.endsWith('/application-tenants'))return response(failure==='tenants'?[{id:'invalid'}]:[{id:remote1}]);
   return response(failure==='oversize'?{allowed:true,padding:'x'.repeat(270000)}:{allowed:'true'});
  }});
  await assert.rejects(()=>client.permitted('subject',members),e=>e.status===503&&e.code==='central_access_unavailable'&&!e.message.includes('secret'),failure);
 }
});
test('concurrent checks share token acquisition while each membership decision is independent',async()=>{
 let tokens=0,checks=0;
 const client=createCentralAccess({...configuration,fetchImpl:async url=>{
  if(url.pathname.endsWith('/token')){tokens++;await new Promise(r=>setTimeout(r,10));return response({access_token:'token',token_type:'bearer',expires_in:60});}
  if(url.pathname.endsWith('/application-tenants'))return response([{id:remote1}]);
  checks++;return response({allowed:true});
 }});
 await Promise.all([client.permitted('one',members),client.permitted('two',members)]);assert.equal(tokens,1);assert.equal(checks,2);
});
test('configuration cannot silently downgrade TLS or map two local tenants onto one central tenant',()=>{
 assert.equal(centralAccessFromEnv({}),null);
 assert.throws(()=>createCentralAccess({...configuration,baseUrl:'http://access.fanasa.net.local'}));
 assert.throws(()=>createCentralAccess({...configuration,tenantMap:{[DEMO_TENANT_ID]:remote1,[TITAN_TENANT_ID]:remote1}}));
 assert.throws(()=>createCentralAccess({...configuration,tenantMap:{[DEMO_TENANT_ID]:remote1,[TITAN_TENANT_ID]:remote1.toUpperCase()}}));
 assert.throws(()=>centralAccessFromEnv({NEOCONTRACT_ACCESS_ENABLED:'true'}));
});

async function request(api,tenant,method='GET',payload){
 let status,body;const req={url:'/api/'+(method==='GET'?'tenants':'pricing-plans'),method,headers:{host:'localhost','x-auth-request-sub':'demo-admin',...(tenant?{'x-tenant-id':tenant}:{})},socket:{remoteAddress:'127.0.0.1'}};
 if(payload)req[Symbol.asyncIterator]=async function*(){yield Buffer.from(JSON.stringify(payload));};
 await api.handler(req,{writeHead(s){status=s;},end(b){body=b;}});return {status,value:JSON.parse(body)};
}
test('API intersects central admission with local memberships, preserves tenant roles, and refuses outage fallback',{timeout:180000},async()=>{
 process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';const db=await createDatabase({dataDir:'memory://'});let api;
 try{
  const user=(await db.query("SELECT * FROM contracts.app_users WHERE subject='demo-admin'")).rows[0];
  await db.query("UPDATE contracts.app_users SET status='active' WHERE id=$1",[user.id]);
  await db.query("INSERT INTO contracts.app_users(tenant_id,subject,email,display_name,status) VALUES($1,'demo-admin',$2,'Viewer in another tenant','active')",[DEMO_TENANT_ID,user.email]);
  let allow=[TITAN_TENANT_ID,DEMO_TENANT_ID],outage=false;
  const centralAccess={async permitted(subject,rows){assert.equal(subject,'demo-admin');assert.equal(rows.length,2);if(outage){const {AppError}=await import('../lib/domain.mjs');throw new AppError('Unavailable',503,'central_access_unavailable');}return allow;}};
  api=await createApi({database:db,authMode:'oidc-proxy',centralAccess});
  assert.equal((await request(api)).value.tenants.length,2);
  const model={name:'model',bases:[{id:'a',name:'rate',unit:'unit',amount:1}],items:[{id:'a',title:'item',quantity:1,components:[{baseId:'a',coefficient:1}]}]};
  assert.equal((await request(api,DEMO_TENANT_ID,'POST',{model})).status,403,'central entry never grants contract admin');
  assert.equal((await request(api,TITAN_TENANT_ID,'POST',{model})).status,201);
  allow=[DEMO_TENANT_ID];assert.equal((await request(api)).value.tenants.length,1);assert.equal((await request(api,TITAN_TENANT_ID)).status,403);
  outage=true;assert.equal((await request(api)).status,503,'no local fallback on central outage');
  outage=false;allow=[];assert.equal((await request(api)).value.code,'central_access_denied');
 }finally{if(api)await api.close();else await db.close();}
});
