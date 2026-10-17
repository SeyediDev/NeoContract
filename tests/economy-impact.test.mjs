import test from 'node:test';
import assert from 'node:assert/strict';
import {economyImpact,compareEconomicTerms} from '../public/economy-impact.js';
import {renderEconomyImpact,renderEconomyComparison} from '../public/economy-impact-ui.js';
import {currentContractParameters} from '../lib/contract-parameters.mjs';
import {settlementSchedule} from '../lib/digital-economy.mjs';
const now='2026-10-17T12:00:00.000Z';
const terms={serviceKey:'api',actors:[{key:'fanasa',name:'فن‌آسا',role:'infrastructure',percent:'20',agreementReference:'F1'},{key:'provider',name:'ارائه‌دهنده',role:'provider',percent:'60',agreementReference:'P1'},{key:'partner',name:'شریک',role:'partner',percent:'20',agreementReference:'O1'}],revenueBase:'net_collected',periodDays:3,holdDays:2,anchor:'2026-10-01T00:00:00.000Z',minimumPayout:'0',disputePolicy:'hold-disputed',customerCredit:{enabled:false}};
const version=(n,extra={})=>({id:'v'+n,version:n,status:'signed',effectiveAt:terms.anchor,validFrom:terms.anchor,validTo:'2026-12-01T00:00:00.000Z',terms:structuredClone(terms),...extra});
test('economic applicability matches server at exact effect, expiry, pause and close without reviving older terms',()=>{
 const versions=[version(1),version(2,{effectiveAt:now,validTo:'2026-10-18T00:00:00.000Z'})];
 for(const executionStatus of ['running','paused','closed','not-started'])for(const at of ['2026-10-17T11:59:59.999Z',now,'2026-10-18T00:00:00.000Z']){
  const d={versions,executionStatus},r=economyImpact(d,{now:at});assert.deepEqual(r.current,currentContractParameters(d,{now:at,executionStatus}));
 }
 assert.equal(economyImpact({versions,executionStatus:'running'},{now:'2026-10-18T00:00:00.000Z'}).status,'expired');
});
test('future, cancelled and draft snapshots do not replace the current signed predecessor; inputs stay immutable',()=>{
 const a=version(1),b=version(2,{status:'cancelled'}),c=version(3,{effectiveAt:'2026-10-20T00:00:00.000Z'}),d=version(4,{status:'draft'});
 const data={versions:[d,c,b,a],executionStatus:'running'},copy=structuredClone(data),r=economyImpact(data,{now});
 assert.equal(r.current.id,'v1');assert.equal(r.next.id,'v3');assert.equal(r.versions.get('v3').previous.id,'v1');assert.equal(r.versions.get('v4').previous.id,'v3');assert.equal(r.versions.get('v2').status,'cancelled');assert.deepEqual(data,copy);
 assert.equal(economyImpact({versions:[]},{now}).status,'unsigned');assert.equal(economyImpact({versions:[c]},{now}).status,'scheduled');
});
test('actor deltas are exact percentage points; metadata, additions and removals are independent',()=>{
 const a=version(1),b=version(2);b.terms.actors=[{...terms.actors[1],percent:'60.0001',agreementReference:'P2'},{...terms.actors[0],percent:'19.9999'},{...terms.actors[2],key:'new'}];
 const rows=compareEconomicTerms(a,b).actors;assert.deepEqual(rows.map(r=>[r.key,r.status,r.delta,r.metadataChanged]),[['provider','changed',1,true],['fanasa','changed',-1,false],['new','added',null,false],['partner','removed',null,false]]);
 b.terms.actors=terms.actors.map(a=>({...a,percent:a.percent+'.0000'}));assert.ok(compareEconomicTerms(a,b).actors.every(a=>a.status==='unchanged'));
});
test('all settlement and credit terms compare with explicit zero, disabled credit and full safe-rial precision',()=>{
 const a=version(1),b=version(2);b.terms={...b.terms,serviceKey:'new-api',revenueBase:'gross_collected',holdDays:0,periodDays:5,anchor:'2026-10-20T00:00:00.000Z',minimumPayout:'9007199254740991',disputePolicy:'hold-all',customerCredit:{enabled:true,fundingSource:'rebate',ceiling:'9007199254740991',periodDays:30,reference:'C1'}};
 const r=compareEconomicTerms(a,b);assert.ok(r.serviceChanged);assert.ok(r.terms.every(t=>t.changed));
 const info={status:'scheduled',previous:a,comparison:r},html=renderEconomyComparison(info,b);assert.ok(html.includes('۰ روز'));assert.ok(html.includes('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱'));assert.ok(html.includes('خاموش'));assert.ok(html.includes('افزایش درآمد را نشان نمی‌دهد'));
 const c=version(3);c.terms.customerCredit={enabled:false,reference:'stale',ceiling:'1'};assert.ok(compareEconomicTerms(a,c).terms.filter(t=>t.key.startsWith('customerCredit')).every(t=>!t.changed));
});
test('partial periods identify exactly the residual excluded by the server schedule including anchor after amendment',()=>{
 const a=version(1),b=version(2,{effectiveAt:'2026-10-11T00:00:00.000Z',terms:{...terms,anchor:'2026-10-11T00:00:00.000Z'}}),d={versions:[a,b],executionStatus:'running'},r=economyImpact(d,{now}),v=r.versions.get(a.id);
 assert.deepEqual(v.remainder,{from:'2026-10-10T00:00:00.000Z',to:b.effectiveAt});assert.equal(v.end,b.effectiveAt);
 const schedule=settlementSchedule(d.versions,[],{now:Date.parse(now)}).periods.filter(p=>p.versionId===a.id);assert.equal(schedule.length,3);assert.equal(schedule.at(-1).periodEnd,v.remainder.from);
 b.effectiveAt='2026-10-10T00:00:00.000Z';assert.equal(economyImpact(d,{now}).versions.get(a.id).remainder,null);
 a.terms={...terms,anchor:'2026-10-15T00:00:00.000Z'};const noPeriod=economyImpact(d,{now}).versions.get(a.id);assert.equal(noPeriod.noCompletePeriod,true);assert.ok(renderEconomyComparison(noPeriod,a).includes('هیچ دوره کامل تسویه وجود ندارد'));
});
test('historical metadata is escaped and comparison exposes accessible captions, scopes and exact deltas',()=>{
 const a=version(1),b=version(2);b.terms.actors[0]={...b.terms.actors[0],name:'<img src=x>',agreementReference:'<script>alert(1)</script>',percent:'20.0001'};b.terms.actors[1].percent='59.9999';b.terms.serviceKey='<svg>';const impact=economyImpact({versions:[a,b],executionStatus:'running'},{now}),html=renderEconomyComparison(impact.versions.get(b.id),b)+renderEconomyImpact(impact);
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('۰٫۰۰۰۱ واحد درصد'));assert.ok(html.includes('tabindex="0"'));assert.ok(html.includes('scope="row"'));
});
