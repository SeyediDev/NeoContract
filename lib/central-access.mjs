import {AppError} from './domain.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const unavailable=()=>new AppError('بررسی دسترسی مرکزی به‌موقع انجام نشد؛ دوباره تلاش کنید.',503,'central_access_unavailable');
function httpsUrl(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Central Access requires a credential-free HTTPS URL');
 return url;
}

/** Service credentials stay server-side. Only the service token is cached;
 * memberships and application grants are read afresh on every request.
 */
export function createCentralAccess({baseUrl,tokenUrl,clientId,clientSecret,tenantMap,productKey='neocontract',fetchImpl=fetch,now=Date.now,timeoutMs=5000}={}){
 const base=httpsUrl(baseUrl),issuer=httpsUrl(tokenUrl);
 if(!clientId||!clientSecret||!tenantMap||typeof tenantMap!=='object'||Array.isArray(tenantMap))throw new Error('Central Access service configuration is incomplete');
 const entries=Object.entries(tenantMap);
 if(!entries.length||entries.some(([local,remote])=>typeof remote!=='string'||!UUID.test(local)||!UUID.test(remote)))throw new Error('Explicit local-to-central tenant UUID mappings are required');
 const mapping=new Map(entries.map(([local,remote])=>[local.toLowerCase(),remote.toLowerCase()]));
 if(mapping.size!==entries.length||new Set(mapping.values()).size!==mapping.size)throw new Error('Unique local-to-central tenant UUID mappings are required');
 if(!/^[a-z][a-z0-9-]{1,80}$/.test(productKey))throw new Error('Central product key is invalid');
 let token=null,pendingToken;
 async function jsonResponse(url,options){
  const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw unavailable();
  // Bound both streamed and declared response sizes; upstream errors are never exposed.
  if(Number(response.headers.get('content-length'))>262144)throw unavailable();
  const chunks=[];let length=0;
  for await(const chunk of response.body){length+=chunk.byteLength;if(length>262144){await response.body.cancel().catch(()=>{});throw unavailable();}chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async function serviceToken(){
  if(token&&token.until>now()+5000)return token.value;
  if(!pendingToken)pendingToken=(async()=>{
   const result=await jsonResponse(issuer,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:'platform.catalog'})});
   if(typeof result.access_token!=='string'||!result.access_token||result.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(result.expires_in)||result.expires_in<10)throw unavailable();
   token={value:result.access_token,until:now()+Math.min(result.expires_in,3600)*1000};return token.value;
  })().finally(()=>{pendingToken=null;});
  return pendingToken;
 }
 async function permitted(subject,memberships){
  try{
   if(typeof subject!=='string'||!subject||subject.length>200)throw unavailable();
   const candidates=memberships.filter(m=>m.status==='active'&&mapping.has(m.tenant_id));
   if(!candidates.length)return [];
   const bearer=await serviceToken(),headers={Authorization:'Bearer '+bearer,'Content-Type':'application/json'};
   const url=new URL('/api/platform/application-tenants',base);url.searchParams.set('subject',subject);
   const rows=await jsonResponse(url,{headers});
   if(!Array.isArray(rows)||rows.length>1000||rows.some(row=>!row||typeof row.id!=='string'||!UUID.test(row.id))||new Set(rows.map(row=>row.id.toLowerCase())).size!==rows.length)throw unavailable();
   const active=new Set(rows.map(row=>row.id.toLowerCase()));
   const decisions=await Promise.all(candidates.filter(m=>active.has(mapping.get(m.tenant_id))).map(async m=>{
    const result=await jsonResponse(new URL('/api/platform/authorize',base),{method:'POST',headers,body:JSON.stringify({subject,tenantId:mapping.get(m.tenant_id),permission:'application.access',productKey})});
    if(typeof result.allowed!=='boolean')throw unavailable();
    return result.allowed?m.tenant_id:null;
   }));
   return decisions.filter(Boolean);
  }catch{token=null;throw unavailable();}
 }
 return {permitted,source:'fanasa-access',productKey};
}

export function centralAccessFromEnv(env=process.env){
 if(!env.NEOCONTRACT_ACCESS_ENABLED||env.NEOCONTRACT_ACCESS_ENABLED==='false')return null;
 if(env.NEOCONTRACT_ACCESS_ENABLED!=='true')throw new Error('NEOCONTRACT_ACCESS_ENABLED must be true or false');
 return createCentralAccess({baseUrl:env.FANASA_ACCESS_URL,tokenUrl:env.FANASA_ACCESS_TOKEN_URL,clientId:env.FANASA_ACCESS_CLIENT_ID,clientSecret:env.FANASA_ACCESS_CLIENT_SECRET,tenantMap:JSON.parse(env.NEOCONTRACT_ACCESS_TENANT_MAP||'{}'),productKey:env.FANASA_ACCESS_PRODUCT_KEY||'neocontract'});
}
