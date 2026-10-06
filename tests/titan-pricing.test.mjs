import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {getTitanBoard} from '../lib/titan-board.mjs';
import {provisionTitanPricing,titanPricingModel} from '../lib/titan-pricing.mjs';
import {titanProposal,titanQuote} from '../public/titan-pricing.js';

const sources=JSON.parse(await readFile(new URL('../planning/titan-revisions-v2.json',import.meta.url))).rows;
const nf=n=>new Intl.NumberFormat('fa-IR').format(n);
test('all five demo models preserve proposal totals and update every financial clause',()=>{
  for(const source of sources){
    const model=titanPricingModel(source),base=titanProposal(source,model);
    assert.equal(model.total,source.quotedAmountIRR??source.exampleMonthlyIRR);
    if(base.usage){
      assert.equal(model.items.find(i=>i.id==='ingress').quantity,774);
      const changed=structuredClone(model);changed.bases[0].amount*=2;
      const q=titanProposal(source,changed);
      assert.equal(q.pricing.total,117642000);assert.equal(q.annual,1411704000);
      assert.ok(q.body.includes('۴٬۲۰۰٬۰۰۰ ریال'));
      assert.ok(!q.body.includes('۱۰۹٬۲۴۲٬۰۰۰ ریال'));assert.ok(q.body.includes('ترافیک دریافت | تا ۲۵۰'));
      changed.items.find(i=>i.id==='ingress').quantity=9991;assert.throws(()=>titanQuote(source,changed));
    }else{
      assert.equal(base.installments.reduce((a,b)=>a+b,0),model.total);
      assert.equal(base.quarters.reduce((a,b)=>a+b,0),base.costs[3]);
      const changed=structuredClone(model);changed.bases.forEach(b=>b.amount*=2);
      const q=titanProposal(source,changed);
      assert.equal(q.pricing.total,model.total*2);
      assert.ok(!q.body.includes(nf(model.total)+' ریال'),'old total must not survive in financial clauses');
      assert.deepEqual(q.installments,base.installments.map(n=>n*2));
      assert.deepEqual(q.costs,base.costs.map(n=>n*2));
      changed.items.find(i=>i.id==='training').quantity=80;
      changed.items.find(i=>i.id==='support').quantity=6;
      const shorter=titanProposal(source,changed);
      assert.ok(shorter.body.includes('مجموع تدریس و کارگاه: ۸۰ ساعت'));
      assert.ok(shorter.body.includes('۶ ماه از پذیرش نهایی'));
      assert.equal(shorter.installments.reduce((a,b)=>a+b,0),shorter.pricing.total);
    }
  }
});

test('five proposal links are tenant scoped, revisioned, atomic and preserve originals after workflow advancement',{timeout:180000},async()=>{
  const db=await createDatabase({dataDir:'memory://'});
  try{
    const store=createStore(db,TITAN_TENANT_ID),other=createStore(db,DEMO_TENANT_ID);
    const plans=await store.pricing.list();assert.equal(plans.length,5);assert.equal((await other.pricing.list()).length,0);
    const board=await getTitanBoard(store);
    for(const p of plans){
      assert.equal(p.linkedContracts.length,1);const c=await store.contract(p.linkedContracts[0].id);
      assert.equal(c.proposalRevision.revisionNumber,3);assert.equal(c.proposalRevision.pricing.total,p.total);
      assert.equal(c.proposalRevision.pricing.sourcePlan.id,p.id);assert.equal(c.amount,null);
      assert.equal(board.rows.find(r=>r.contractId===c.id).pricingPlanId,p.id);
      await assert.rejects(()=>other.pricing.get(p.id),e=>e.status===404);
    }
    const plan=plans.find(p=>p.linkedContracts[0].intakeId==='titan-01'),before=await store.contract(plan.linkedContracts[0].id);
    const model=structuredClone(plan.model);model.bases[0].amount*=2;
    const saved=await store.pricing.save({model,revision:1},plan.id,'test-actor');
    assert.equal(saved.revision,2);assert.equal(saved.total,50400000000);
    const after=await store.contract(before.id);
    assert.equal(after.proposalRevision.revisionNumber,4);assert.equal(after.proposalRevision.pricing.total,saved.total);
    assert.deepEqual(after.snapshot,before.snapshot);assert.equal(after.originalDocument,before.originalDocument);
    assert.ok(after.document.includes('۵۰٬۴۰۰٬۰۰۰٬۰۰۰ ریال'));
    assert.equal((await db.query("SELECT count(*)::int n FROM contracts.contract_documents WHERE contract_id=$1 AND document_type='proposal_revision'",[before.id])).rows[0].n,3);
    await assert.rejects(()=>store.pricing.save({model,revision:1},plan.id),e=>e.status===409);
    const invalid=structuredClone(model);invalid.items.pop();
    await assert.rejects(()=>store.pricing.save({model:invalid,revision:2},plan.id),e=>e.status===400);
    assert.equal((await store.pricing.get(plan.id)).revision,2);
    assert.equal((await store.pricing.history(plan.id)).length,2,'failed proposal must roll back plan history');
    await provisionTitanPricing(db);await db.seed();
    assert.equal((await store.pricing.get(plan.id)).revision,2);assert.deepEqual((await store.contract(before.id)).proposalRevision,after.proposalRevision);
    await store.advance(before.id,{expectedStatus:after.status,expectedStepId:after.stages.find(s=>s.status==='active').stepId,comment:'review complete'});
    const frozen=await store.contract(before.id);model.bases[0].amount*=2;
    const latest=await store.pricing.save({model,revision:2},plan.id);
    assert.equal(latest.linkedContracts[0].editable,false);
    assert.equal((await store.contract(before.id)).document,frozen.document,'reviewed contract must not change with its source model');
  }finally{await db.close();}
});
