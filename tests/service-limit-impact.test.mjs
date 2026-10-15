import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceLimitImpact} from '../public/service-limit-impact.js';
import {serviceLimitCurrent} from '../lib/service-limits.mjs';
const now='2026-10-16T12:00:00.000Z';
const version=(n,overrides={},status='signed')=>({id:'v'+n,version:n,status,terms:{serviceKey:'api',title:'سرویس',requestsPerSecond:5,burstCapacity:10,monthlyRequests:1000,validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-12-01T00:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',...overrides}});
const data=(versions,executionStatus='running',outbox=[])=>({versions,executionStatus,outbox});
test('future amendments compare to signed predecessor without replacing current or conflating separate services',()=>{
 const a=version(1),b=version(2,{requestsPerSecond:7.123456789,monthlyRequests:0,effectiveAt:'2026-10-20T00:00:00.000Z'}),other=version(3,{serviceKey:'other'}),draft=version(4,{requestsPerSecond:9},'draft');
 const result=serviceLimitImpact(data([draft,other,b,a]),{now});
 assert.equal(result.services[0].current.id,a.id);assert.equal(result.services[0].next.id,b.id);assert.equal(result.services[1].current.id,other.id);
 assert.equal(result.versions.get(b.id).status,'scheduled');assert.equal(result.versions.get(b.id).previous.id,a.id);
 assert.deepEqual(result.versions.get(b.id).changes[0],{key:'requestsPerSecond',before:5,after:7.123456789,changed:true});
 assert.equal(result.versions.get(b.id).changes[1].changed,false);assert.equal(result.versions.get(b.id).changes[2].after,0);
 assert.equal(result.versions.get(other.id).previous,null);assert.equal(result.versions.get(draft.id).previous.id,b.id);
});
test('effect time inclusive, expiry exclusive, expired latest cannot revive an older signed version',()=>{
 const a=version(1),b=version(2,{effectiveAt:now,validTo:'2026-10-17T00:00:00.000Z'}),d=data([a,b]);
 for(const at of ['2026-10-16T11:59:59.999Z',now,'2026-10-17T00:00:00.000Z']){
  const r=serviceLimitImpact(d,{now:at});assert.deepEqual(r.services.flatMap(g=>g.current?[g.current.id]:[]),serviceLimitCurrent(d,{now:at}).map(v=>v.id));
 }
 const expired=serviceLimitImpact(d,{now:'2026-10-17T00:00:00.000Z'});assert.equal(expired.services[0].current,null);assert.equal(expired.versions.get(a.id).status,'superseded');assert.equal(expired.versions.get(b.id).status,'expired');
});
test('pause, close and unsigned states never claim locally consumable limits',()=>{
 for(const [executionStatus,status] of [['paused','paused'],['closed','closed'],['not-started','inactive']]){
  const d=data([version(1)],executionStatus),r=serviceLimitImpact(d,{now});assert.equal(r.services[0].current,null);assert.equal(r.versions.get('v1').status,status);assert.deepEqual(serviceLimitCurrent(d,{now,executionStatus}),[]);
 }
 const d=data([version(1,{},'draft'),version(2,{},'cancelled')]),r=serviceLimitImpact(d,{now});assert.equal(r.services[0].current,null);assert.equal(r.versions.get('v2').previous,null);
 assert.deepEqual(serviceLimitImpact(data([]),{now}).services,[]);
});
test('old observation is only evidence for its own version, including when execution is paused',()=>{
 const a=version(1),b=version(2,{effectiveAt:now}),outbox=[{version_id:a.id,status:'acknowledged',receipt:{phase:'acknowledged'}}];
 const r=serviceLimitImpact(data([a,b],'running',outbox),{now});assert.equal(r.versions.get(a.id).observed,true);assert.equal(r.versions.get(b.id).observed,false);assert.equal(r.services[0].current.id,b.id);
 const p=serviceLimitImpact(data([a],'paused',outbox),{now});assert.equal(p.services[0].current,null);assert.equal(p.versions.get(a.id).observed,true);
 assert.equal(serviceLimitImpact(data([a],'running',[{version_id:a.id,status:'acknowledged',receipt:{phase:'pending'}}]),{now}).versions.get(a.id).observed,false);
});
