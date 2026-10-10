import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,DEMO_TENANT_ID,TITAN_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {serviceLimitHash} from '../lib/service-limits.mjs';
import {builtInParameters,extractContractParameters} from '../public/contract-parameter-model.js';
import {validateParameterDefinition,validateParameterValue,currentContractParameters} from '../lib/contract-parameters.mjs';
const definition={key:'success-cost',label:'هزینه عملیات موفق',type:'number',unit:'IRR / عملیات موفق',target:'finance',min:0,max:null,aliases:['success cost'],options:[]};
test('extensible typed parameters preserve meanings, unknowns and source evidence',()=>{
 const d=validateParameterDefinition(definition);assert.equal(validateParameterValue(d,500),500);assert.throws(()=>validateParameterValue(d,-1));assert.throws(()=>validateParameterDefinition({...definition,script:'eval(1)'}));
 assert.throws(()=>validateParameterDefinition({...definition,type:'enum'}));assert.throws(()=>validateParameterValue(builtInParameters.find(d=>d.key==='auto-renew'),'false'));
 const x=extractContractParameters('حداکثر کاربران فعال: ۱۰\nتمدید خودکار: خیر\nامکانات مجاز: read، write\nزمان پاسخ سرویس: ۱۰ تا ۲۰ میلی‌ثانیه\nهزینه عملیات موفق: ۵۰۰ ریال',[...builtInParameters,{...d,revision:1}]);
 assert.equal(x.automaticPublication,false);assert.equal(x.candidates.find(c=>c.key==='active-users').value,10);assert.equal(x.candidates.find(c=>c.key==='auto-renew').value,false);assert.deepEqual(x.candidates.find(c=>c.key==='allowed-features').value,['read','write']);assert.equal(x.candidates.find(c=>c.key==='response-time-ms').status,'ambiguous');assert.equal(x.candidates.find(c=>c.key==='success-cost').value,500);
 const a={status:'signed',effectiveAt:'2026-10-01T00:00:00.000Z',validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-11-01T00:00:00.000Z'},b={...a,effectiveAt:'2026-10-15T00:00:00.000Z'};
 assert.equal(currentContractParameters({versions:[a,b]},{now:'2026-10-10T00:00:00.000Z'}),a);assert.equal(currentContractParameters({versions:[a,b]},{now:b.effectiveAt}),b);assert.equal(currentContractParameters({versions:[a,b]},{now:b.effectiveAt,executionStatus:'paused'}),null);
});
test('custom definitions, immutable commercial versions and signed amendments preserve unchanged values',{timeout:240000},async()=>{
 const db=await createDatabase({dataDir:'memory://',connectionString:process.env.NEOCONTRACT_PARAMETER_ACCEPTANCE_URL}),store=createStore(db,DEMO_TENANT_ID);let state;
 try{
  const before=(await store.parameters.definitions()).length;
  const createDef={definition,expectedRevision:0,idempotencyKey:randomUUID()};let defs=await store.parameters.saveDefinition(createDef);assert.equal(defs.length,before+1);assert.equal((await store.parameters.saveDefinition(createDef)).length,before+1);
  await assert.rejects(store.parameters.saveDefinition({...createDef,idempotencyKey:randomUUID()},{tenantId:DEMO_TENANT_ID,roles:['account_manager']}));
  assert.ok(!(await createStore(db,TITAN_TENANT_ID).parameters.definitions()).some(d=>d.key==='success-cost'));
  const data=await store.bootstrap();let c=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'پارامترهای آزمون',owner:'آزمون',amount:10000,start:'2026-10-01',end:'2026-11-01',paymentTerms:'آزمون',services:[]});
  const quote='حداکثر کاربران فعال: ۱۰\nهزینه عملیات موفق: ۵۰۰ ریال';await db.query("INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,metadata) VALUES($1,$2,'proposal_revision','parameters.md','parameters','text/plain',$3)",[DEMO_TENANT_ID,c.id,JSON.stringify({body:quote})]);
  const x=await store.parameters.extract(c.id);assert.equal(x.source.sha256,serviceLimitHash(quote));assert.equal(x.candidates.length,2);
  const cmd=async(action,payload,actor=null)=>{const input={action,payload,expectedRevision:state?.revision||0,idempotencyKey:randomUUID()};state=await store.parameters.command(c.id,input,actor);return input;};
  const payload={sourceKind:'contract',sourceHash:x.source.sha256,validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-11-01T00:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',values:x.candidates.map(v=>({key:v.key,value:v.value,definitionRevision:v.definitionRevision,clauseQuote:v.quote}))};
  await cmd('draft',payload);assert.equal(state.outbox.length,0);
  const signature=()=>({versionId:state.versions.at(-1).id,confirmSigned:true,reference:'SIG-TEST',counterparties:'طرفین آزمون',signedDate:'2026-10-01'});
  await assert.rejects(cmd('sign',signature()),/امضاشده/);
  while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null});
  await store.execution.command(c.id,{action:'start',payload:{reference:'CONTRACT-SIGNED-TEST',counterparties:'طرفین آزمون',confirmSigned:true,signedDate:'2026-10-01',startDate:c.start,endDate:c.end,amount:10000,advanceLimit:0,direction:'receivable'},expectedRevision:0,idempotencyKey:randomUUID()});
  const first=await cmd('sign',signature());assert.deepEqual(await store.parameters.command(c.id,first),state);const v1=structuredClone(state.versions[0]);assert.equal(state.outbox.length,1);assert.equal(state.applicationStatus,'awaiting-mapping');
  defs=await store.parameters.saveDefinition({definition:{...definition,unit:'تومان / عملیات موفق'},expectedRevision:1,idempotencyKey:randomUUID()});assert.equal(defs.find(d=>d.key==='success-cost').revision,2);assert.equal(state.versions[0].values.find(v=>v.key==='success-cost').definition.unit,definition.unit);
  await assert.rejects(cmd('draft',payload),/الحاقیه/);
  let changed=await store.amend(c.id,{title:'تغییر کاربران',body:'حداکثر کاربران فعال: ۲۰',reason:'توافق',idempotencyKey:randomUUID()}),a=changed.amendments[0];
  const amendment={...payload,sourceKind:'amendment',amendmentId:a.id,sourceHash:serviceLimitHash('حداکثر کاربران فعال: ۲۰'),effectiveAt:'2026-10-15T00:00:00.000Z',values:[{key:'active-users',definitionRevision:1,value:20,clauseQuote:'حداکثر کاربران فعال: ۲۰'}]};
  await assert.rejects(cmd('draft',amendment),/تأیید/);
  for(const action of ['submit','approve']){changed=await store.reviewAmendment(c.id,a.id,{action,expectedStatus:a.status,expectedRevision:a.workflow.revision,idempotencyKey:randomUUID(),comment:'آزمون'});a=changed.amendments[0];}
  await cmd('draft',amendment);assert.equal(state.versions[1].values.length,2);assert.deepEqual(state.versions[1].values.find(v=>v.key==='success-cost'),v1.values.find(v=>v.key==='success-cost'));
  await assert.rejects(cmd('sign',{...signature(),signedDate:'2099-01-01'}));
  const prior=structuredClone(state),transaction=db.transaction;db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,args)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('audit rollback');return tx.query(sql,args);}}));
  try{await assert.rejects(cmd('sign',signature()),/audit rollback/);}finally{db.transaction=transaction;}assert.deepEqual(await store.parameters.read(c.id),prior);
  await cmd('sign',signature(),{tenantId:DEMO_TENANT_ID,subject:'legal-test',roles:['legal_reviewer']});assert.deepEqual(state.versions[0],v1);assert.equal(state.outbox.length,2);assert.equal(state.current.id,v1.id);
  await assert.rejects(cmd('draft',amendment,{tenantId:DEMO_TENANT_ID,roles:['viewer']}));await assert.rejects(createStore(db,TITAN_TENANT_ID).parameters.read(c.id),/یافت نشد/);
  await assert.rejects(db.query("UPDATE contracts.contract_parameters SET revision=revision+1,state=jsonb_set(state,'{versions,0,values,0,value}','999') WHERE contract_id=$1",[c.id]),/immutable/i);
  await assert.rejects(db.query('DELETE FROM contracts.contract_parameter_outbox WHERE contract_id=$1',[c.id]),/immutable/i);
  assert.deepEqual((await store.contract(c.id)).snapshot,c.snapshot);assert.equal((await store.contract(c.id)).amendments[0].status,'approved');
 }finally{await db.close();}
});
