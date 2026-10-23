import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterAmendmentContext,parameterAmendmentSeed,parameterInputValue,parameterAmendmentPreview} from '../public/contract-parameter-amendment.js';
import {builtInParameters} from '../public/contract-parameter-model.js';
import {validateParameterValue} from '../lib/contract-parameters.mjs';
import {parameterValue} from '../public/contract-parameter-impact-ui.js';
const custom={key:'custom-term',label:'شرط ویژه',type:'enum',unit:'رده',target:'commercial',options:['الف','ب'],min:null,max:null,revision:2};
const definitions=[...builtInParameters,custom];
const item=(key,value)=>({key,value,definition:structuredClone(definitions.find(d=>d.key===key)),source:{id:'old',sha256:'old-hash',clauseQuote:'old clause'}});
const base={id:'v1',version:1,status:'signed',source:{id:'old',sha256:'old-hash'},values:[item('active-users',10),item('auto-renew',false),item('storage-gb',0.000000001),item('allowed-features',['read'])],signature:{reference:'TEST-SIGNED'},validFrom:'2026-10-01T00:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',validTo:'2027-01-01T00:00:00.000Z'};
const contract={parameters:{versions:[base]},amendments:[{id:'old',status:'approved'},{id:'fresh',status:'approved'},{id:'signed',status:'signed'},{id:'draft',status:'draft'}]};
const dates={validFrom:'2026-11-01T00:00:00.000Z',effectiveAt:'2026-11-01T00:00:00.000Z',validTo:'2027-01-01T00:00:00.000Z'};
const preview=(patch={})=>parameterAmendmentPreview({base,version:2,definitions,entries:[{key:'active-users',raw:'20',quote:'کاربران: ۲۰'}],dates,sourceDocument:'کاربران: ۲۰\nشرط ویژه: ب',...patch});
test('preparation uses latest signed including future versions, skips cancelled, blocks any open draft and requires a fresh approved source',()=>{
 const c=structuredClone(contract);c.parameters.versions.push({...base,id:'future',version:2,effectiveAt:'2026-12-01T00:00:00.000Z'},{...base,id:'cancelled',version:3,status:'cancelled'});
 assert.throws(()=>parameterAmendmentContext(c,'v1'),/آخرین/);assert.equal(parameterAmendmentContext(c,'future').version,4);
 assert.deepEqual(parameterAmendmentContext(c,'future').amendments.map(a=>a.id),['fresh','signed']);
 for(const id of ['old','draft','missing'])assert.throws(()=>parameterAmendmentSeed(c,'future',id),/تازه/);
 const seed=parameterAmendmentSeed(c,'future','fresh');assert.deepEqual(Object.keys(seed).sort(),['base','sourceInput','version']);seed.base.values[0].value=99;assert.equal(c.parameters.versions[1].values[0].value,10);
 c.parameters.versions.push({...base,id:'open',status:'draft'});assert.throws(()=>parameterAmendmentContext(c,'future'),/پیش‌نویس/);
});
test('typed input agrees with server for zero, false, precise numbers, enum, date, text and explicit empty list',()=>{
 const cases=[['active-users','0',{},0],['storage-gb','0.000000001',{},0.000000001],['auto-renew','false',{},false],['allowed-features','read، write',{},['read','write']],['allowed-features','',{emptyList:true},[]],['custom-term','ب',{},'ب'],['special-condition','شرط مستند',{},'شرط مستند']];
 const day={...custom,type:'date',options:[],key:'day',unit:'روز'},text={...custom,type:'text',options:[]};
 for(const [key,raw,options,want]of cases){const d=definitions.find(d=>d.key===key),actual=parameterInputValue(d,raw,options);assert.deepEqual(actual,want);assert.deepEqual(validateParameterValue(d,actual),want);}
 assert.equal(parameterInputValue(day,'2026-10-23'),'2026-10-23');assert.equal(validateParameterValue(day,'2026-10-23'),'2026-10-23');assert.throws(()=>parameterInputValue(day,'2026-02-30'));
 assert.equal(parameterValue([]),'فهرست خالی (بدون گزینه)');assert.notEqual(parameterValue([]),parameterValue(['read']));
 for(const raw of ['', '   '])assert.throws(()=>parameterInputValue(text,raw));
});
test('invalid, duplicate, unsafe, archived and implicit empty inputs fail before conversion',()=>{
 for(const [key,raw]of [['active-users',''],['active-users','0.5'],['active-users','9007199254740992'],['active-users','-1'],['storage-gb','Infinity'],['auto-renew','0'],['custom-term','نامعلوم'],['allowed-features','read، read'],['allowed-features',', ،']])assert.throws(()=>parameterInputValue(definitions.find(d=>d.key===key),raw));
 assert.throws(()=>parameterInputValue({...custom,archived:true},'ب'));assert.throws(()=>parameterInputValue(undefined,'1'));
});
test('preview merges only explicit changes, preserving historical values, definitions and sources without mutating inputs',()=>{
 const before=structuredClone(base),r=preview();assert.deepEqual(r.issues,[]);assert.equal(r.changed.length,1);assert.equal(r.candidate.values.length,4);assert.equal(r.comparison.changes.find(v=>v.key==='active-users').direction,'increased');
 for(const key of ['auto-renew','storage-gb','allowed-features'])assert.deepEqual(r.candidate.values.find(v=>v.key===key),before.values.find(v=>v.key===key));
 assert.deepEqual(r.changed[0],{key:'active-users',value:20,definitionRevision:1,clauseQuote:'کاربران: ۲۰'});assert.equal(r.candidate.signature,undefined);assert.equal(r.candidate.values[0].source.sha256,undefined);
 r.candidate.values.at(-1).value.push('write');assert.deepEqual(base,before);
});
test('definition changes are explicit, empty list is retained, and new keys are added without deleting inherited keys',()=>{
 const old=structuredClone(base);old.values.push({...item('custom-term',3),definition:{...custom,type:'integer',unit:'روز',revision:1,options:[]}});
 const r=preview({base:old,entries:[{key:'custom-term',raw:'ب',quote:'شرط ویژه: ب'},{key:'allowed-features',raw:'',emptyList:true,quote:'کاربران: ۲۰'},{key:'support-response-minutes',raw:'0',quote:'کاربران: ۲۰'}]});
 assert.deepEqual(r.issues,[]);assert.equal(r.comparison.changes.find(v=>v.key==='custom-term').direction,'definition');assert.equal(r.comparison.changes.find(v=>v.key==='support-response-minutes').direction,'added');assert.deepEqual(r.candidate.values.find(v=>v.key==='allowed-features').value,[]);assert.equal(old.values.at(-1).definition.unit,'روز');
});
test('fresh dates, exact source evidence, active definitions, uniqueness and nonempty change set are required',()=>{
 for(const [field,value]of [['effectiveAt',base.effectiveAt],['validFrom','2026-12-01T00:00:00.000Z'],['validTo',dates.effectiveAt],['effectiveAt','2026-02-30T00:00:00.000Z']])assert.ok(preview({dates:{...dates,[field]:value}}).issues.some(i=>i.field===field));
 for(const entries of [[],[{key:'missing',raw:'1',quote:'کاربران: ۲۰'}],[{key:'active-users',raw:'20',quote:'متن ناموجود'}],[{key:'active-users',raw:'20',quote:'کاربران: ۲۰'},{key:'active-users',raw:'21',quote:'کاربران: ۲۰'}]])assert.ok(preview({entries}).issues.length);
 assert.equal(preview({definitions:definitions.map(d=>({...d,archived:true}))}).issues[0].field,'parameterKey');
});
