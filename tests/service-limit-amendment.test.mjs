import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceLimitAmendmentContext,serviceLimitAmendmentSeed,serviceLimitAmendmentIssues} from '../public/service-limit-amendment.js';
const terms={serviceKey:'test-api',title:'آزمون',productKey:'test-product',environment:'development',operationGroup:'read',requestsPerSecond:0.25,burstCapacity:10,monthlyRequests:1000,validFrom:'2026-10-01T00:00:00.000Z',validTo:'2027-01-01T00:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',source:{amendmentId:'a1',sha256:'old hash',clauseQuote:'old clause'}};
const v={id:'v1',version:1,status:'signed',terms,signature:{reference:'SIGNED-TEST'}};
const contract={serviceLimits:{versions:[v]},amendments:[{id:'a1',status:'approved'},{id:'a2',status:'approved'},{id:'a3',status:'signed'},{id:'a4',status:'draft'},{id:'a5',status:'in-review'}]};
const values={...Object.fromEntries(Object.entries(terms).map(([k,v])=>[k,String(v)])),validFrom:'2026-10-02T00:00:00.000Z',effectiveAt:'2026-10-02T00:00:00.000Z'};
test('latest signed is selected per service including future signed versions, not cancelled versions or other services',()=>{
 const c=structuredClone(contract),future={...v,id:'future',version:2,terms:{...terms,effectiveAt:'2026-12-01T00:00:00.000Z'}};
 c.serviceLimits.versions.push(future,{...v,id:'cancelled',version:3,status:'cancelled'},{...v,id:'other',version:4,terms:{...terms,serviceKey:'other'}});
 assert.throws(()=>serviceLimitAmendmentContext(c,'v1'),/آخرین/);assert.equal(serviceLimitAmendmentContext(c,'future').base.id,'future');assert.throws(()=>serviceLimitAmendmentContext(c,'missing'),/آخرین/);
});
test('only the same service open draft blocks preparation; fresh approved/signed sources are required',()=>{
 const c=structuredClone(contract);c.serviceLimits.versions.push({...v,id:'draft',status:'draft',terms:{...terms,serviceKey:'other'}});assert.equal(serviceLimitAmendmentContext(c,'v1').base.id,'v1');
 c.serviceLimits.versions.push({...v,id:'same-draft',status:'draft'});assert.throws(()=>serviceLimitAmendmentContext(c,'v1'),/پیش‌نویس باز/);
 assert.deepEqual(serviceLimitAmendmentContext(contract,'v1').amendments.map(a=>a.id),['a2','a3']);for(const id of ['a1','a4','a5','missing'])assert.throws(()=>serviceLimitAmendmentSeed(contract,'v1',id),/الحاقیه تازه/);
});
test('seed clones contractual identity and exact limits without dates, meter confirmation, source or signed/delivery evidence',()=>{
 const before=structuredClone(contract),seed=serviceLimitAmendmentSeed(contract,'v1','a2');assert.deepEqual(Object.keys(seed.terms).sort(),['serviceKey','title','productKey','environment','operationGroup','requestsPerSecond','burstCapacity','monthlyRequests'].sort());
 assert.equal(seed.terms.requestsPerSecond,0.25);assert.deepEqual(seed.sourceInput,{sourceKind:'amendment',amendmentId:'a2'});seed.terms.title='new';seed.base.terms.source.clauseQuote='changed';assert.deepEqual(contract,before);
 for(const field of ['validFrom','validTo','effectiveAt','source','signature','receipt','configRevision','confirmRequestMeter'])assert.equal(Object.hasOwn(seed.terms,field),false);
});
test('fresh validity follows server boundaries; noncanonical/impossible dates and unchanged effect are rejected',()=>{
 assert.deepEqual(serviceLimitAmendmentIssues(v,values),[]);
 for(const field of ['validFrom','validTo','effectiveAt'])for(const invalid of ['',null,'2026-02-30T00:00:00.000Z','2026-10-02T00:00:00Z'])assert.ok(serviceLimitAmendmentIssues(v,{...values,[field]:invalid}).some(e=>e.field===field));
 for(const [field,value]of [['validFrom','2026-10-03T00:00:00.000Z'],['validTo',values.effectiveAt],['effectiveAt',terms.effectiveAt]])assert.ok(serviceLimitAmendmentIssues(v,{...values,[field]:value}).some(e=>e.field===field));
});
test('allocation identity cannot change and numeric limits match server semantics including zero quota',()=>{
 for(const field of ['serviceKey','productKey','environment','operationGroup'])assert.ok(serviceLimitAmendmentIssues(v,{...values,[field]:'different'}).some(e=>e.field===field));
 for(const field of ['requestsPerSecond','burstCapacity','monthlyRequests'])for(const invalid of ['',null,'Infinity','NaN','-1'])assert.ok(serviceLimitAmendmentIssues(v,{...values,[field]:invalid}).some(e=>e.field===field));
 for(const field of ['burstCapacity','monthlyRequests'])for(const invalid of ['0.5','9007199254740992'])assert.ok(serviceLimitAmendmentIssues(v,{...values,[field]:invalid}).some(e=>e.field===field));
 assert.ok(serviceLimitAmendmentIssues(v,{...values,requestsPerSecond:'1000001'}).some(e=>e.field==='requestsPerSecond'));assert.ok(serviceLimitAmendmentIssues(v,{...values,burstCapacity:'0'}).some(e=>e.field==='burstCapacity'));
 assert.deepEqual(serviceLimitAmendmentIssues(v,{...values,requestsPerSecond:'0.0001',monthlyRequests:'0',burstCapacity:'9007199254740991'}),[]);
});
