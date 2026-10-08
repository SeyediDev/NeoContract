import {AppError} from './domain.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const unavailable=()=>new AppError('بررسی دسترسی مرکزی به‌موقع انجام نشد؛ دوباره تلاش کنید.',503,'central_access_unavailable');
function httpsUrl(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Central Access requires a credential-free HTTPS URL');
 return url;
}

/** Validate explicit mappings without constructing a service or requesting a token. */
export function validateCentralTenantMap(tenantMap){
 if(!tenantMap||typeof tenantMap!=='object'||Array.isArray(tenantMap))throw new Error('Central tenant mapping is required');
 const entries=Object.entries(tenantMap);
 if(!entries.length||entries.some(([local,remote])=>typeof remote!=='string'||!UUID.test(local)||!UUID.test(remote)))throw new Error('Explicit local-to-central tenant UUID mappings are required');
 const mapping=new Map(entries.map(([local,remote])=>[local.toLowerCase(),remote.toLowerCase()]));
 if(mapping.size!==entries.length||new Set(mapping.values()).size!==mapping.size)throw new Error('Unique local-to-central tenant UUID mappings are required');
 return mapping;
}

// Shared by runtime authorization and the operator's read-only activation check.
// Diagnostic errors contain only a fixed phase/reason and numeric HTTP status.
export function createCentralAccessService({baseUrl,tokenUrl,clientId,clientSecret,fetchImpl=fetch,now=Date.now,timeoutMs=5000}={}){
 const base=httpsUrl(baseUrl),issuer=httpsUrl(tokenUrl);
 if(!clientId||!clientSecret)throw new Error('Central Access service configuration is incomplete');
 let token=null,pendingToken;
 function failure(phase,reason,httpStatus){const error=unavailable();error.diagnostic={phase,reason,...(httpStatus?{httpStatus}:{})};return error;}
 async function jsonResponse(url,options,phase){
  let response;
  try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
  catch{throw failure(phase,'network_or_timeout');}
  async function reject(reason,httpStatus){await response.body?.cancel().catch(()=>{});throw failure(phase,reason,httpStatus);}
  if(!response.ok)return reject('http',response.status);
  if(!response.headers.get('content-type')?.includes('application/json'))return reject('invalid_response');
  // Bound both streamed and declared response sizes; upstream errors are never exposed.
  if(Number(response.headers.get('content-length'))>262144)return reject('invalid_response');
  const chunks=[];let length=0;
  try{
   for await(const chunk of response.body){length+=chunk.byteLength;if(length>262144)throw failure(phase,'invalid_response');chunks.push(chunk);}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw failure(phase,'invalid_response');}
 }
 async function serviceToken(){
  if(token&&token.until>now()+5000)return token.value;
  if(!pendingToken)pendingToken=(async()=>{
   const result=await jsonResponse(issuer,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:'platform.catalog'})},'token');
   if(typeof result?.access_token!=='string'||!result.access_token||result.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(result.expires_in)||result.expires_in<10)throw failure('token','invalid_response');
   token={value:result.access_token,until:now()+Math.min(result.expires_in,3600)*1000};return token.value;
  })().finally(()=>{pendingToken=null;});
  return pendingToken;
 }
 async function headers(){return {Authorization:'Bearer '+await serviceToken(),'Content-Type':'application/json'};}
 async function memberships(subject){
  if(typeof subject!=='string'||!subject||subject.length>200)throw failure('memberships','invalid_subject');
  const url=new URL('/api/platform/application-tenants',base);url.searchParams.set('subject',subject);
  const rows=await jsonResponse(url,{headers:await headers()},'memberships');
  if(!Array.isArray(rows)||rows.length>1000||rows.some(row=>!row||typeof row.id!=='string'||!UUID.test(row.id))||new Set(rows.map(row=>row.id.toLowerCase())).size!==rows.length)throw failure('memberships','invalid_response');
  return new Set(rows.map(row=>row.id.toLowerCase()));
 }
 async function authorize(subject,tenantId,productKey){
  const result=await jsonResponse(new URL('/api/platform/authorize',base),{method:'POST',headers:await headers(),body:JSON.stringify({subject,tenantId,permission:'application.access',productKey})},'authorize');
  if(typeof result?.allowed!=='boolean')throw failure('authorize','invalid_response');
  return result.allowed;
 }
 async function products(subject,tenantId){
  const url=new URL('/api/platform/products',base);url.searchParams.set('subject',subject);url.searchParams.set('tenant',tenantId);
  const rows=await jsonResponse(url,{headers:await headers()},'catalog');
  if(!Array.isArray(rows)||rows.length>1000)throw failure('catalog','invalid_response');
  return rows;
 }
 async function tokenChecks(audience){
  // Claim inspection is diagnostic only. Signature validation belongs to the
  // receiving Access API; passing this check alone never implies readiness.
  try{
   const value=await serviceToken(),parts=value.split('.');
   if(parts.length!==3)throw Error();
   const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
   return {client:claims.azp===clientId,scope:typeof claims.scope==='string'&&claims.scope.split(' ').includes('platform.catalog'),audience:(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(audience),expiry:Number.isFinite(claims.exp)&&claims.exp*1000>now()+5000};
  }catch(error){if(error.diagnostic)throw error;throw failure('token','claims_unavailable');}
 }
 return {memberships,authorize,products,tokenChecks,reset(){token=null;}};
}

export function createCentralAccess({tenantMap,productKey='neocontract',...options}={}){
 const mapping=validateCentralTenantMap(tenantMap);
 if(!/^[a-z][a-z0-9-]{1,80}$/.test(productKey))throw new Error('Central product key is invalid');
 const service=createCentralAccessService(options);
 async function permitted(subject,memberships){
  try{
   if(typeof subject!=='string'||!subject||subject.length>200)throw unavailable();
   const candidates=memberships.filter(m=>m.status==='active'&&mapping.has(m.tenant_id));
   if(!candidates.length)return [];
   const active=await service.memberships(subject);
   const decisions=await Promise.all(candidates.filter(m=>active.has(mapping.get(m.tenant_id))).map(async m=>{
    return await service.authorize(subject,mapping.get(m.tenant_id),productKey)?m.tenant_id:null;
   }));
   return decisions.filter(Boolean);
  }catch{service.reset();throw unavailable();}
 }
 return {permitted,source:'fanasa-access',productKey};
}

export function centralAccessFromEnv(env=process.env){
 if(!env.NEOCONTRACT_ACCESS_ENABLED||env.NEOCONTRACT_ACCESS_ENABLED==='false')return null;
 if(env.NEOCONTRACT_ACCESS_ENABLED!=='true')throw new Error('NEOCONTRACT_ACCESS_ENABLED must be true or false');
 return createCentralAccess({baseUrl:env.FANASA_ACCESS_URL,tokenUrl:env.FANASA_ACCESS_TOKEN_URL,clientId:env.FANASA_ACCESS_CLIENT_ID,clientSecret:env.FANASA_ACCESS_CLIENT_SECRET,tenantMap:JSON.parse(env.NEOCONTRACT_ACCESS_TENANT_MAP||'{}'),productKey:env.FANASA_ACCESS_PRODUCT_KEY||'neocontract'});
}
