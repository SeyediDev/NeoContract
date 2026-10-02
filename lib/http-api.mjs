import { createDatabase, DEMO_TENANT_ID, TITAN_TENANT_ID } from './database.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createStore } from './store.mjs';
import { createIntegrations } from './integrations.mjs';
import { AppError, documentHtml } from './domain.mjs';

function send(res,status,value,headers={}) {const body=typeof value==='string'?value:JSON.stringify(value);res.writeHead(status,{'Content-Type':typeof value==='string'?'text/html; charset=utf-8':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(body);}
async function readBody(req){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw new AppError('حجم درخواست بیش از حد مجاز است.',413);chunks.push(chunk);}if(!bytes)return {};try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError('بدنه JSON معتبر نیست.');}}
function safeError(error){if(error instanceof AppError)return error;if(['23001','23503','23505','23514','22P02'].includes(error.code))return new AppError(['23001','23503'].includes(error.code)?'رکورد به داده دیگری وابسته است یا رابطه معتبر نیست.':error.code==='23505'?'رکورد یا شماره نسخه تکراری است.':'داده با قواعد ذخیره‌سازی سازگار نیست.',409);return new AppError('عملیات انجام نشد. جزئیات اتصال یا داده را بررسی کنید.',500,'internal');}

export async function createApi({database,dataDir,connectionString,seed=true,tenantId=DEMO_TENANT_ID,integrationOptions={},tenantIntegrationOptions={},tenantTokens,authMode,defaultTenant=process.env.NEOCONTRACT_DEFAULT_TENANT||TITAN_TENANT_ID}={}){
 const credentials=tenantTokens??JSON.parse(process.env.NEOCONTRACT_TENANT_TOKENS||'{}');
 const entries=Object.entries(credentials);
 const mode=authMode||process.env.NEOCONTRACT_AUTH_MODE||(process.env.NODE_ENV==='production'||entries.length?'authenticated':'local-demo');
 if(!['authenticated','oidc-proxy','local-demo'].includes(mode))throw new Error('Invalid NEOCONTRACT auth mode');
 if(mode==='oidc-proxy'&&process.env.NEOCONTRACT_TRUST_PROXY_AUTH!=='true')throw new Error('oidc-proxy mode requires NEOCONTRACT_TRUST_PROXY_AUTH=true');
 if(process.env.NODE_ENV==='production'&&mode==='local-demo')throw new Error('Local demo authentication is disabled in production');
 if(mode==='local-demo'&&entries.length)throw new Error('Configured tenant credentials cannot run in local-demo mode');
 const hashes=new Map();
 for(const [id,token] of entries){if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)||typeof token!=='string'||token.length<32)throw new Error('Tenant credentials require a UUID and a token of at least 32 characters');const hash=createHash('sha256').update(token).digest();if([...hashes.values()].some(x=>timingSafeEqual(x,hash)))throw new Error('Each tenant must have a unique API credential');hashes.set(id.toLowerCase(),hash);}
 const db=database||await createDatabase({dataDir,connectionString,seed});
 const contexts=new Map();
 function context(id){if(!contexts.has(id)){const store=createStore(db,id);const options=id===DEMO_TENANT_ID?integrationOptions:(tenantIntegrationOptions[id]||{fetchCatalog:integrationOptions.fetchCatalog});contexts.set(id,{store,integrations:createIntegrations(store,options)});}return contexts.get(id);}
 const {store,integrations}=context(tenantId);
 async function authorize(req,kind){
  let permitted=null;
  let identity=null;
  if(mode==='authenticated'){
   const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||'');
   if(!match)throw new AppError('احراز هویت این تننت لازم است.',401,'unauthorized');
   const candidate=createHash('sha256').update(match[1]).digest();permitted=[...hashes].filter(([,hash])=>timingSafeEqual(candidate,hash)).map(([id])=>id);
   if(!permitted.length)throw new AppError('اعتبار دسترسی معتبر نیست.',401,'unauthorized');
  }else if(mode==='oidc-proxy'){
   const subject=String(req.headers['x-auth-request-sub']||req.headers['x-auth-request-user']||'').trim();
   const email=String(req.headers['x-auth-request-email']||'').trim().toLowerCase();
   if(!subject&&!email)throw new AppError('ورود سازمانی فن‌آسا لازم است.',401,'unauthorized');
   const user=(await db.query('SELECT u.id,u.tenant_id,u.subject,u.email,u.display_name,u.status,COALESCE(jsonb_agg(r.role_key) FILTER (WHERE r.role_key IS NOT NULL),\'[]\'::jsonb) AS roles FROM contracts.app_users u LEFT JOIN contracts.app_user_roles ur ON ur.tenant_id=u.tenant_id AND ur.user_id=u.id LEFT JOIN contracts.app_roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id WHERE (u.subject=$1 OR ($2<>\'\' AND lower(u.email)=lower($2))) GROUP BY u.id',[subject,email])).rows[0];
   if(!user||user.status!=='active')throw new AppError('کاربر در NeoContract فعال نشده است.',403,'user_disabled');
   identity={id:user.id,tenantId:user.tenant_id,subject:user.subject,email:user.email,name:user.display_name,roles:Array.isArray(user.roles)?user.roles:[]};
   permitted=[user.tenant_id];
  }else{
   const address=req.socket?.remoteAddress;
   let hostname;try{hostname=new URL(`http://${req.headers.host}`).hostname;}catch{}
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)||!['localhost','127.0.0.1','[::1]'].includes(hostname))throw new AppError('حالت آزمایشی فقط روی میزبان محلی در دسترس است.',403,'local_only');
  }
  const requested=req.headers['x-tenant-id']||(permitted?.[0])||(kind==='tenants'?defaultTenant:tenantId);
  if(typeof requested!=='string'||!requested||requested.length>100)throw new AppError('شناسه تننت معتبر نیست.',400,'invalid_tenant');
  // Check the credential boundary before lookup, so foreign tenant existence is not disclosed.
  if(permitted&&!permitted.includes(requested))throw new AppError('اجازه دسترسی به این تننت وجود ندارد.',403,'tenant_forbidden');
  const tenant=(await db.query('SELECT id,slug,name,status FROM contracts.tenants WHERE id::text=$1 OR slug=$1',[requested])).rows[0];
  if(!tenant||tenant.status!=='active')throw new AppError('تننت فعال یافت نشد.',404,'tenant_not_found');
  if(identity&&identity.tenantId!==tenant.id)throw new AppError('کاربر به این فضای کاری دسترسی ندارد.',403,'tenant_forbidden');
  return {tenant,permitted,identity,...context(tenant.id)};
 }
 async function handler(req,res){
  const pathname=(req.url||'/').split('?')[0];if(!pathname.startsWith('/api/'))return false;
  try{
   const origin=req.headers.origin;
   if(origin){let host;try{host=new URL(origin).host;}catch{throw new AppError('مبدأ درخواست معتبر نیست.',403);}if(host!==req.headers.host)throw new AppError('درخواست باید از همین سامانه ارسال شود.',403);}
   const method=req.method;const parts=pathname.slice(5).split('/').filter(Boolean);const [kind,id,action]=parts;
   const {tenant,permitted,identity,store,integrations}=await authorize(req,kind);
   if(identity&&['POST','PUT','PATCH','DELETE'].includes(method)){
    const roles=new Set(identity.roles);const privileged=roles.has('platform_admin')||roles.has('contract_admin');
    const allowed=privileged||(roles.has('account_manager')&&['customers','contracts','amendments'].includes(kind))||((roles.has('legal_reviewer')||roles.has('finance_reviewer'))&&kind==='contracts'&&action==='advance');
    if(!allowed)throw new AppError('نقش کاربر اجازه تغییر این داده را ندارد.',403,'role_forbidden');
   }
   const input=['POST','PUT','PATCH'].includes(method)?await readBody(req):{};
   let result,status=200;
   if(method==='GET'&&kind==='tenants')result={tenants:(await db.query("SELECT id,slug,name,status FROM contracts.tenants WHERE status='active' AND ($1::uuid[] IS NULL OR id=ANY($1::uuid[])) ORDER BY slug",[permitted])).rows,activeTenant:tenant,mode,requiresTenantCredential:mode==='authenticated'};
   else if(method==='GET'&&kind==='health')result=await db.health(tenant.id);
   else if(method==='GET'&&kind==='bootstrap')result={...await store.bootstrap(),tenant,access:{mode,requiresTenantCredential:mode==='authenticated',identity:identity?{id:identity.id,email:identity.email,name:identity.name,roles:identity.roles}:null}};
   else if(method==='GET'&&kind==='titan'&&id==='board'){const {getTitanBoard}=await import('./titan-board.mjs');result=await getTitanBoard(store);}
   else if(method==='GET'&&kind==='catalog')result=await store.catalog();
   else if(method==='GET'&&kind==='settings')result=await store.settings();
   else if(method==='PUT'&&kind==='settings')result=await store.saveSettings(input);
   else if(kind==='users'){
    if(!identity?.roles?.some(role=>['platform_admin','contract_admin'].includes(role)))throw new AppError('فقط مدیر سامانه یا مدیر قرارداد می‌تواند کاربران را مدیریت کند.',403,'role_forbidden');
    if(method==='GET'&&!id){
     result={users:(await db.query("SELECT u.id,u.subject,u.email,u.display_name,u.status,u.last_login_at,u.created_at,COALESCE(jsonb_agg(r.role_key ORDER BY r.role_key) FILTER (WHERE r.role_key IS NOT NULL),'[]'::jsonb) AS roles FROM contracts.app_users u LEFT JOIN contracts.app_user_roles ur ON ur.tenant_id=u.tenant_id AND ur.user_id=u.id LEFT JOIN contracts.app_roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id WHERE u.tenant_id=$1 GROUP BY u.id ORDER BY u.display_name",[tenant.id])).rows,roles:(await db.query('SELECT role_key,label,description FROM contracts.app_roles WHERE tenant_id=$1 ORDER BY role_key',[tenant.id])).rows};
    }else if(method==='PATCH'&&id){
     if(!['active','disabled'].includes(input.status))throw new AppError('وضعیت کاربر معتبر نیست.',400,'invalid_status');
     const roleKeys=Array.isArray(input.roles)?[...new Set(input.roles.filter(x=>typeof x==='string'))]:null;
     if(roleKeys){const available=(await db.query('SELECT role_key FROM contracts.app_roles WHERE tenant_id=$1 AND role_key=ANY($2::text[])',[tenant.id,roleKeys])).rows.map(x=>x.role_key);if(available.length!==roleKeys.length)throw new AppError('یکی از نقش‌های انتخاب‌شده معتبر نیست.',400,'invalid_role');}
     await db.query('UPDATE contracts.app_users SET status=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3',[input.status,tenant.id,id]);
     if(roleKeys){await db.query('DELETE FROM contracts.app_user_roles WHERE tenant_id=$1 AND user_id=$2',[tenant.id,id]);if(roleKeys.length)await db.query('INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key=ANY($3::text[])',[tenant.id,id,roleKeys]);}
     result=(await db.query('SELECT id,subject,email,display_name,status,last_login_at FROM contracts.app_users WHERE tenant_id=$1 AND id=$2',[tenant.id,id])).rows[0];
     if(!result)throw new AppError('کاربر یافت نشد.',404,'user_not_found');
    }
   }
   else if(['customers','managers'].includes(kind)){
    if(method==='GET')result=await store[kind]();
    else if(method==='POST'&&!id){result=await store[kind==='customers'?'saveCustomer':'saveManager'](input);status=201;}
    else if(method==='PUT'&&id)result=await store[kind==='customers'?'saveCustomer':'saveManager'](input,id);
    else if(method==='DELETE'&&id)result=await store.removeEntity(kind,id);
   }
   else if(kind==='templates'){
    if(method==='GET')result=await store.templates();
    else if(method==='POST'&&!id){result=await store.saveTemplate(input);status=201;}
    else if(method==='PUT'&&id)result=await store.saveTemplate(input,id);
    else if(method==='POST'&&id&&['publish','archive'].includes(action))result=await store.templateAction(id,action,input);
    else if(method==='DELETE'&&id)result=await store.templateAction(id,'archive');
   }
   else if(kind==='contracts'){
    if(method==='POST'&&id==='preview')result=await store.preview(input);
    else if(method==='POST'&&!id){result=await store.createContract(input);status=201;}
    else if(method==='GET'&&!id)result=await store.contracts();
    else if(method==='GET'&&id&&action==='document'){const c=await store.contract(id);send(res,200,documentHtml(c),{'Content-Disposition':`inline; filename="${c.number}.html"`});return true;}
    else if(method==='GET'&&id)result=await store.contract(id);
    else if(method==='POST'&&action==='advance')result=await store.advance(id,input);
    else if(method==='POST'&&action==='amendments')result=await store.amend(id,input);
    else if(method==='POST'&&action==='neo-sync')result=await integrations.syncContract(id);
   }
   else if(kind==='amendments'&&method==='POST')result=await store.amend(input.contractId,input);
   else if(kind==='integrations'){
    if(method==='GET'&&!id)result=await integrations.status();
    else if(method==='POST'&&id==='neo'&&action==='run')result=input.contractId?await integrations.syncContract(input.contractId):await integrations.neoHealth();
    else if(method==='POST'&&id==='sync'&&action==='run')result=await integrations.runImport();
    else if(method==='POST'&&id==='sync'&&action==='approve')result=await integrations.approveImport(input.importId);
   }
   if(result===undefined)throw new AppError('مسیر یا روش درخواست پشتیبانی نمی‌شود.',404,'not_found');
   send(res,status,result);
  }catch(error){const e=safeError(error);if(e.status===500)console.error('NeoContract API error:',error.code||error.name,error.message);if(!res.headersSent)send(res,e.status,{error:e.message,code:e.code});else res.end();}
  return true;
 }
 return {db,store,integrations,handler,close:()=>db.close()};
}
