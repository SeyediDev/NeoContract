import test from 'node:test';
import assert from 'node:assert/strict';
import {economicAmendmentContext,economicAmendmentSeed,economicAmendmentIssues} from '../public/economy-amendment.js';
const terms={serviceKey:'test-api',actors:[{key:'provider',name:'ارائه‌دهنده',role:'provider',percent:'100',agreementReference:'PROVIDER-1'}],revenueBase:'net_collected',periodDays:3,holdDays:2,anchor:'2026-10-01T00:00:00.000Z',minimumPayout:'20',disputePolicy:'hold-disputed',customerCredit:{enabled:true,fundingSource:'rebate',ceiling:'1000',periodDays:30,reference:'CREDIT-1'}};
const v={id:'v1',version:1,status:'signed',terms,validFrom:terms.anchor,validTo:'2027-01-01T00:00:00.000Z',effectiveAt:terms.anchor,source:{id:'a1',clauseQuote:'old clause',sha256:'old hash'},signature:{reference:'SIGNED-1'}};
const contract={economics:{versions:[v]},amendments:[{id:'a1',status:'approved'},{id:'a2',status:'approved'},{id:'a3',status:'signed'},{id:'a4',status:'draft'},{id:'a5',status:'in-review'}]};
const dates={validFrom:'2026-10-02T00:00:00.000Z',validTo:v.validTo,effectiveAt:'2026-10-02T00:00:00.000Z',anchor:'2026-10-02T00:00:00.000Z'};
test('latest signed including a future version is the only base; cancelled versions do not replace it',()=>{
 const future={...v,id:'v2',version:2,effectiveAt:'2026-12-01T00:00:00.000Z'},c=structuredClone(contract);c.economics.versions.push(future,{...v,id:'v3',version:3,status:'cancelled'});
 assert.throws(()=>economicAmendmentContext(c,'v1'),/آخرین/);assert.equal(economicAmendmentContext(c,'v2').base.id,'v2');assert.throws(()=>economicAmendmentContext({economics:{versions:[]}},'v1'),/آخرین/);
});
test('open drafts block preparation and only a fresh approved or signed source is eligible',()=>{
 const c=structuredClone(contract);c.economics.versions.push({...v,id:'draft',version:2,status:'draft'});assert.throws(()=>economicAmendmentContext(c,'v1'),/پیش‌نویس باز/);
 assert.deepEqual(economicAmendmentContext(contract,'v1').amendments.map(a=>a.id),['a2','a3']);
 for(const id of ['a1','a4','a5','missing'])assert.throws(()=>economicAmendmentSeed(contract,'v1',id),/الحاقیه تازه/);
 assert.equal(economicAmendmentSeed(contract,'v1','a3').amendmentId,'a3');
});
test('commercial terms and optional credit are cloned without inherited dates, evidence or signature',()=>{
 const before=structuredClone(contract),seed=economicAmendmentSeed(contract,'v1','a2');assert.equal(seed.sourceKind,'amendment');
 assert.deepEqual(Object.keys(seed.terms).sort(),['serviceKey','actors','revenueBase','periodDays','holdDays','minimumPayout','disputePolicy','customerCredit'].sort());
 assert.deepEqual(seed.terms.customerCredit,terms.customerCredit);seed.terms.actors[0].agreementReference='NEW';seed.terms.customerCredit.ceiling='2000';seed.base.source.clauseQuote='changed';assert.deepEqual(contract,before);
 for(const key of ['anchor','validFrom','validTo','effectiveAt','signature','source','sourceHash','clauseQuote','walletPosted'])assert.equal(Object.hasOwn(seed.terms,key),false);
});
test('disabled optional customer credit remains disabled without adding funding instructions',()=>{
 const c=structuredClone(contract);c.economics.versions[0].terms.customerCredit={enabled:false};assert.deepEqual(economicAmendmentSeed(c,'v1','a2').terms.customerCredit,{enabled:false});
});
test('fresh dates accept exact lower boundaries and reject effect at or before signed base',()=>{
 assert.deepEqual(economicAmendmentIssues(v,dates),[]);
 for(const effectiveAt of [v.effectiveAt,'2026-09-30T23:59:59.999Z'])assert.ok(economicAmendmentIssues(v,{...dates,effectiveAt}).some(e=>e.field==='effectiveAt'));
 assert.ok(economicAmendmentIssues(v,{...dates,validFrom:'2026-10-03T00:00:00.000Z'}).some(e=>e.field==='validFrom'));
});
test('validity end is exclusive, anchor cannot precede effect, later anchors within validity work',()=>{
 for(const validTo of [dates.effectiveAt,'2026-10-01T23:59:59.999Z'])assert.ok(economicAmendmentIssues(v,{...dates,validTo}).some(e=>e.field==='validTo'));
 for(const anchor of ['2026-10-01T23:59:59.999Z',dates.validTo,'2027-01-02T00:00:00.000Z'])assert.ok(economicAmendmentIssues(v,{...dates,anchor}).some(e=>e.field==='anchor'));
 assert.deepEqual(economicAmendmentIssues(v,{...dates,anchor:'2026-12-31T23:59:59.999Z'}),[]);
});
test('blank, noncanonical and impossible dates are rejected without normalization or mutation',()=>{
 for(const field of Object.keys(dates))for(const value of ['',null,'invalid','2026-02-30T00:00:00.000Z','2026-10-02','2026-10-02T00:00:00Z']){
  const values={...dates,[field]:value},before=structuredClone(values);assert.ok(economicAmendmentIssues(v,values).some(e=>e.field===field));assert.deepEqual(values,before);
 }
});
