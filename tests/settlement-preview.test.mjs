import test from 'node:test';
import assert from 'node:assert/strict';
import {settlementPreview} from '../public/settlement-preview.js';
import {renderSettlementPreview} from '../public/settlement-preview-ui.js';
import {validateEconomicTerms,economicAllocation} from '../lib/digital-economy.mjs';
const now=Date.parse('2026-10-17T12:00:00.000Z');
const terms=validateEconomicTerms({serviceKey:'test-api',actors:[{key:'fanasa',name:'فن‌آسا',role:'infrastructure',percent:'20',agreementReference:'INFRA-1'},{key:'provider',name:'ارائه‌دهنده',role:'provider',percent:'60',agreementReference:'PROVIDER-1'},{key:'partner',name:'شریک',role:'partner',percent:'20',agreementReference:'PARTNER-1'}],revenueBase:'net_collected',periodDays:3,holdDays:2,anchor:'2026-10-01T00:00:00.000Z',minimumPayout:'20',disputePolicy:'hold-disputed'});
const version={id:'v1',version:1,status:'signed',terms,validFrom:terms.anchor,validTo:'2026-12-01T00:00:00.000Z',effectiveAt:terms.anchor};
const data={versions:[version],settlements:[],executionStatus:'running'};
const input={versionId:version.id,periodStart:terms.anchor,periodEnd:'2026-10-04T00:00:00.000Z',collected:'101',refunds:'1',tax:'10',disputed:'10',evidenceReference:'FIN-1',confirmEvidence:true};
test('exact preview matches server for net/gross, dispute policies, zero and maximum safe rial',()=>{
 for(const revenueBase of ['net_collected','gross_collected'])for(const disputePolicy of ['hold-all','hold-disputed'])for(const values of [{collected:'0',refunds:'0',tax:'0',disputed:'0'},{collected:'101',refunds:'1',tax:'10',disputed:'10'},{collected:'9007199254740991',refunds:'1',tax:'101',disputed:'17'}]){
  const t={...terms,revenueBase,disputePolicy},d={...data,versions:[{...version,terms:t}]},r=settlementPreview(d,{...input,...values},{now});
  assert.deepEqual(r.allocation,economicAllocation(t,values));assert.deepEqual(r.errors,[]);assert.ok(r.allocation.balanced);
 }
 const r=settlementPreview(data,input,{now});assert.deepEqual(r.allocation.allocations.map(a=>a.amount),['16','48','16']);assert.equal(r.allocation.allocations[0].disposition,'carry-forward');
 const equal={...data,versions:[{...version,terms:{...terms,minimumPayout:'16'}}]};assert.equal(settlementPreview(equal,input,{now}).allocation.allocations[0].disposition,'request-central-credit');
});
test('rounding conserves each rial with four decimal actor shares independently of presentation order',()=>{
 const actors=terms.actors.map((a,i)=>({...a,percent:i===2?'33.3334':'33.3333'})),t={...terms,actors};
 for(const collected of ['1','2','101','9007199254740991']){
  const values={collected,refunds:'0',tax:'0',disputed:'0'},r=settlementPreview({...data,versions:[{...version,terms:t}]},{...input,...values},{now});
  assert.deepEqual(r.allocation,economicAllocation(t,values));assert.equal(r.allocation.allocations.reduce((s,a)=>s+BigInt(a.amount),0n),BigInt(collected));
 }
});
test('period alignment, hold boundary and amendment end are inclusive as required by server',()=>{
 const next={...version,id:'v2',version:2,effectiveAt:'2026-10-04T00:00:00.000Z'},d={...data,versions:[version,next]},due=Date.parse('2026-10-06T00:00:00.000Z');
 assert.equal(settlementPreview(d,input,{now:due}).errors.length,0);
 assert.ok(settlementPreview(d,input,{now:due-1}).errors.some(e=>/هنوز/.test(e.message)));
 assert.ok(settlementPreview(d,{...input,periodStart:'2026-10-04T00:00:00.000Z',periodEnd:'2026-10-07T00:00:00.000Z'},{now}).errors.some(e=>/اصلاحیه/.test(e.message)));
 const draft={...next,status:'draft'};assert.deepEqual(settlementPreview({...data,versions:[version,draft]},input,{now}).errors,[]);
 for(const patch of [{periodStart:'2026-10-02T00:00:00.000Z'},{periodEnd:'2026-10-03T00:00:00.000Z'},{periodStart:'2026-09-28T00:00:00.000Z'},{periodEnd:'2027-01-01T00:00:00.000Z'},{periodEnd:'bad'},{periodStart:'2026-02-30T00:00:00.000Z'}])assert.ok(settlementPreview(data,{...input,...patch},{now}).errors.length);
});
test('unsigned, missing, nonrunning and already proposed period remain blocked without mutating input',()=>{
 for(const executionStatus of ['paused','closed','not-started'])assert.ok(settlementPreview({...data,executionStatus},input,{now}).errors.length);
 for(const status of ['draft','cancelled'])assert.ok(settlementPreview({...data,versions:[{...version,status}]},input,{now}).errors.length);
 assert.ok(settlementPreview(data,{...input,versionId:'missing'},{now}).errors.length);
 const duplicate={...data,settlements:[{proposal:{periodStart:input.periodStart,periodEnd:input.periodEnd}}]},copy=structuredClone(duplicate);
 assert.ok(settlementPreview(duplicate,input,{now}).errors.some(e=>/پیشنهاد ثبت/.test(e.message)));assert.deepEqual(duplicate,copy);
});
test('blank, unsafe, negative and excess deductions never become a balanced preview',()=>{
 for(const field of ['collected','refunds','tax','disputed'])for(const bad of ['',null,0,'-1','1.2','1e3','9007199254740992']){
  const r=settlementPreview(data,{...input,[field]:bad},{now});assert.equal(r.allocation,null);assert.ok(r.errors.some(e=>e.field===field));
 }
 assert.equal(settlementPreview(data,{...input,disputed:'101'},{now}).allocation,null);
 assert.ok(settlementPreview(data,{...input,confirmEvidence:false,evidenceReference:' '},{now}).errors.length===2);
});
test('optional customer credit stays separate from actor amounts; rendered metadata is escaped',()=>{
 const credit={enabled:true,fundingSource:'rebate',ceiling:'9007199254740991',periodDays:30,reference:'<script>credit</script>'};
 const t={...terms,customerCredit:credit,actors:terms.actors.map(a=>({...a,name:a.key==='provider'?'<img src=x>':a.name,agreementReference:'<svg onload=bad>'}))};
 const r=settlementPreview({...data,versions:[{...version,terms:t}]},input,{now}),html=renderSettlementPreview(r);
 assert.deepEqual(r.allocation,economicAllocation(terms,input));assert.ok(html.includes('سقف'));assert.ok(html.includes('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱'));assert.ok(html.includes('این سقف سهم یا موجودی مشتری نیست'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('scope="row"'));
});
