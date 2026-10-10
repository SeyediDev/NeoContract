import {serviceLimitProjection} from './service-limit-projection.mjs';
import {serviceLimitHash} from './service-limits.mjs';
import {AppError} from './domain.mjs';
import {serviceLimitReceipt,readServiceLimitResponse} from './service-limit-receipt.mjs';
export async function dispatchServiceLimits(db,{endpoint,token,bindingForEvent,fetchImpl=fetch,now=new Date().toISOString(),limit=25}={}){
 if(!endpoint||!token||typeof bindingForEvent!=='function')throw new AppError('اتصال مرکزی محدودیت سرویس تنظیم نشده است.',503,'gateway_not_configured');
 const url=new URL(endpoint);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||url.username||url.password||url.search||url.hash)throw new AppError('نشانی اتصال مرکزی معتبر نیست.');
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('حد پردازش معتبر نیست.');
 if(typeof now!=='string'||!Number.isFinite(Date.parse(now))||new Date(now).toISOString()!==now)throw new AppError('زمان پردازش باید UTC معتبر باشد.');
 const rows=(await db.query("SELECT o.* FROM contracts.service_limit_outbox o WHERE o.status='pending' AND o.effective_at<=$1 AND NOT EXISTS (SELECT 1 FROM contracts.service_limit_outbox n WHERE n.tenant_id=o.tenant_id AND n.contract_id=o.contract_id AND n.payload->'terms'->>'serviceKey'=o.payload->'terms'->>'serviceKey' AND n.aggregate_version>o.aggregate_version AND n.effective_at<=$1) ORDER BY o.created_at LIMIT $2",[now,limit])).rows;
 const results=[];
 for(const row of rows){
  let receipt,code=null;
  try{
   if(serviceLimitHash(row.payload)!==row.payload_sha256)throw new AppError('رویداد خروجی نامعتبر است.',409,'outbox_corrupt');
   const execution=(await db.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2',[row.tenant_id,row.contract_id])).rows[0]?.state;
   if(execution?.status!=='running')throw new AppError('اجرای قرارداد فعال نیست.',409,'execution_not_running');
   const parameters=(await db.query('SELECT state FROM contracts.contract_parameters WHERE tenant_id=$1 AND contract_id=$2',[row.tenant_id,row.contract_id])).rows[0]?.state;
   const latest=(parameters?.versions||[]).filter(v=>v.status==='signed'&&v.effectiveAt<=now).at(-1);
   if(latest?.values.some(v=>['gateway','access','product'].includes(v.definition.target)))throw new AppError('نگاشت اجرایی پارامترهای عمومی هنوز پذیرفته نشده است.',409,'parameter_mapping_required');
   if(row.payload.terms.validTo<=now)throw new AppError('بازه محدودیت پایان یافته است.',409,'limits_expired');
   const binding=await bindingForEvent(row.payload),event=serviceLimitProjection(row.payload,binding),digest=serviceLimitHash(event);
   if(event.projection.validTo<=now)throw new AppError('بازه عرضه مرکزی پایان یافته است.',409,'limits_expired');
   if(event.projection.validFrom>now||event.projection.effectiveAt>now)throw new AppError('زمان اثر عرضه مرکزی نرسیده است.',409,'limits_not_effective');
   if(binding.registryReference.length>1000)throw new AppError('مرجع ثبت مرکزی بیش از حد بزرگ است.',409,'gateway_binding_invalid');
   // Persist the exact trusted mapping BEFORE any network side effect. Competing
   // workers can only deliver this one snapshot with the stable event identity.
   const captured=(await db.query("UPDATE contracts.service_limit_outbox SET dispatch_projection=$2,dispatch_sha256=$3,dispatch_registry_reference=$4 WHERE event_id=$1 AND status='pending' AND dispatch_projection IS NULL RETURNING dispatch_projection,dispatch_sha256,dispatch_registry_reference",[row.event_id,JSON.stringify(event),digest,binding.registryReference])).rows[0]
    ||(await db.query('SELECT dispatch_projection,dispatch_sha256,dispatch_registry_reference FROM contracts.service_limit_outbox WHERE event_id=$1',[row.event_id])).rows[0];
   if(!captured?.dispatch_projection||serviceLimitHash(captured.dispatch_projection)!==captured.dispatch_sha256)throw new AppError('محتوای ثبت‌شده ارسال معتبر نیست.',409,'outbox_corrupt');
   if(captured.dispatch_sha256!==digest||captured.dispatch_registry_reference!==binding.registryReference)throw new AppError('نگاشت رویداد قبلاً ارسال‌شده تغییر کرده است؛ بازبینی مرکزی لازم است.',409,'dispatch_binding_changed');
   // No redirects or hidden retry. The receiver must use a durable inbox.
   const response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':event.eventId},body:JSON.stringify(captured.dispatch_projection),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new AppError('مرکز تغییر را نپذیرفت.',502,'central_rejected');
   receipt=serviceLimitReceipt(response.status,await readServiceLimitResponse(response),captured.dispatch_projection,now);
   if(receipt.phase==='superseded')code='central_superseded';
  }catch(error){code=error instanceof AppError?error.code:'central_unavailable';}
  const status=receipt?.phase==='acknowledged'?'acknowledged':receipt?.phase==='superseded'?'blocked':'pending';
  const recorded=(await db.query("UPDATE contracts.service_limit_outbox SET attempts=attempts+1,last_attempt_at=$2,status=$3,receipt=COALESCE($4::jsonb,receipt),error_code=$5 WHERE event_id=$1 AND status='pending' RETURNING status,receipt,error_code",[row.event_id,now,status,receipt?JSON.stringify(receipt):null,code])).rows[0]
   ||(await db.query('SELECT status,receipt,error_code FROM contracts.service_limit_outbox WHERE event_id=$1',[row.event_id])).rows[0];
  results.push({eventId:row.event_id,status:recorded.status,phase:recorded.receipt?.phase||null,code:recorded.error_code});
 }
 return {processed:results.length,results};
}
