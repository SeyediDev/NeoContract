import test from 'node:test';
import assert from 'node:assert/strict';
import {contractParameterImpact,compareParameterValues} from '../public/contract-parameter-impact.js';
import {parameterValue,renderParameterComparison} from '../public/contract-parameter-impact-ui.js';
import {currentContractParameters} from '../lib/contract-parameters.mjs';
const now='2026-10-17T12:00:00.000Z';
const value=(key,v,type='number',extra={})=>({key,value:v,definition:{key,label:key,type,unit:'واحد',target:'product',revision:1,...extra},source:{clauseQuote:'بند مستند'}});
const version=(n,extra={})=>({id:'v'+n,version:n,status:'signed',effectiveAt:'2026-10-01T00:00:00.000Z',validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-12-01T00:00:00.000Z',values:[value('storage',10)],...extra});
test('applicability matches server at effect, expiry, pause and close; older values never revive',()=>{
 const versions=[version(1),version(2,{effectiveAt:now,validTo:'2026-10-18T00:00:00.000Z'})];
 for(const executionStatus of ['running','paused','closed','not-started'])for(const at of ['2026-10-17T11:59:59.999Z',now,'2026-10-18T00:00:00.000Z']){
  const d={versions,executionStatus},result=contractParameterImpact(d,{now:at});
  assert.deepEqual(result.current,currentContractParameters(d,{now:at,executionStatus}));
 }
 assert.equal(contractParameterImpact({versions,executionStatus:'running'},{now:'2026-10-18T00:00:00.000Z'}).status,'expired');
});
test('future and unsigned amendments cannot replace current or become signed predecessors',()=>{
 const a=version(1),b=version(2,{status:'cancelled'}),c=version(3,{effectiveAt:'2026-10-20T00:00:00.000Z'}),d=version(4,{status:'draft'});
 const state={versions:[d,c,b,a],executionStatus:'running'},copy=structuredClone(state),r=contractParameterImpact(state,{now});
 assert.equal(r.current.id,a.id);assert.equal(r.next.id,c.id);assert.equal(r.versions.get(c.id).previous.id,a.id);assert.equal(r.versions.get(d.id).previous.id,c.id);assert.equal(r.versions.get(b.id).status,'cancelled');assert.deepEqual(state,copy);
 assert.equal(contractParameterImpact({versions:[]},{now}).status,'unsigned');
 assert.equal(contractParameterImpact({versions:[c],executionStatus:'running'},{now}).status,'scheduled');
});
test('typed changes preserve zero, false, lists, dates, custom keys and inherited values',()=>{
 const a=version(1,{values:[value('zero',1),value('flag',true,'boolean'),value('list',['read'],'list'),value('date','2026-10-01','date'),value('same',4),value('decrease',10),value('remove','old','text')]}),b=version(2,{values:[value('zero',0),value('flag',false,'boolean'),value('list',['read','write'],'list'),value('date','2026-11-01','date'),value('same',4),value('decrease',5),value('custom-key',0.000000001)]});
 assert.deepEqual(compareParameterValues(a,b).map(c=>[c.key,c.direction]),[['zero','decreased'],['flag','changed'],['list','changed'],['date','changed'],['same','unchanged'],['decrease','decreased'],['custom-key','added'],['remove','removed']]);
 assert.equal(parameterValue(false),'خیر');assert.equal(parameterValue(0),'۰');assert.equal(parameterValue(0.000000001),'۰٫۰۰۰۰۰۰۰۰۱');
});
test('historical definition changes are explicit and never presented as numeric increases',()=>{
 const a=version(1),b=version(2,{values:[value('storage',20,'number',{unit:'TB',revision:2})]});
 const change=compareParameterValues(a,b)[0];assert.equal(change.direction,'definition');assert.equal(change.before.definition.unit,'واحد');assert.equal(change.after.definition.unit,'TB');
 b.values[0]=value('storage',20);assert.equal(compareParameterValues(a,b)[0].direction,'increased');
});
test('comparison escapes historical labels, values and keys',()=>{
 const a=version(1),b=version(2,{values:[value('custom-<img>', '<script>alert(1)</script>','text',{label:'<img src=x>',unit:'<svg>'})]});
 const html=renderParameterComparison({status:'draft',previous:a,changes:compareParameterValues(a,b)},b);
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('scope="row"'));
});
