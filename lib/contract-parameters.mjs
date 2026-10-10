import {randomUUID} from 'node:crypto';
import {text,requireValue} from './domain.mjs';
import {serviceLimitHash} from './service-limits.mjs';
import {builtInParameters,parameterTargets,parameterTypes,extractContractParameters} from '../public/contract-parameter-model.js';
const check=(v,msg,status=400)=>requireValue(v,msg,status);
const key=v=>{check(typeof v==='string'&&/^[a-z][a-z0-9.-]{0,63}$/.test(v),'کلید پارامتر معتبر نیست.');return v;};
const instant=v=>{check(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'تاریخ و ساعت UTC معتبر لازم است.');return v;};
const civilDay=v=>{check(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'روز معتبر لازم است.');return v;};
const tehranDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function validateParameterDefinition(p){
 check(p&&typeof p==='object'&&!Array.isArray(p),'تعریف پارامتر لازم است.');
 check(Object.keys(p).every(k=>['key','label','type','unit','target','min','max','aliases','options','archived'].includes(k)),'فیلد ناشناخته در تعریف پارامتر وجود دارد.');
 check(Object.hasOwn(parameterTypes,p.type)&&Object.hasOwn(parameterTargets,p.target),'نوع یا مقصد پارامتر معتبر نیست.');
 const list=(v,label)=>{check(Array.isArray(v)&&v.length<=32&&v.every(s=>typeof s==='string'&&s.trim().length>0&&s.length<=100)&&new Set(v).size===v.length,label+' معتبر نیست.');return v.map(s=>s.trim());};
 const min=p.min??null,max=p.max??null;
 check([min,max].every(v=>v===null||typeof v==='number'&&Number.isFinite(v))&&(min===null||max===null||min<=max),'حدود تعریف معتبر نیست.');
 check(['number','integer'].includes(p.type)||(min===null&&max===null),'حد عددی برای نوع غیرعددی مجاز نیست.');
 if(p.type==='integer')check([min,max].every(v=>v===null||Number.isSafeInteger(v)),'حد نوع صحیح باید عدد صحیح امن باشد.');
 const options=list(p.options||[],'گزینه‌ها');check(p.type==='enum'?options.length>0:options.length===0,'گزینه‌ها فقط برای نوع گزینه‌ای لازم‌اند.');
 check(p.archived===undefined||typeof p.archived==='boolean','وضعیت بایگانی معتبر نیست.');
 return {key:key(p.key),label:text(p.label,'عنوان',{max:150}),type:p.type,unit:text(p.unit,'واحد',{max:100}),target:p.target,min,max,aliases:list(p.aliases||[],'نام‌های استخراج'),options,archived:p.archived===true,builtin:false};
}
export function validateParameterValue(def,v){
 if(['number','integer'].includes(def.type))check(typeof v==='number'&&Number.isFinite(v)&&(def.type!=='integer'||Number.isSafeInteger(v))&&(def.min===null||v>=def.min)&&(def.max===null||v<=def.max),'مقدار «'+def.label+'» با نوع یا حدود آن سازگار نیست.');
 else if(def.type==='boolean')check(typeof v==='boolean','مقدار بله / خیر لازم است.');
 else if(def.type==='list')check(Array.isArray(v)&&v.length<=64&&v.every(s=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=200)&&new Set(v).size===v.length,'فهرست معتبر و بدون تکرار لازم است.');
 else if(def.type==='enum')check(typeof v==='string'&&def.options.includes(v),'گزینه معتبر لازم است.');
 else if(def.type==='date')civilDay(v);
 else text(v,'مقدار متن',{max:2000});
 return v;
}
export function currentContractParameters(state,{now=new Date().toISOString(),executionStatus='running'}={}){
 if(executionStatus!=='running')return null;
 const v=(state?.versions||[]).filter(v=>v.status==='signed'&&v.effectiveAt<=now).at(-1);
 return v&&v.validFrom<=now&&now<v.validTo?v:null;
}
export function createContractParameterStore(db,tenantId){
 const actorData=actor=>actor?{id:actor.id,subject:actor.subject,name:actor.name,email:actor.email}:null;
 const authorize=(actor,action)=>{check(!actor||actor.tenantId===tenantId,'تننت مجاز نیست.',403);const roles=actor?.roles||['contract_admin'];check(roles.some(r=>['contract_admin','platform_admin'].includes(r))||(action==='sign'?roles.includes('legal_reviewer'):action!=='definition'&&roles.includes('account_manager')),'نقش شما اجازه این اقدام را ندارد.',403);};
 const definitionList=async tx=>[...structuredClone(builtInParameters),...(await tx.query('SELECT definition,revision FROM contracts.contract_parameter_definitions WHERE tenant_id=$1 ORDER BY parameter_key',[tenantId])).rows.map(r=>({...r.definition,revision:r.revision}))];
 const definitions=()=>definitionList(db);
 async function saveDefinition(input,actor=null){
  authorize(actor,'definition');check(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'نسخه مورد انتظار لازم است.');
  const d=validateParameterDefinition(input.definition);check(!builtInParameters.some(p=>p.key===d.key)&&!['tps','burst','monthly-requests','requests-per-second'].includes(d.key),'تعریف داخلی قابل بازنویسی نیست.');
  const requestKey=text(input.idempotencyKey,'کلید درخواست',{max:120}),who=actorData(actor),hash=serviceLimitHash({definition:d,expectedRevision:input.expectedRevision,subject:who?.subject||null});
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
   const receipt=(await tx.query('SELECT request_hash FROM contracts.contract_parameter_definition_history WHERE tenant_id=$1 AND request_key=$2',[tenantId,requestKey])).rows[0];if(receipt){check(receipt.request_hash===hash,'کلید درخواست تکراری با محتوای دیگر است.',409);return;}
   const row=(await tx.query('SELECT revision FROM contracts.contract_parameter_definitions WHERE tenant_id=$1 AND parameter_key=$2',[tenantId,d.key])).rows[0];check((row?.revision||0)===input.expectedRevision,'تعریف پارامتر تغییر کرده است.',409);const revision=(row?.revision||0)+1;
   if(row)await tx.query('UPDATE contracts.contract_parameter_definitions SET revision=$3,definition=$4,updated_at=now() WHERE tenant_id=$1 AND parameter_key=$2',[tenantId,d.key,revision,JSON.stringify(d)]);
   else await tx.query('INSERT INTO contracts.contract_parameter_definitions(tenant_id,parameter_key,revision,definition) VALUES($1,$2,$3,$4)',[tenantId,d.key,revision,JSON.stringify(d)]);
   await tx.query('INSERT INTO contracts.contract_parameter_definition_history(tenant_id,parameter_key,revision,request_key,request_hash,definition,actor) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,d.key,revision,requestKey,hash,JSON.stringify(d),JSON.stringify(who)]);
  });return definitions();
 }
 const contractRow=async(tx,id)=>{const c=(await tx.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows[0];check(c,'قرارداد یافت نشد.',404);return c;};
 async function source(tx,c,kind,amendmentId){
  check(['contract','amendment'].includes(kind),'منبع معتبر نیست.');
  if(kind==='amendment'){const a=(await tx.query('SELECT * FROM contracts.contract_amendments WHERE tenant_id=$1 AND contract_id=$2 AND id=$3',[tenantId,c.id,amendmentId])).rows[0];check(a,'الحاقیه یافت نشد.',404);return {document:a.summary||'',status:a.status,id:a.id};}
  const row=(await tx.query("SELECT metadata FROM contracts.contract_documents WHERE tenant_id=$1 AND contract_id=$2 AND document_type='proposal_revision' ORDER BY version_no DESC,uploaded_at DESC LIMIT 1",[tenantId,c.id])).rows[0];return {document:row?.metadata?.body||c.template_snapshot?.document||'',status:c.status,id:c.id};
 }
 async function extract(id,{sourceKind='contract',amendmentId}={}){let result;await db.transaction(async tx=>{const c=await contractRow(tx,id),s=await source(tx,c,sourceKind,amendmentId);result={...extractContractParameters(s.document,await definitionList(tx)),source:{kind:sourceKind,id:s.id,status:s.status,sha256:serviceLimitHash(s.document)},document:s.document};});return result;}
 async function read(id){
  check((await db.query('SELECT id FROM contracts.contracts WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0],'قرارداد یافت نشد.',404);
  const row=(await db.query('SELECT * FROM contracts.contract_parameters WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0],execution=(await db.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0]?.state;
  return {revision:row?.revision||0,versions:row?.state?.versions||[],current:currentContractParameters(row?.state,{executionStatus:execution?.status||'not-started'}),executionStatus:execution?.status||'not-started',definitions:await definitions(),outbox:(await db.query('SELECT event_id,version_id,aggregate_version,effective_at,status FROM contracts.contract_parameter_outbox WHERE tenant_id=$1 AND contract_id=$2 ORDER BY aggregate_version',[tenantId,id])).rows,applicationStatus:'awaiting-mapping'};
 }
 async function command(id,input,actor=null){
  check(input&&['draft','sign','cancel'].includes(input.action),'اقدام پارامتر معتبر نیست.');authorize(actor,input.action);check(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'نسخه مورد انتظار لازم است.');
  const p=input.payload;check(p&&typeof p==='object'&&!Array.isArray(p),'محتوای اقدام لازم است.');const requestKey=text(input.idempotencyKey,'کلید درخواست',{max:120}),who=actorData(actor),hash=serviceLimitHash({action:input.action,payload:p,expectedRevision:input.expectedRevision,subject:who?.subject||null});
  await db.transaction(async tx=>{
   const c=await contractRow(tx,id),receipt=(await tx.query('SELECT request_hash FROM contracts.contract_parameter_commands WHERE tenant_id=$1 AND contract_id=$2 AND request_key=$3',[tenantId,id,requestKey])).rows[0];if(receipt){check(receipt.request_hash===hash,'کلید درخواست با محتوای دیگر استفاده شده است.',409);return;}
   const row=(await tx.query('SELECT * FROM contracts.contract_parameters WHERE tenant_id=$1 AND contract_id=$2 FOR UPDATE',[tenantId,id])).rows[0];check((row?.revision||0)===input.expectedRevision,'پارامترهای قرارداد تغییر کرده‌اند.',409);const state=row?.state||{versions:[]},revision=(row?.revision||0)+1,at=new Date().toISOString();let event=null;
   if(input.action==='draft'){
    check(!state.versions.some(v=>v.status==='draft'),'ابتدا پیش‌نویس باز را تعیین تکلیف کنید.',409);
    const validFrom=instant(p.validFrom),validTo=instant(p.validTo),effectiveAt=instant(p.effectiveAt);check(validFrom<validTo&&validFrom<=effectiveAt&&effectiveAt<validTo,'بازه و زمان اثر ناسازگار است.');
    const s=await source(tx,c,p.sourceKind,p.amendmentId);check(serviceLimitHash(s.document)===p.sourceHash,'متن منبع تغییر کرده است.',409);if(p.sourceKind==='amendment')check(['approved','signed'].includes(s.status),'الحاقیه باید تأیید شده باشد.',409);
    const prior=state.versions.filter(v=>v.status==='signed').at(-1);check(!prior||p.sourceKind==='amendment'&&prior.source.id!==s.id&&effectiveAt>prior.effectiveAt,'اصلاح نسخه امضاشده نیازمند الحاقیه تازه و تاریخ اثر بعدی است.',409);
    check(Array.isArray(p.values)&&p.values.length>0&&p.values.length<=64&&new Set(p.values.map(v=>v.key)).size===p.values.length,'فهرست پارامترها معتبر و بدون تکرار لازم است.');
    const defs=await definitionList(tx),values=new Map((prior?.values||[]).map(v=>[v.key,structuredClone(v)]));
    for(const v of p.values){check(Object.keys(v).every(k=>['key','value','definitionRevision','clauseQuote'].includes(k)),'فیلد ناشناخته در مقدار وجود دارد.');const d=defs.find(d=>d.key===v.key&&!d.archived);check(d,'تعریف فعال پارامتر یافت نشد.',404);check(d.revision===v.definitionRevision,'تعریف پارامتر تغییر کرده است؛ فرم را بازخوانی کنید.',409);const quote=text(v.clauseQuote,'بند مستند',{max:4000});check(s.document.includes(quote),'بند در متن منبع وجود ندارد.');values.set(d.key,{key:d.key,value:validateParameterValue(d,v.value),definition:structuredClone(d),source:{kind:p.sourceKind,id:s.id,sha256:p.sourceHash,clauseQuote:quote}});}
    check(values.size<=64,'حداکثر ۶۴ پارامتر در هر نسخه مجاز است.');
    state.versions.push({id:randomUUID(),version:state.versions.length+1,status:'draft',validFrom,validTo,effectiveAt,source:{kind:p.sourceKind,id:s.id,sha256:p.sourceHash},values:[...values.values()],createdAt:at,actor:who});
   }else{
    const v=state.versions.find(v=>v.id===p.versionId);check(v,'نسخه یافت نشد.',404);check(v.status==='draft','نسخه دیگر پیش‌نویس نیست.',409);
    if(input.action==='cancel'){v.status='cancelled';v.cancellation={reference:text(p.reference,'مرجع',{max:500}),comment:text(p.comment,'علت',{max:2000}),actor:who,at};}
    else{
     const execution=(await tx.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2 FOR UPDATE',[tenantId,id])).rows[0]?.state;check(execution?.status==='running','مبنای امضاشده و اجرای فعال لازم است.',409);check(p.confirmSigned===true,'تأیید مدرک امضای طرفین لازم است.');
     const s=await source(tx,c,v.source.kind,v.source.id);check(serviceLimitHash(s.document)===v.source.sha256,'منبع پیش‌نویس تغییر کرده است.',409);if(v.source.kind==='amendment')check(['approved','signed'].includes(s.status),'الحاقیه مجاز به اعمال نیست.',409);
     const prior=state.versions.filter(x=>x.status==='signed').at(-1);check(!prior||v.source.kind==='amendment'&&v.source.id!==prior.source.id&&v.effectiveAt>prior.effectiveAt,'نسخه پیش‌نویس بر مبنای جاری نیست.',409);
     const signedDate=civilDay(p.signedDate);check(signedDate<=tehranDay(at)&&signedDate<=tehranDay(v.effectiveAt),'تاریخ امضا نمی‌تواند در آینده یا پس از تاریخ اثر باشد.');
     const begin=new Date(execution.basis.startDate+'T00:00:00+03:30').toISOString(),end=new Date(+new Date(execution.endDate+'T00:00:00+03:30')+86400000).toISOString();check(v.validFrom>=begin&&v.validTo<=end,'بازه پارامترها باید داخل قرارداد امضاشده باشد.');
     v.signature={reference:text(p.reference,'مرجع امضا',{max:500}),counterparties:text(p.counterparties,'امضاکنندگان',{max:1000}),signedDate,actor:who,recordedAt:at};v.status='signed';
     event={schemaVersion:'1.0.0',eventType:'contract.parameters.signed',eventId:'ncp-'+randomUUID(),producer:'fanasa-contracts',occurredAt:at,aggregateVersion:revision,localTenantId:tenantId,contractId:id,versionId:v.id,version:structuredClone(v),sourceExecutionReference:execution.basis.reference};
    }
   }
   if(row)await tx.query('UPDATE contracts.contract_parameters SET revision=$3,state=$4,updated_at=now() WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id,revision,JSON.stringify(state)]);else await tx.query('INSERT INTO contracts.contract_parameters(tenant_id,contract_id,revision,state) VALUES($1,$2,$3,$4)',[tenantId,id,revision,JSON.stringify(state)]);
   await tx.query('INSERT INTO contracts.contract_parameter_commands(tenant_id,contract_id,request_key,request_hash,revision,action,payload,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenantId,id,requestKey,hash,revision,input.action,JSON.stringify(p),JSON.stringify(who)]);
   if(event)await tx.query('INSERT INTO contracts.contract_parameter_outbox(event_id,tenant_id,contract_id,version_id,aggregate_version,effective_at,payload,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[event.eventId,tenantId,id,event.versionId,revision,event.version.effectiveAt,JSON.stringify(event),serviceLimitHash(event)]);
   await tx.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,actor_label,payload) VALUES($1,$2,$3,$4,$5)',[tenantId,id,'contract_parameters_updated',who?.name||'آزمون محلی',JSON.stringify({action:input.action,revision,actor:who,eventId:event?.eventId||null})]);
  });return read(id);
 }
 return {definitions,saveDefinition,extract,read,command};
}
