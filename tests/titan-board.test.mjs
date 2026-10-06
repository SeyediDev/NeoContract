import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, DEMO_TENANT_ID } from '../lib/database.mjs';
import { createStore } from '../lib/store.mjs';
import { getTitanBoard, provisionTitanBoard } from '../lib/titan-board.mjs';

const titanId='00000000-0000-0000-0000-000000000002';
const nextInput=c=>({expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId,comment:'بررسی آزمون در پایگاه موقت'});

test('Titan source contracts exercise persistent catalog, published templates and real review workflows', {timeout:180000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'neocontract-titan-'));
  let db=await createDatabase({dataDir:join(dir,'postgres')});
  try {
    let store=createStore(db,titanId);
    const board=await getTitanBoard(store);
    const catalog=await store.catalog();
    const customers=await store.customers();
    assert.equal(board.rows.length,10);
    assert.equal(board.stats.contracts,6);
    assert.equal(board.stats.scopes,4);
    assert.equal(board.proposalVersion,2);
    assert.equal(board.source.path,undefined,'Authoring paths do not leave the server');
    assert.equal(catalog.centers.length,14);
    assert.deepEqual(customers.map(c=>c.name).sort(),['انتخاب','باسلام'].sort());
    for(const center of catalog.centers) assert.ok(center.services.length>0,`${center.name} needs at least one matchable catalog item`);
    for(const row of board.rows) {
      const service=catalog.services.find(s=>s.code===row.serviceCode);
      assert.equal(service?.centerId,row.centerId,row.id);
      assert.equal(row.mappingStatus,'proposed');
      assert.ok(row.confirmationFlags.length>0);
      if(row.kind==='product-scope') {assert.equal(row.contractId,null);assert.ok(row.scope.length>250);continue;}
      const contract=await store.contract(row.contractId);
      const template=await store.selectedTemplate(row.templateId,contract.templateVersionId);
      assert.equal(template.status,'published');
      assert.equal(contract.status,'in_process');
      assert.equal(contract.stages.filter(s=>s.status==='active').length,1);
      assert.equal(contract.stages.find(s=>s.status==='active').id,'scope');
      if(row.proposalStatus){
        assert.equal(contract.proposalRevision?.revisionNumber,3);
        assert.equal(contract.proposalRevision?.priceSummary,row.priceSummary);
        assert.ok(contract.document.includes(row.title));
        if(row.id==='titan-04'){
          assert.equal(row.serviceCode,'FCL-01');
          assert.equal(row.pricingType,'usage');
          assert.equal(row.quotedAmountIRR,null);
          assert.equal(row.exampleMonthlyIRR,109242000);
          assert.equal(contract.originalDocument,contract.snapshot.document);
          assert.equal(contract.snapshot.intake.supersedesContractId,row.previousContractId);
          const old=await store.contract(row.previousContractId);
          assert.equal(old.status,'cancelled');
          assert.equal(old.document,old.snapshot.template.body);
        }else{
          assert.equal(row.pricingType,'fixed');
          assert.equal(row.quotedAmountIRR,{'titan-01':36000000000,'titan-02':72000000000,'titan-03':42000000000,'titan-05':24000000000}[row.id]);
          assert.equal(contract.originalDocument,contract.snapshot.template.body);
        }
      }else assert.equal(contract.document,contract.snapshot.template.body);
      assert.equal(contract.services[0].code,row.serviceCode);
      assert.equal(contract.amount,null,'An unknown fee is not a free contract');
      assert.equal(contract.start,'');assert.equal(contract.end,'');
      assert.equal(contract.services[0].slaTier,null);
      assert.ok(contract.document.length>1200);
      assert.equal(contract.history[0].type,row.id==='titan-04'?'titan_proposal_started':'titan_intake_started');
      if(['سلام پی','سلام‌پی','زودکس'].includes(row.sourceCustomer))assert.equal(contract.customerId,null);
    }
    await t.test('intake retries preserve documents and active steps',async()=>{
      const before=await store.contracts();
      await provisionTitanBoard(db);await provisionTitanBoard(db);
      assert.deepEqual(await store.contracts(),before);
    });
    await t.test('draft commercial gaps block entry into signature',async()=>{
      let c=await store.contract(board.rows.find(r=>r.kind==='contract').contractId);
      c=await store.advance(c.id,nextInput(c));
      assert.equal(c.stages.find(s=>s.status==='active').id,'commercial');
      c=await store.advance(c.id,nextInput(c));
      assert.equal(c.stages.find(s=>s.status==='active').id,'legal');
      await assert.rejects(()=>store.advance(c.id,nextInput(c)),e=>e.status===409);
      assert.equal((await store.contract(c.id)).stages.find(s=>s.status==='active').id,'legal');
    });
    await t.test('using an intake template cannot strip source flags and sign its unresolved text',async()=>{
      const row=board.rows.find(r=>r.kind==='contract');
      const original=await store.contract(row.contractId);
      const template=await store.selectedTemplate(row.templateId,original.templateVersionId);
      const input={templateId:template.id,templateVersionId:template.templateVersionId,customerId:customers[0].id,title:'نسخه آزمون از الگوی ورودی',amount:1,start:'2026-10-01',end:'2027-10-01',owner:'آزمون',paymentTerms:'شرایط آزمون',services:[],intake:{confirmationFlags:[]},metadata:{intakeId:null}};
      let c=await store.createContract(input);
      assert.equal(c.metadata.intakeId,row.id);
      assert.deepEqual(c.snapshot.intake.confirmationFlags,row.confirmationFlags);
      assert.ok(c.document.includes(template.body));
      for(let i=0;i<3;i++)c=await store.advance(c.id,nextInput(c));
      assert.equal(c.stages.find(s=>s.status==='active').id,'legal');
      await assert.rejects(()=>store.advance(c.id,nextInput(c)),e=>e.status===409&&e.message.includes('نسخه ثابت'));
      const normal=(await store.templates()).find(t=>!t.intake&&t.currentPublishedVersion);
      const clean=await store.createContract({...input,templateId:normal.id,templateVersionId:normal.currentPublishedVersion.templateVersionId});
      assert.equal(clean.snapshot.intake,undefined,'A normal negotiated base template does not inherit intake flags');
      assert.equal(clean.metadata.intakeId,undefined);
    });
    await t.test('data and workflow survive reopening and reseeding',async()=>{
      const before=await store.contracts();
      await db.close();db=await createDatabase({dataDir:join(dir,'postgres')});store=createStore(db,titanId);
      assert.deepEqual(await store.contracts(),before);
      assert.equal((await getTitanBoard(store)).rows.length,10);
    });
    await t.test('legacy tenant cannot see or change a Titan record',async()=>{
      const other=createStore(db,DEMO_TENANT_ID);
      assert.equal((await getTitanBoard(other)).rows.length,0);
      const id=board.rows.find(r=>r.contractId).contractId;
      await assert.rejects(()=>other.contract(id),e=>e.status===404);
      await assert.rejects(()=>other.advance(id,{expectedStatus:'in_process'}),e=>e.status===404);
    });
  } finally {await db.close();await rm(dir,{recursive:true,force:true});}
});
