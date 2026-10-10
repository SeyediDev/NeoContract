import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serviceLimitReceipt,readServiceLimitResponse} from '../lib/service-limit-receipt.mjs';
import {serviceLimitHash} from '../lib/service-limits.mjs';
import {serviceLimitDelivery} from '../public/service-limit-delivery.js';
const projection=JSON.parse(await readFile(new URL('./fixtures/service-limit-projection.json',import.meta.url),'utf8'));
const event={eventId:'fixture-event',aggregateVersion:7,projection},now='2026-10-10T12:00:00.000Z';
const ack={eventId:event.eventId,aggregateVersion:7,phase:'acknowledged',gateway:{contractVersion:7,allocationId:projection.limits.allocationId,canonicalScope:projection.limits.canonicalScope,configRevision:1,limitsSha256:serviceLimitHash(projection.limits),observedAt:now}};
test('PCC acceptance, supersession and observed receipts remain distinct and sanitized',()=>{
 assert.deepEqual(serviceLimitReceipt(200,ack,event,now),ack);
 const pending={eventId:event.eventId,aggregateVersion:7,status:'applied',phase:'pending',errors:[],state:{private:'not returned'},gateway:ack.gateway};
 const accepted=serviceLimitReceipt(202,pending,event,now);assert.deepEqual(Object.keys(accepted).sort(),['aggregateVersion','centralStatus','eventId','phase','receivedAt']);assert.equal(accepted.phase,'pending');
 assert.equal(serviceLimitReceipt(202,{...pending,status:'duplicate'},event,now).centralStatus,'duplicate');
 assert.equal(serviceLimitReceipt(202,{...pending,status:'stale',phase:'superseded'},event,now).phase,'superseded');
 for(const [status,body] of [[202,ack],[200,pending],[204,ack],[202,{...pending,eventId:'wrong'}],[202,{...pending,aggregateVersion:8}],[202,{...pending,errors:['rejected']}],[202,{...pending,status:'stale'}],[202,{...pending,status:'applied',phase:'superseded'}]])assert.throws(()=>serviceLimitReceipt(status,body,event,now),e=>e.code==='invalid_ack');
 for(const gateway of [{...ack.gateway,configRevision:2},{...ack.gateway,limitsSha256:'a'.repeat(64)},{...ack.gateway,observedAt:'2026-10-10T12:00:00+00:00'},{...ack.gateway,observedAt:'2026-09-30T00:00:00.000Z'},{...ack.gateway,observedAt:projection.validTo},{...ack.gateway,observedAt:'2026-10-10T12:00:31.000Z'}])assert.throws(()=>serviceLimitReceipt(200,{...ack,gateway},event,now));
 const sanitized=serviceLimitReceipt(200,{...ack,token:'private',gateway:{...ack.gateway,token:'private'}},event,now);assert.equal(JSON.stringify(sanitized).includes('private'),false);
});
test('response intake caps UTF-8 bytes, rejects malformed data and cancels the stream',async()=>{
 assert.deepEqual(await readServiceLimitResponse(Response.json(ack)),ack);
 await assert.rejects(readServiceLimitResponse(new Response('"'+'س'.repeat(40000)+'"')),e=>e.code==='invalid_ack');
 await assert.rejects(readServiceLimitResponse(new Response(new Uint8Array([0xff]))),e=>e.code==='invalid_ack');
 await assert.rejects(readServiceLimitResponse(new Response('{broken')),e=>e.code==='invalid_ack');
 let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}});
 await assert.rejects(readServiceLimitResponse(new Response(stream)));assert.equal(cancelled,true);
});
test('delivery copy preserves prior central acceptance while explaining a later failed attempt',()=>{
 const row={status:'pending',receipt:{phase:'pending'},error_code:'central_unavailable'};
 assert.match(serviceLimitDelivery(row,projection.effectiveAt,now).label,/منتظر مشاهده/);
 assert.match(serviceLimitDelivery(row,projection.effectiveAt,now).warning,/نامعلوم/);
 assert.match(serviceLimitDelivery({...row,status:'blocked',receipt:{phase:'superseded'},error_code:'central_superseded'},projection.effectiveAt,now).label,/جایگزین/);
 assert.match(serviceLimitDelivery({status:'pending'},'2026-10-15T00:00:00.000Z',now).label,/تاریخ اثر/);
});
