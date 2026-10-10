import {serviceLimitProjection} from './service-limit-projection.mjs';
import {serviceLimitHash} from './service-limits.mjs';
import {AppError} from './domain.mjs';
export async function dispatchServiceLimits(db,{endpoint,token,bindingForEvent,fetchImpl=fetch,now=new Date().toISOString(),limit=25}={}){
 if(!endpoint||!token||typeof bindingForEvent!=='function')throw new AppError('اتصال مرکزی محدودیت سرویس تنظیم نشده است.',503,'gateway_not_configured');
 const url=new URL(endpoint);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||url.username||url.password||url.search||url.hash)throw new AppError('نشانی اتصال مرکزی معتبر نیست.');
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('حد پردازش معتبر نیست.');
 const rows=(await db.query("SELECT o.* FROM contracts.service_limit_outbox o WHERE o.status='pending' AND o.effective_at<=$1 AND NOT EXISTS (SELECT 1 FROM contracts.service_limit_outbox n WHERE n.tenant_id=o.tenant_id AND n.contract_id=o.contract_id AND n.payload->'terms'->>'serviceKey'=o.payload->'terms'->>'serviceKey' AND n.aggregate_version>o.aggregate_version AND n.effective_at<=$1) ORDER BY o.created_at LIMIT $2",[now,limit])).rows;
 const results=[];
 for(const row of rows){
  let observed,code=null;
  try{
   if(serviceLimitHash(row.payload)!==row.payload_sha256)throw new AppError('رویداد خروجی نامعتبر است.',409,'outbox_corrupt');
   const execution=(await db.query('SELECT state FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2',[row.tenant_id,row.contract_id])).rows[0]?.state;
   if(execution?.status!=='running')throw new AppError('اجرای قرارداد فعال نیست.',409,'execution_not_running');
   if(row.payload.terms.validTo<=now)throw new AppError('بازه محدودیت پایان یافته است.',409,'limits_expired');
   const binding=await bindingForEvent(row.payload),event=serviceLimitProjection(row.payload,binding);
   // No redirects or hidden retry. The receiver must use a durable inbox.
   const response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':event.eventId},body:JSON.stringify(event),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new AppError('مرکز تغییر را نپذیرفت.',502,'central_rejected');
   const body=await response.text();if(body.length>65536)throw new AppError('رسید بیش از حد بزرگ است.',502,'invalid_ack');
   const ack=JSON.parse(body),p=event.projection;
   if(ack.eventId!==event.eventId||ack.aggregateVersion!==event.aggregateVersion||ack.phase!=='acknowledged'||ack.gateway?.contractVersion!==p.contractVersion||ack.gateway?.allocationId!==p.limits.allocationId||ack.gateway?.canonicalScope!==p.limits.canonicalScope||ack.gateway?.configRevision!==p.limits.configRevision||ack.gateway?.limitsSha256!==serviceLimitHash(p.limits)||typeof ack.gateway?.observedAt!=='string'||!Number.isFinite(Date.parse(ack.gateway.observedAt))||Date.parse(ack.gateway.observedAt)<Date.parse(p.effectiveAt)||Date.parse(ack.gateway.observedAt)>Date.parse(now)+30000)throw new AppError('نسخه اعمال‌شده Gateway تأیید نشده است.',502,'invalid_ack');
   observed={eventId:ack.eventId,aggregateVersion:ack.aggregateVersion,phase:ack.phase,gateway:ack.gateway};
  }catch(error){code=error instanceof AppError?error.code:'central_unavailable';}
  await db.query("UPDATE contracts.service_limit_outbox SET attempts=attempts+1,last_attempt_at=$2,status=$3,receipt=$4,error_code=$5 WHERE event_id=$1 AND status='pending'",[row.event_id,now,observed?'acknowledged':'pending',observed?JSON.stringify(observed):null,code]);
  results.push({eventId:row.event_id,status:observed?'acknowledged':'pending',code});
 }
 return {processed:results.length,results};
}
