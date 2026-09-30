import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from '../lib/database.mjs';
import { createStore } from '../lib/store.mjs';

const stage=(id,role,options={})=>({id,name:id,role,slaDays:1,required:true,enabled:true,...options});
const expected=c=>({expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null,comment:'بازبینی در آزمون گردش کار'});
const definition=stages=>stages.map(({id,name,role,slaDays,required,enabled})=>({id,name,role,slaDays,required,enabled}));
const validation=error=>error.status===400;
const conflict=error=>error.status===409;

test('each SQL contract follows its published template workflow independently', {timeout:180000},async t=>{
 const db=await createDatabase({dataDir:'memory://'});const store=createStore(db);
 try{
  const initial=await store.bootstrap();
  const common={customerId:initial.customers[0].id,title:'آزمون گردش کار اختصاصی',owner:'مسئول آزمون',amount:1,start:'2026-10-01',end:'2027-10-01',paymentTerms:'پرداخت توافقی',services:[]};
  const input=(template,extra={})=>({...common,templateId:template.id,templateVersionId:template.templateVersionId,...extra});
  async function publish(stages,title='الگوی گردش کار آزمون'){
   const draft=await store.saveTemplate({title,body:'قرارداد {{title}}',stages});
   return store.templateAction(draft.id,'publish',{revision:draft.revision,templateVersionId:draft.templateVersionId});
  }
  async function complete(created){
   let value=created;const active=[];const immutable=structuredClone(created.snapshot);
   for(let i=0;i<=created.stages.filter(s=>s.enabled).length;i++){
    value=await store.advance(value.id,expected(value));
    const current=value.stages.filter(s=>s.status==='active');
    assert.equal(current.length,value.status==='active'?0:1);
    if(current.length)active.push(current[0].id);
    assert.deepEqual(value.snapshot,immutable);
   }
   assert.equal(value.status,'active');return {value,active};
  }

  await t.test('distinct template flows execute independently when their advances are interleaved',async()=>{
   const templates=[initial.templates.find(x=>x.code==='nda'),initial.templates.find(x=>x.code==='purchase')];
   const contracts=await Promise.all(templates.map(template=>store.createContract(input(template))));
   assert.notDeepEqual(templates[0].stages.map(s=>s.id),templates[1].stages.map(s=>s.id));
   const snapshots=contracts.map(c=>structuredClone(c.snapshot)),visited=[[],[]];
   for(const [i,c] of contracts.entries()){
    assert.deepEqual(definition(c.stages),templates[i].stages);
    const process=(await db.query('SELECT * FROM contracts.contract_processes WHERE contract_id=$1',[c.id])).rows[0];
    assert.equal(process.template_version_id,templates[i].templateVersionId);
    assert.deepEqual(process.process_snapshot.stages,templates[i].stages);
    const steps=(await db.query('SELECT * FROM contracts.contract_process_steps WHERE process_id=$1 ORDER BY sequence_no',[process.id])).rows;
    assert.deepEqual(steps.map(s=>({id:s.step_key,name:s.name,role:s.role_key})),templates[i].stages.map(({id,name,role})=>({id,name,role})));
   }
   for(let round=0;round<=Math.max(...templates.map(x=>x.stages.length));round++){
    for(const i of [0,1]){
     if(contracts[i].status==='active')continue;
     const before=contracts[i],previous=before.stages.find(s=>s.status==='active');
     const other=await store.contract(contracts[1-i].id);
     contracts[i]=await store.advance(before.id,expected(before));
     const current=contracts[i],active=current.stages.find(s=>s.status==='active');if(active)visited[i].push(active.id);
     assert.equal(current.stages.filter(s=>s.status==='active').length,current.status==='active'?0:1);
     assert.deepEqual(await store.contract(other.id),other,'advancing one contract must not touch the other');
     assert.deepEqual(current.snapshot,snapshots[i]);
     const events=current.history.filter(e=>e.type==='workflow_advanced');
     assert.equal(events.length,before.history.filter(e=>e.type==='workflow_advanced').length+1);
     assert.ok(events.some(e=>e.templateVersionId===before.templateVersionId&&e.completedStep?.stepId===previous?.stepId&&e.nextStep?.stepId===active?.stepId));
    }
   }
   for(const [i,c] of contracts.entries()){
    assert.equal(c.status,'active');assert.deepEqual(visited[i],templates[i].stages.map(s=>s.id));assert.ok(c.stages.every(s=>s.status==='completed'));
    const process=(await db.query('SELECT status FROM contracts.contract_processes WHERE contract_id=$1',[c.id])).rows[0];assert.equal(process.status,'completed');
    const events=c.history.filter(e=>e.type==='workflow_advanced');assert.equal(events.filter(e=>e.completedStep===null).length,1);assert.equal(events.filter(e=>e.nextStep===null).length,1);
    for(const completed of c.stages){const e=events.find(e=>e.completedStep?.stepId===completed.stepId);assert.deepEqual(e.completedStep,{id:completed.id,stepId:completed.stepId,name:completed.name,role:completed.role});}
   }
  });

  await t.test('publishing a different newer flow leaves existing and explicitly pinned old contracts unchanged',async()=>{
   const original=await publish([stage('legal','legal'),stage('sign','signatory')]);
   const old=await store.createContract(input(original));const snapshot=structuredClone(old.snapshot);
   const draft=await store.saveTemplate({...original,stages:[stage('request','requester'),stage('finance','finance'),stage('execute','signatory')]},original.id);
   const latest=await store.templateAction(original.id,'publish',{revision:draft.revision,templateVersionId:draft.templateVersionId});
   const pinned=await store.createContract(input(original));const newest=await store.createContract({...common,templateId:original.id});
   assert.equal(pinned.templateVersionId,original.templateVersionId);assert.equal(newest.templateVersionId,latest.templateVersionId);
   assert.deepEqual(definition(pinned.stages),original.stages);assert.deepEqual(definition(newest.stages),latest.stages);
   const oldPreview=await store.preview(input(original,{stages:[stage('custom','operations',{required:false}),...original.stages]}));assert.equal(oldPreview.stages.length,3);
   await assert.rejects(()=>store.preview(input(original,{stages:[...original.stages].reverse()})),validation);
   assert.deepEqual((await complete(old)).active,['legal','sign']);assert.deepEqual((await store.contract(old.id)).snapshot,snapshot);
   assert.deepEqual((await complete(pinned)).active,['legal','sign']);assert.deepEqual((await complete(newest)).active,['request','finance','execute']);
  });

  await t.test('preview and creation reject required reorder, deletion, disabling, unmarking and role replacement',async()=>{
   const template=await publish([stage('request','requester'),stage('legal','legal'),stage('sign','signatory')]);
   const countBefore=(await store.contracts()).length;
   const invalid=[
    {label:'reorder',stages:[template.stages[2],template.stages[0],template.stages[1]]},
    {label:'delete',stages:template.stages.filter(s=>s.id!=='legal')},
    {label:'disable',stages:template.stages.map(s=>s.id==='legal'?{...s,enabled:false}:s)},
    {label:'unmark required',stages:template.stages.map(s=>s.id==='legal'?{...s,required:false}:s)},
    {label:'replace role',stages:template.stages.map(s=>s.id==='legal'?{...s,role:'technical'}:s)},
   ];
   for(const example of invalid)for(const operation of ['preview','createContract'])await assert.rejects(()=>store[operation](input(template,{stages:example.stages})),validation,example.label+' '+operation);
   assert.equal((await store.contracts()).length,countBefore);
  });

  await t.test('optional stages can be inserted and reordered while disabled optional stages stay skipped',async()=>{
   const template=await publish([stage('legal','legal'),stage('optional-a','operations',{required:false}),stage('optional-b','technical',{required:false}),stage('sign','signatory'),stage('unused','records',{required:false,enabled:false})]);
   const [legal,optionalA,optionalB,sign,unused]=template.stages;
   const customized=[optionalB,legal,stage('custom-review','finance',{required:false}),{...optionalA,enabled:false},sign,unused];
   const preview=await store.preview(input(template,{stages:customized}));assert.deepEqual(preview.stages,customized);
   const created=await store.createContract(input(template,{stages:customized}));const result=await complete(created);
   assert.deepEqual(result.active,['optional-b','legal','custom-review','sign']);
   assert.deepEqual(result.value.stages.filter(s=>s.status==='skipped').map(s=>s.id),['optional-a','unused']);
   assert.deepEqual(result.value.snapshot.stages,customized);
  });

  await t.test('canonical and exact legacy signature roles work as first and only steps',async()=>{
   for(const role of ['signatory','صاحب امضا','صاحب امضاء']){
    for(const tail of [[],[stage('archive','records')]]){
     const template=await publish([stage('execute',role,{name:'تکمیل سند'}),...tail]);let contract=await store.createContract(input(template));
     contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,'awaiting_signature');assert.equal(contract.stages.find(s=>s.status==='active').id,'execute');
     contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,tail.length?'in_process':'active');
     if(tail.length){assert.equal(contract.stages.find(s=>s.status==='active').id,'archive');contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,'active');}
    }
   }
  });

  await t.test('stage names and role substrings cannot mark ordinary reviews as signature stages',async()=>{
   const template=await publish([stage('start','requester'),stage('design','technical',{name:'design review'}),stage('before-sign','finance',{name:'بررسی پیش از امضا'}),stage('assignment','assignment_reviewer',{name:'assignment review'}),stage('finish','signatory',{name:'Final execution'})]);
   let contract=await store.createContract(input(template));
   for(const id of ['start','design','before-sign','assignment','finish']){
    contract=await store.advance(contract.id,expected(contract));assert.equal(contract.stages.find(s=>s.status==='active').id,id);assert.equal(contract.status,id==='finish'?'awaiting_signature':'in_process');
   }
   contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,'active');
  });

  await t.test('replaying an old step token cannot complete a later step with the same contract status',async()=>{
   const template=await publish([stage('request','requester'),stage('legal','legal'),stage('sign','signatory')]);let contract=await store.createContract(input(template));
   const starting=expected(contract);contract=await store.advance(contract.id,starting);await assert.rejects(()=>store.advance(contract.id,starting),conflict);
   const first=expected(contract);contract=await store.advance(contract.id,first);assert.equal(contract.status,'in_process');assert.equal(contract.stages.find(s=>s.status==='active').id,'legal');
   const before=structuredClone(contract);await assert.rejects(()=>store.advance(contract.id,first),conflict);assert.deepEqual(await store.contract(contract.id),before);
   contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,'awaiting_signature');contract=await store.advance(contract.id,expected(contract));assert.equal(contract.status,'active');
   await assert.rejects(()=>store.advance(contract.id,expected(contract)),conflict);
  });
 }finally{await db.close();}
});
