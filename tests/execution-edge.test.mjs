import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {canExecute} from '../public/execution-permissions.js';
test('role matrix distinguishes operational, legal and financial execution commands',()=>{
 for(const action of ['start','pause','resume','close']){assert.equal(canExecute(['contract_admin'],action),true);for(const role of ['account_manager','legal_reviewer','finance_reviewer','viewer'])assert.equal(canExecute([role],action),false);}
 for(const action of ['item','milestone','delivery','obligation','issue']){assert.equal(canExecute(['account_manager'],action),true);assert.equal(canExecute(['finance_reviewer'],action),false);}
 for(const action of ['accept','reject','change','guarantee-extend','guarantee-release']){assert.equal(canExecute(['legal_reviewer'],action),true);assert.equal(canExecute(['account_manager'],action),false);}
 for(const action of ['payment','payment-reverse','deduction-settle','deduction-reverse','retention-release','invoice-approve']){assert.equal(canExecute(['finance_reviewer'],action),true);assert.equal(canExecute(['legal_reviewer'],action),false);}
 for(const role of ['account_manager','finance_reviewer'])assert.equal(canExecute([role],'invoice'),true);assert.equal(canExecute(['viewer'],'invoice'),false);
});
test('signed changes reprice only unbilled quantity and preserve historical financial lines',{timeout:180000},async()=>{
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db);
 try{
  const data=await store.bootstrap(),template=data.templates.find(t=>t.currentPublishedVersion);let c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'تغییر اجرا',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافق',services:[]});while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null});
  let s=null;const cmd=async(action,payload)=>s=await store.execution.command(c.id,{action,payload,expectedRevision:s?.revision||0,idempotencyKey:randomUUID()});
  await cmd('start',{reference:'SIGNED',counterparties:'طرفین',confirmSigned:true,signedDate:'2026-10-01',startDate:'2026-10-01',endDate:'2027-10-01',amount:1000,advanceLimit:0,direction:'payable'});await cmd('milestone',{title:'مرحله',gross:1000,dueDate:'2026-12-01',condition:'پذیرش'});
  const item={milestoneId:s.milestones[0].id,title:'قلم',quantity:2,unitPrice:500,unit:'واحد',dueDate:'2026-12-01',owner:'مجری',criteria:'پذیرش'};
  await assert.rejects(cmd('item',{...item,quantity:3}),e=>e.status===400);await cmd('item',item);await cmd('delivery',{itemId:s.items[0].id,quantity:2,deliveredAt:'2026-10-10',reference:'DEL'});await cmd('accept',{id:s.deliveries[0].id,reference:'ACCEPT',comment:'پذیرش'});
  const invoice={kind:'progress',number:'INV-1',milestoneId:s.milestones[0].id,lines:[{itemId:s.items[0].id,quantity:1}],tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0,dueDate:'2026-12-01',reference:'INV'};await cmd('invoice',invoice);const frozen=structuredClone(s.invoices[0]);
  await assert.rejects(cmd('change',{effectiveAmount:1200,endDate:'2027-11-01',itemId:s.items[0].id,quantity:2,unitPrice:600,dueDate:'2026-12-01',reference:'BAD-CHANGE',comment:'بدون افزایش سقف'}),e=>e.status===400);
  await cmd('change',{effectiveAmount:1200,endDate:'2027-11-01',milestoneId:s.milestones[0].id,gross:1200,itemId:s.items[0].id,quantity:2,unitPrice:600,dueDate:'2026-12-01',reference:'SIGNED-CHANGE',comment:'تغییر نرخ آینده'});assert.deepEqual(s.invoices[0],frozen);assert.equal(s.basis.amount,1000);
  await cmd('invoice',{...invoice,number:'INV-2'});assert.equal(s.invoices[1].gross,600);assert.equal(s.invoices[0].gross,500);
  await cmd('item',{...item,title:'خدمت بدون هزینه',quantity:1,unitPrice:0});const free=s.items.at(-1).id;await cmd('delivery',{itemId:free,quantity:1,deliveredAt:'2026-10-10',reference:'FREE-DEL'});await cmd('accept',{id:s.deliveries.at(-1).id,reference:'FREE-ACCEPT',comment:'پذیرش خدمت بدون هزینه'});await cmd('invoice',{...invoice,number:'FREE-INV',lines:[{itemId:free,quantity:1}]});assert.equal(s.invoices.at(-1).net,0);
  await assert.rejects(cmd('change',{effectiveAmount:1200,endDate:'2027-11-01',itemId:s.items[0].id,quantity:1,unitPrice:600,dueDate:'2026-12-01',reference:'LOWER',comment:'کاهش زیر تحویل'}),e=>e.status===400);
 }finally{await db.close();}
});
