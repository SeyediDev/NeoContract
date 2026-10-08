import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCentralAccess,CUSTOMER_WORKSPACES,validateAdmissionCases} from '../lib/central-access-preflight.mjs';

const remote=CUSTOMER_WORKSPACES.map((_,i)=>'aaaaaaaa-aaaa-aaaa-aaaa-'+String(i+1).padStart(12,'0'));
const tenantMap=Object.fromEntries(CUSTOMER_WORKSPACES.map((id,i)=>[id,remote[i]]));
const env={NEOCONTRACT_AUTH_MODE:'oidc-proxy',NEOCONTRACT_TRUST_PROXY_AUTH:'true',NEOCONTRACT_ACCESS_ENABLED:'false',FANASA_ACCESS_URL:'https://access.fanasa.net.local',FANASA_ACCESS_TOKEN_URL:'https://sso.fanasa.net.local/token',FANASA_ACCESS_CLIENT_ID:'fanasa-contract-service',FANASA_ACCESS_CLIENT_SECRET:'never-print-this-secret',NEOCONTRACT_ACCESS_TENANT_MAP:JSON.stringify(tenantMap)};
const cases=[{subject:'never-print-this-subject',tenantIds:CUSTOMER_WORKSPACES,allowed:true}];
const local=CUSTOMER_WORKSPACES.map(tenant_id=>({subject:cases[0].subject,tenant_id,status:'active',tenant_status:'active'}));
const claims={azp:'fanasa-contract-service',scope:'platform.catalog',aud:['fanasa-access-management-web'],exp:100};
const jwt=value=>'e30.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.never-print-this-signature';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const product={key:'neocontract',center:'fanasa.rayan',url:'https://contracts.fanasa.net.local',owner:'owner',audience:'neocontract-web',displayName:'مدیریت قراردادها'};
function options(overrides={}){
 return {env,cases,now:()=>1000,readMemberships:async()=>local,fetchImpl:async(url,init)=>{
  assert.equal(init.redirect,'error');
  if(url.pathname==='/token'){assert.equal(init.body.get('client_id'),'fanasa-contract-service');assert.equal(init.body.get('scope'),'platform.catalog');return json({access_token:jwt(claims),token_type:'Bearer',expires_in:90});}
  assert.equal(init.headers.Authorization,'Bearer '+jwt(claims));
  if(url.pathname.endsWith('/application-tenants')){assert.equal(init.method,undefined);return json(remote.map(id=>({id})));}
  if(url.pathname.endsWith('/authorize')){assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).productKey,'neocontract');return json({allowed:true});}
  assert.equal(url.pathname,'/api/platform/products');assert.equal(init.method,undefined);return json([product]);
 },...overrides};
}
function safe(report){
 const output=JSON.stringify(report);
 for(const secret of [env.FANASA_ACCESS_CLIENT_SECRET,cases[0].subject,'never-print-this-signature','RAW_UPSTREAM_SECRET'])assert.ok(!output.includes(secret));
 assert.equal(report.activationChanged,false);assert.equal(env.NEOCONTRACT_ACCESS_ENABLED,'false');
}

test('preflight checks all four mappings, local and central admission and registered center without activation',async()=>{
 const report=await checkCentralAccess(options());assert.equal(report.ready,true);safe(report);
 assert.equal(report.checks.filter(c=>c.check==='application_admission').length,4);
 assert.equal(report.checks.filter(c=>c.check==='registered_product').length,4);
});

test('incomplete mapping is reported together with token HTTP 400, with no invented central UUIDs or leaked bodies',async()=>{
 let calls=0;
 const report=await checkCentralAccess(options({env:{...env,NEOCONTRACT_ACCESS_TENANT_MAP:JSON.stringify({[CUSTOMER_WORKSPACES[1]]:remote[1]})},fetchImpl:async()=>{calls++;return json({error:'RAW_UPSTREAM_SECRET'},400);}}));
 assert.equal(report.ready,false);assert.equal(calls,1);assert.ok(report.checks.some(c=>c.check==='tenant_mapping'&&c.status==='fail'));
 assert.deepEqual(report.checks.at(-1),{check:'upstream',status:'fail',phase:'token',reason:'http',httpStatus:400});safe(report);
});

test('valid token with API policy rejection reports membership HTTP 403 independently of token acquisition',async()=>{
 const original=options().fetchImpl;
 const report=await checkCentralAccess(options({fetchImpl:(url,init)=>url.pathname==='/token'?original(url,init):json({secret:'RAW_UPSTREAM_SECRET'},403)}));
 assert.equal(report.ready,false);assert.equal(report.checks.at(-1).phase,'memberships');assert.equal(report.checks.at(-1).httpStatus,403);safe(report);
});

test('missing or inactive local membership, missing central membership and explicit admission denial each prevent readiness',async()=>{
 const original=options().fetchImpl;
 for(const kind of ['disabled-local','archived-tenant','absent-local','central-absent','admission-denied']){
  const report=await checkCentralAccess(options({readMemberships:async()=>kind==='absent-local'?[]:local.map(m=>({...m,...(kind==='disabled-local'?{status:'disabled'}:kind==='archived-tenant'?{tenant_status:'archived'}:{})})),fetchImpl:(url,init)=>{
   if(kind==='central-absent'&&url.pathname.endsWith('/application-tenants'))return json([]);
   if(kind==='admission-denied'&&url.pathname.endsWith('/authorize'))return json({allowed:false});
   return original(url,init);
  }}));
  assert.equal(report.ready,false,kind);safe(report);
 }
});

test('catalog mismatch, absent or duplicate product registrations prevent readiness',async()=>{
 const original=options().fetchImpl;
 for(const products of [[],[product,product],[{...product,center:'fanasa.other'}],[{...product,url:'https://other.invalid'}],[{...product,owner:''}],[null]]){
  const report=await checkCentralAccess(options({fetchImpl:(url,init)=>url.pathname.endsWith('/products')?json(products):original(url,init)}));
  assert.equal(report.ready,false);safe(report);
 }
});

test('token claim checks are diagnostic prerequisites and cannot replace authenticated API checks',async()=>{
 const original=options().fetchImpl;
 for(const change of [{scope:'platform.contracts'},{aud:'wrong-api'},{azp:'fanasa-unified-portal-service'},{exp:0}]){
  let apiCalls=0;
  const report=await checkCentralAccess(options({fetchImpl:(url,init)=>{
   if(url.pathname==='/token')return json({access_token:jwt({...claims,...change}),token_type:'bearer',expires_in:90});
   apiCalls++;return original(url,init);
  }}));
  assert.equal(report.ready,false);assert.equal(apiCalls,0);safe(report);
 }
});

test('preflight rejects reused clients, insecure settings, invalid mapping and incomplete case coverage',async()=>{
 for(const change of [{FANASA_ACCESS_CLIENT_ID:'fanasa-unified-portal-service'},{FANASA_ACCESS_PRODUCT_KEY:'other'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{NEOCONTRACT_AUTH_MODE:'local-demo'},{NEOCONTRACT_TRUST_PROXY_AUTH:'false'},{FANASA_ACCESS_URL:'http://access.invalid'},{NEOCONTRACT_ACCESS_TENANT_MAP:JSON.stringify({...tenantMap,[CUSTOMER_WORKSPACES[0]]:remote[1]})}]){
  const report=await checkCentralAccess(options({env:{...env,...change}}));assert.equal(report.ready,false);safe(report);
 }
 assert.throws(()=>validateAdmissionCases([{...cases[0],tenantIds:[CUSTOMER_WORKSPACES[0]]}]));
 assert.throws(()=>validateAdmissionCases([...cases,...cases]));
 assert.throws(()=>validateAdmissionCases([{...cases[0],tenantIds:[...CUSTOMER_WORKSPACES,'00000000-0000-0000-0000-000000000002']}]));
});

test('database errors, malformed upstream replies and network failures remain sanitized and cannot pass',async()=>{
 const report=await checkCentralAccess(options({readMemberships:async()=>{throw Error('RAW_UPSTREAM_SECRET');}}));assert.equal(report.ready,false);safe(report);
 const original=options().fetchImpl;
 for(const fail of ['network','oversize','schema','malformed-token']){
  const report=await checkCentralAccess(options({fetchImpl:(url,init)=>{
   if(fail==='network')throw Error('RAW_UPSTREAM_SECRET');
   if(fail==='malformed-token')return json(null);
   if(url.pathname==='/token')return original(url,init);
   if(fail==='oversize')return json({secret:'RAW_UPSTREAM_SECRET',padding:'x'.repeat(270000)});
   return json([{id:'RAW_UPSTREAM_SECRET'}]);
  }}));assert.equal(report.ready,false,fail);safe(report);
 }
});

test('explicit negative admission cases must be denied centrally, not masked by local membership status',async()=>{
 const more=[...cases,{subject:'denied-subject',tenantIds:[CUSTOMER_WORKSPACES[0]],allowed:false}],original=options().fetchImpl;
 for(const denied of [true,false]){
  const report=await checkCentralAccess(options({cases:more,fetchImpl:(url,init)=>{
   if(url.pathname.endsWith('/authorize')&&JSON.parse(init.body).subject==='denied-subject')return json({allowed:!denied});
   return original(url,init);
  }}));assert.equal(report.ready,denied);safe(report);
 }
});
