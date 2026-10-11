import test from 'node:test';
import assert from 'node:assert/strict';
import {demoCalls,demoEnd,filterCalls,summarizeCalls} from '../public/client-preview-model.js';

test('preview aggregates, timeline and latency distribution describe the same events',()=>{
 for(const hours of [1,6,24])for(const status of ['', 'errors','429','503']){
  const rows=filterCalls({hours,status}),r=summarizeCalls(rows,{hours});
  assert.equal(r.total,rows.length);
  assert.equal(r.timeline.reduce((n,p)=>n+p.calls,0),r.total);
  assert.equal(r.timeline.reduce((n,p)=>n+p.errors,0),r.errors);
  assert.equal(r.buckets.reduce((n,p)=>n+p.count,0),r.total);
  assert.equal(Object.values(r.statusCounts).reduce((a,b)=>a+b,0),r.total);
  assert.ok(rows.every(c=>c.at>=demoEnd-hours*3600000&&c.at<demoEnd));
 }
 assert.equal(summarizeCalls(demoCalls).total,360);
});
test('content filters combine input, output, service, status and fixed time range',()=>{
 assert.equal(filterCalls({q:'SAMPLE-0360'}).length,1);
 assert.equal(filterCalls({q:'sample-request-360'})[0].id,'demo-0360');
 const rows=filterCalls({q:'RATE_LIMITED',status:'429',hours:6,service:'identity-check'});
 assert.ok(rows.length>0);assert.ok(rows.every(c=>c.output.error==='rate_limited'&&c.service==='identity-check'&&c.status===429));
 assert.equal(filterCalls({q:'SAMPLE-۰۳۶۰'}).length,1);
 assert.equal(filterCalls({q:'<script>unsafe</script>'}).length,0);
 assert.ok(filterCalls({q:'mobile'}).every(c=>c.input.channel==='mobile'));
});
test('empty results have no invented rate or latency and percentile uses nearest rank',()=>{
 const empty=summarizeCalls(filterCalls({q:'never-matches'}));
 assert.equal(empty.errorRate,null);assert.equal(empty.average,null);assert.equal(empty.p95,null);
 const report=summarizeCalls([{duration:100,status:200,at:demoEnd-60000},{duration:500,status:503,at:demoEnd-120000}]);
 assert.equal(report.p95,500);assert.equal(report.average,300);assert.equal(report.errorRate,.5);
 assert.equal(new Set(demoCalls.map(c=>c.id)).size,360);
 assert.ok(demoCalls.every(c=>c.input.authorization==='[REDACTED]'));
});
