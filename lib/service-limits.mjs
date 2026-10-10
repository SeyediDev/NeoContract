import {randomUUID,createHash} from 'node:crypto';
import {AppError,text,requireValue} from './domain.mjs';
import {extractServiceLimits} from '../public/service-limit-extraction.js';
const check=(ok,msg,status=400)=>requireValue(ok,msg,status);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const serviceLimitHash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
const key=(v,label)=>{check(typeof v==='string'&&/^[a-z][a-z0-9.-]{0,63}$/.test(v),label+' معتبر نیست.');return v;};
const instant=(v,label)=>{check(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,label+' باید تاریخ و ساعت معتبر UTC باشد.');return v;};
const day=(v,label)=>{const d=new Date(v+'T00:00:00Z');check(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(+d)&&d.toISOString().slice(0,10)===v,label+' معتبر نیست.');return v;};
export function validateServiceTerms(p){
 check(p&&typeof p==='object'&&!Array.isArray(p),'اطلاعات محدودیت معتبر نیست.');
 check(Object.keys(p).every(k=>['serviceKey','title','productKey','environment','operationGroup','requestsPerSecond','burstCapacity','monthlyRequests','validFrom','validTo','effectiveAt','sourceKind','amendmentId','sourceHash','clauseQuote','confirmRequestMeter'].includes(k)),'پارامتر ناشناخته در محدودیت سرویس وجود دارد.');
 const requestsPerSecond=p.requestsPerSecond,burstCapacity=p.burstCapacity,monthlyRequests=p.monthlyRequests;
 check(typeof requestsPerSecond==='number'&&Number.isFinite(requestsPerSecond)&&requestsPerSecond>0&&requestsPerSecond<=1000000,'TPS مثبت و حداکثر یک میلیون لازم است.');
 check(Number.isSafeInteger(burstCapacity)&&burstCapacity>0,'ظرفیت burst باید عدد صحیح مثبت باشد.');
 check(Number.isSafeInteger(monthlyRequests)&&monthlyRequests>=0,'سهمیه ماهانه باید عدد صحیح نامنفی باشد؛ صفر یعنی منع مصرف.');
 check(p.confirmRequestMeter===true,'تأیید نگاشت TPS به شمارش درخواست‌های پذیرفته‌شده API لازم است.');
 const validFrom=instant(p.validFrom,'شروع اعتبار'),validTo=instant(p.validTo,'پایان اعتبار'),effectiveAt=instant(p.effectiveAt,'زمان اثر');
 check(validFrom<validTo&&effectiveAt>=validFrom&&effectiveAt<validTo,'بازه اعتبار و زمان اثر ناسازگار است.');
 check(['contract','amendment'].includes(p.sourceKind),'منبع محدودیت معتبر نیست.');
 check(typeof p.sourceHash==='string'&&/^[a-f0-9]{64}$/.test(p.sourceHash),'اثر انگشت منبع لازم است.');
 return {serviceKey:key(p.serviceKey,'کلید سرویس'),title:text(p.title,'عنوان سرویس',{max:200}),productKey:key(p.productKey,'کلید محصول'),environment:key(p.environment,'محیط'),operationGroup:key(p.operationGroup,'گروه عملیات'),requestsPerSecond,burstCapacity,monthlyRequests,validFrom,validTo,effectiveAt,meter:'api.request.admitted',unit:'request',source:{kind:p.sourceKind,amendmentId:p.sourceKind==='amendment'?text(p.amendmentId,'شناسه الحاقیه',{max:100}):null,sha256:p.sourceHash,clauseQuote:text(p.clauseQuote,'بند مستند محدودیت',{max:4000})}};
}
export function serviceLimitCurrent(state,{now=new Date().toISOString(),executionStatus='running'}={}){
 if(executionStatus!=='running')return [];
 const current=new Map();for(const v of state?.versions||[]){if(v.status!=='signed'||v.terms.effectiveAt>now)continue;const before=current.get(v.terms.serviceKey);if(!before||v.version>before.version)current.set(v.terms.serviceKey,v);}
 return [...current.values()].filter(v=>v.terms.validFrom<=now&&now<v.terms.validTo);
}
export function createServiceLimitStore(db,tenantId){
 const contractRow=async(tx,id)=>{const c=(await tx.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows[0];check(c,'قرارداد یافت نشد.',404);return c;};
 async function source(tx,c,kind,amendmentId){
  if(kind==='amendment'){const a=(await tx.query('SELECT * FROM contracts.contract_amendments WHERE tenant_id=$1 AND contract_id=$2 AND id=$3',[tenantId,c.id,amendmentId])).rows[0];check(a,'الحاقیه یافت نشد.',404);return {document:a.summary||'',id:a.id,status:a.status};}
  const docs=(await tx.query("SELECT metadata FROM contracts.contract_documents WHERE tenant_id=$1 AND contract_id=$2 AND document_type='proposal_revision' ORDER BY version_no DESC,uploaded_at DESC LIMIT 1",[tenantId,c.id])).rows;
  return {document:docs[0]?.metadata?.body||c.template_snapshot?.document||'',id:c.id,status:c.status};
 }
 async function extraction(id,{sourceKind='contract',amendmentId}={}){check(['contract','amendment'].includes(sourceKind),'منبع معتبر نیست.');let result;await db.transaction(async tx=>{const c=await contractRow(tx,id),s=await source(tx,c,sourceKind,amendmentId);result={...extractServiceLimits(s.document),source:{kind:sourceKind,id:s.id,sha256:serviceLimitHash(s.document),status:s.status},document:s.document};});return result;}
 async function read(id){
  const c=(await db.query('SELECT id FROM contracts.contracts WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];check(c,'قرارداد یافت نشد.',404);
  const row=(await db.query('SELECT * FROM contracts.contract_service_limits WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0];
  const execution=(await db.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0]?.state;
  const outbox=(await db.query('SELECT event_id,version_id,aggregate_version,effective_at,status,attempts,last_attempt_at,receipt,error_code,dispatch_sha256,dispatch_registry_reference FROM contracts.service_limit_outbox WHERE tenant_id=$1 AND contract_id=$2 ORDER BY aggregate_version',[tenantId,id])).rows;
  const current=serviceLimitCurrent(row?.state,{executionStatus:execution?.status||'not-started'});
  return {revision:row?.revision||0,versions:row?.state?.versions||[],current,executionStatus:execution?.status||'not-started',outbox,gatewayApplied:current.length>0&&current.every(v=>outbox.some(o=>o.version_id===v.id&&o.status==='acknowledged'))};
 }
 async function command(id,input,actor=null){
  check(!actor||actor.tenantId===tenantId,'اجازه دسترسی به این تننت وجود ندارد.',403);
  check(input&&['draft','sign','cancel'].includes(input.action),'اقدام محدودیت معتبر نیست.');
  const roles=actor?.roles||['contract_admin'],admin=roles.some(r=>['contract_admin','platform_admin'].includes(r));
  check(admin||(input.action==='sign'?roles.includes('legal_reviewer'):roles.includes('account_manager')),'نقش شما اجازه این اقدام را ندارد.',403);
  check(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'نسخه مورد انتظار لازم است.');
  const requestKey=text(input.idempotencyKey,'کلید درخواست',{max:120}),p=input.payload;check(p&&typeof p==='object'&&!Array.isArray(p),'محتوای اقدام معتبر نیست.');
  const who=actor?{id:actor.id,subject:actor.subject,name:actor.name,email:actor.email}:null;
  const hash=serviceLimitHash({action:input.action,payload:p,expectedRevision:input.expectedRevision,subject:who?.subject||null});
  await db.transaction(async tx=>{
   const c=await contractRow(tx,id),receipt=(await tx.query('SELECT request_hash FROM contracts.service_limit_commands WHERE tenant_id=$1 AND contract_id=$2 AND request_key=$3',[tenantId,id,requestKey])).rows[0];
   if(receipt){check(receipt.request_hash===hash,'کلید درخواست برای محتوای دیگری استفاده شده است.',409);return;}
   const row=(await tx.query('SELECT * FROM contracts.contract_service_limits WHERE tenant_id=$1 AND contract_id=$2 FOR UPDATE',[tenantId,id])).rows[0];check((row?.revision||0)===input.expectedRevision,'محدودیت سرویس تغییر کرده است؛ آخرین نسخه را دریافت کنید.',409);
   const state=row?.state||{versions:[]},at=new Date().toISOString(),revision=(row?.revision||0)+1;let outbound=null;
   if(input.action==='draft'){
    const terms=validateServiceTerms(p),s=await source(tx,c,terms.source.kind,terms.source.amendmentId);check(serviceLimitHash(s.document)===terms.source.sha256,'متن منبع تغییر کرده است؛ استخراج را بازخوانی کنید.',409);check(s.document.includes(terms.source.clauseQuote),'بند مستند در متن منبع وجود ندارد.');
    const prior=state.versions.filter(v=>v.terms.serviceKey===terms.serviceKey&&v.status==='signed').at(-1);
    check(!prior||terms.source.kind==='amendment','تغییر محدودیت امضاشده فقط با الحاقیه مجاز است.',409);
    if(prior){check(prior.terms.productKey===terms.productKey&&prior.terms.environment===terms.environment&&prior.terms.operationGroup===terms.operationGroup,'اصلاح نرخ نمی‌تواند هویت یا محدوده تخصیص را عوض کند.');check(terms.effectiveAt>prior.terms.effectiveAt,'تاریخ اثر اصلاحیه باید پس از نسخه قبلی باشد.');}
    if(terms.source.kind==='amendment')check(['approved','signed'].includes(s.status),'الحاقیه باید بازبینی و تأیید شده باشد.',409);
    check(!state.versions.some(v=>v.status==='draft'&&v.terms.serviceKey===terms.serviceKey),'ابتدا پیش‌نویس باز این سرویس را تعیین تکلیف کنید.',409);
    state.versions.push({id:randomUUID(),version:state.versions.length+1,status:'draft',terms,createdAt:at,actor:who});
   }else{
    const v=state.versions.find(v=>v.id===p.versionId);check(v,'نسخه محدودیت یافت نشد.',404);check(v.status==='draft','این نسخه دیگر پیش‌نویس نیست.',409);
    if(input.action==='cancel'){v.status='cancelled';v.cancellation={reference:text(p.reference,'مرجع لغو',{max:500}),comment:text(p.comment,'علت لغو',{max:2000}),actor:who,at};}
    else{
     const exec=(await tx.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2 FOR UPDATE',[tenantId,id])).rows[0]?.state;check(exec?.status==='running','ثبت مبنای امضاشده و اجرای فعال قرارداد لازم است.',409);check(p.confirmSigned===true,'تأیید امضای طرفین لازم است.');
     const s=await source(tx,c,v.terms.source.kind,v.terms.source.amendmentId);check(serviceLimitHash(s.document)===v.terms.source.sha256,'منبع پیش‌نویس تغییر کرده است.',409);if(v.terms.source.kind==='amendment')check(['approved','signed'].includes(s.status),'الحاقیه مجاز به اعمال نیست.',409);
     const prior=state.versions.filter(x=>x.status==='signed'&&x.terms.serviceKey===v.terms.serviceKey).at(-1);check(!prior||v.terms.source.kind==='amendment'&&v.terms.effectiveAt>prior.terms.effectiveAt,'نسخه پیش‌نویس بر مبنای جاری نیست.',409);
     check(!prior||prior.terms.source.amendmentId!==v.terms.source.amendmentId,'برای اصلاح تازه، الحاقیه تازه لازم است.',409);
     v.signature={reference:text(p.reference,'مرجع مدرک امضا',{max:500}),counterparties:text(p.counterparties,'امضاکنندگان طرفین',{max:1000}),signedDate:day(p.signedDate,'تاریخ امضا'),actor:who,recordedAt:at};
     const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));check(v.signature.signedDate<=today,'تاریخ امضای مدرک نمی‌تواند در آینده باشد.');
     const effectiveDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v.terms.effectiveAt));check(v.signature.signedDate<=effectiveDay,'تاریخ امضا پس از تاریخ اثر است.');
     const begin=new Date(exec.basis.startDate+'T00:00:00+03:30').toISOString(),finish=new Date(+new Date(exec.endDate+'T00:00:00+03:30')+86400000).toISOString();check(v.terms.validFrom>=begin&&v.terms.validTo<=finish,'بازه سرویس باید در بازه قرارداد امضاشده باشد.');v.status='signed';
     const eventId='nc-'+randomUUID();outbound={schemaVersion:'1.0.0',eventType:'contract.service-limits.signed',eventId,producer:'fanasa-contracts',occurredAt:at,correlationId:'nc-'+randomUUID(),aggregateVersion:revision,localTenantId:tenantId,contractId:id,versionId:v.id,contractServiceVersion:v.version,terms:v.terms,signature:v.signature,sourceExecutionReference:exec.basis.reference};
    }
   }
   if(row)await tx.query('UPDATE contracts.contract_service_limits SET revision=$3,state=$4,updated_at=now() WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id,revision,JSON.stringify(state)]);else await tx.query('INSERT INTO contracts.contract_service_limits(tenant_id,contract_id,revision,state) VALUES($1,$2,$3,$4)',[tenantId,id,revision,JSON.stringify(state)]);
   await tx.query('INSERT INTO contracts.service_limit_commands(tenant_id,contract_id,request_key,request_hash,revision,action,payload,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenantId,id,requestKey,hash,revision,input.action,JSON.stringify(p),JSON.stringify(who)]);
   if(outbound)await tx.query('INSERT INTO contracts.service_limit_outbox(event_id,tenant_id,contract_id,version_id,aggregate_version,effective_at,payload,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[outbound.eventId,tenantId,id,outbound.versionId,revision,outbound.terms.effectiveAt,JSON.stringify(outbound),serviceLimitHash(outbound)]);
   await tx.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,actor_label,payload) VALUES($1,$2,$3,$4,$5)',[tenantId,id,'service_limits_updated',who?.name||'آزمون محلی',JSON.stringify({action:input.action,revision,actor:who,eventId:outbound?.eventId||null})]);
  });return read(id);
 }
 return {read,extraction,command};
}
