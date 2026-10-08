import {createCentralAccessService,validateCentralTenantMap} from './central-access.mjs';

// These are existing local customer workspaces, not central tenant identifiers.
export const CUSTOMER_WORKSPACES=[1,3,4,5].map(n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'));
const workspaceSet=new Set(CUSTOMER_WORKSPACES);

export function validateAdmissionCases(cases){
 if(!Array.isArray(cases)||!cases.length||cases.length>32)throw Error('invalid_cases');
 const pairs=new Set(),coverage=new Set();
 for(const row of cases){
  if(!row||typeof row.subject!=='string'||!row.subject.trim()||row.subject.length>200||!Array.isArray(row.tenantIds)||!row.tenantIds.length||row.tenantIds.length>4||typeof row.allowed!=='boolean')throw Error('invalid_cases');
  for(const id of row.tenantIds){
   if(!workspaceSet.has(id)||pairs.has(row.subject+'\0'+id))throw Error('invalid_cases');
   pairs.add(row.subject+'\0'+id);if(row.allowed)coverage.add(id);
  }
 }
 if(coverage.size!==4)throw Error('incomplete_cases');
 return cases;
}

/** Read-only operator check. No credentials, tokens, subjects or upstream bodies
 * enter its report. Passing this is a prerequisite, not live revoke/restore QA.
 */
export async function checkCentralAccess({env=process.env,cases,readMemberships,fetchImpl=fetch,now=Date.now}={}){
 const checks=[];
 const add=(check,ok,detail={})=>checks.push({check,status:ok?'pass':'fail',...detail});
 const finish=()=>({ready:checks.length>0&&checks.every(c=>c.status==='pass'),activationChanged:false,checks});
 const failed=(error,detail={})=>{
  const d=error?.diagnostic;
  add('upstream',false,{...detail,phase:d?.phase||'unknown',reason:d?.reason||'unavailable',...(Number.isInteger(d?.httpStatus)?{httpStatus:d.httpStatus}:{})});
 };
 add('sso_proxy',env.NEOCONTRACT_AUTH_MODE==='oidc-proxy'&&env.NEOCONTRACT_TRUST_PROXY_AUTH==='true');
 add('tls_validation',env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');
 add('dedicated_identity',env.FANASA_ACCESS_CLIENT_ID==='fanasa-contract-service'&&(env.FANASA_ACCESS_PRODUCT_KEY||'neocontract')==='neocontract');
 if(checks.some(c=>c.status==='fail'))return finish();
 let mapping;
 try{
  mapping=validateCentralTenantMap(JSON.parse(env.NEOCONTRACT_ACCESS_TENANT_MAP||'{}'));
  add('tenant_mapping',mapping.size===4&&CUSTOMER_WORKSPACES.every(id=>mapping.has(id)));
 }catch{add('tenant_mapping',false);}
 try{validateAdmissionCases(cases);add('admission_cases',true);}catch{add('admission_cases',false);}
 // Token errors remain observable even if central tenant provisioning is incomplete.
 let service;
 try{service=createCentralAccessService({baseUrl:env.FANASA_ACCESS_URL,tokenUrl:env.FANASA_ACCESS_TOKEN_URL,clientId:env.FANASA_ACCESS_CLIENT_ID,clientSecret:env.FANASA_ACCESS_CLIENT_SECRET,fetchImpl,now});}
 catch{add('service_configuration',false);return finish();}
 try{
  const claims=await service.tokenChecks('fanasa-access-management-web');
  for(const [key,ok] of Object.entries(claims))add('token_'+key,ok);
 }catch(error){failed(error);return finish();}
 if(checks.some(c=>c.status==='fail'))return finish();
 let local;
 try{local=await readMemberships(cases.map(c=>c.subject),CUSTOMER_WORKSPACES);add('local_database',Array.isArray(local));if(!Array.isArray(local))return finish();}
 catch{add('local_database',false);return finish();}
 for(const [subjectIndex,row] of cases.entries()){
  let active;
  try{active=await service.memberships(row.subject);}catch(error){failed(error,{subjectIndex});continue;}
  for(const tenantId of row.tenantIds){
   const context={subjectIndex,tenantId},remoteId=mapping.get(tenantId);
   const member=local.find(m=>m.subject===row.subject&&m.tenant_id===tenantId&&m.status==='active'&&m.tenant_status==='active');
   if(row.allowed)add('local_membership',Boolean(member),context);
   const centralMember=active.has(remoteId);
   if(!centralMember){add('central_membership',!row.allowed,context);continue;}
   try{
    const allowed=await service.authorize(row.subject,remoteId,'neocontract');
    add('application_admission',allowed===row.allowed,context);
    if(row.allowed){
     const products=await service.products(row.subject,remoteId);
     const matches=products.filter(p=>p?.key==='neocontract'),product=matches[0];
     add('registered_product',matches.length===1&&product.center==='fanasa.rayan'&&product.url==='https://contracts.fanasa.net.local'&&typeof product.owner==='string'&&Boolean(product.owner.trim())&&typeof product.audience==='string'&&Boolean(product.audience.trim())&&typeof product.displayName==='string'&&Boolean(product.displayName.trim()),context);
    }
   }catch(error){failed(error,context);}
  }
 }
 return finish();
}
