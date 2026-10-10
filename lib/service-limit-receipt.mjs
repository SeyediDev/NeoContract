import {serviceLimitHash} from './service-limits.mjs';
import {AppError} from './domain.mjs';

const invalid=()=>{throw new AppError('نسخه اعمال‌شده Gateway تأیید نشده است.',502,'invalid_ack');};
const utc=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

// PCC 0.4: acceptance (202) and an observed configuration (200) are distinct.
// Only this allowlisted receipt is retained; PCC's full State is not exposed.
export function serviceLimitReceipt(status,body,event,now){
 if(!body||body.eventId!==event.eventId||body.aggregateVersion!==event.aggregateVersion)invalid();
 const accepted=Array.isArray(body.errors)&&body.errors.length===0;
 if(status===202&&accepted&&body.phase==='pending'&&['applied','duplicate'].includes(body.status))
  return {eventId:body.eventId,aggregateVersion:body.aggregateVersion,phase:'pending',centralStatus:body.status,receivedAt:now};
 if(status===202&&accepted&&body.phase==='superseded'&&body.status==='stale')
  return {eventId:body.eventId,aggregateVersion:body.aggregateVersion,phase:'superseded',centralStatus:'stale',receivedAt:now};
 const p=event.projection,g=body.gateway;
 if(status!==200||body.phase!=='acknowledged'||g?.contractVersion!==p.contractVersion||g?.allocationId!==p.limits.allocationId||g?.canonicalScope!==p.limits.canonicalScope||g?.configRevision!==p.limits.configRevision||g?.limitsSha256!==serviceLimitHash(p.limits)||!utc(g?.observedAt)||g.observedAt<p.effectiveAt||g.observedAt>=p.validTo||Date.parse(g.observedAt)>Date.parse(now)+30000)invalid();
 return {eventId:body.eventId,aggregateVersion:body.aggregateVersion,phase:'acknowledged',gateway:{contractVersion:g.contractVersion,allocationId:g.allocationId,canonicalScope:g.canonicalScope,configRevision:g.configRevision,limitsSha256:g.limitsSha256,observedAt:g.observedAt}};
}

export async function readServiceLimitResponse(response){
 const reader=response.body?.getReader();if(!reader)invalid();
 let bytes=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)invalid();chunks.push(value);}
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{invalid();}
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
