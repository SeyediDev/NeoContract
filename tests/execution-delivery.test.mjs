import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {executionDeliveryCapacity,executionDeliveryPreview} from '../public/execution-delivery.js';
import {renderExecutionDeliveryPreview} from '../public/execution-delivery-ui.js';
const state=()=>({status:'running',items:[{id:'i',title:'خدمت',unit:'بسته',quantity:2500,owner:'مجری',criteria:'معیار مستند',dueDate:'2026-12-01',unitPrice:100}],deliveries:[{id:'a',itemId:'i',quantity:1000,status:'accepted'},{id:'p',itemId:'i',quantity:750,status:'submitted',reference:'DOC',note:'شرح',deliveredAt:'2026-10-01'},{id:'r',itemId:'i',quantity:500,status:'rejected'}],invoices:[{status:'submitted',lines:[{itemId:'i',quantity:400}]},{status:'cancelled',lines:[{itemId:'i',quantity:200}]},{status:'rejected',lines:[{itemId:'i',quantity:300}]}]});
test('capacity separates pending, accepted, rejected and live billed quantities',()=>{
 assert.deepEqual(executionDeliveryCapacity(state(),'i'),{committed:'2500',accepted:'1000',pending:'750',rejected:'500',billed:'400',remaining:'750',invoiceable:'600'});
 assert.equal(executionDeliveryCapacity(state(),'unknown'),null);
});
test('delivery reserves exactly the remainder without granting invoice capacity or mutating the snapshot',()=>{
 const s=state(),frozen=structuredClone(s),r=executionDeliveryPreview(s,'delivery','i',{quantity:'0.75',deliveredAt:'2026-10-01'});
 assert.deepEqual(r.errors,[]);assert.equal(r.after.remaining,'0');assert.equal(r.after.pending,'1500');assert.equal(r.after.invoiceable,'600');assert.deepEqual(s,frozen);
 r.item.title='changed';assert.equal(s.items[0].title,'خدمت');
});
test('acceptance unlocks invoice quantity while rejection only frees replacement delivery',()=>{
 const s=state(),accepted=executionDeliveryPreview(s,'accept','p'),rejected=executionDeliveryPreview(s,'reject','p');
 assert.deepEqual(accepted.errors,[]);assert.equal(accepted.after.invoiceable,'1350');assert.equal(accepted.after.remaining,'750');assert.equal(accepted.after.pending,'0');
 assert.deepEqual(rejected.errors,[]);assert.equal(rejected.after.invoiceable,'600');assert.equal(rejected.after.remaining,'1500');assert.equal(rejected.after.rejected,'1250');assert.equal(s.deliveries[1].status,'submitted');
});
test('invalid quantities, over-delivery and invalid calendar dates cannot produce an actionable preview',()=>{
 for(const quantity of ['',0,-1,'0.0001','1e-3','1000000000000','0.751','NaN']){const r=executionDeliveryPreview(state(),'delivery','i',{quantity,deliveredAt:'2026-10-01'});assert.ok(r.errors.some(e=>e.field==='quantity'));assert.equal(r.after,null);}
 for(const deliveredAt of ['2026-02-30','2026-13-01','not a date',''])assert.ok(executionDeliveryPreview(state(),'delivery','i',{quantity:0.001,deliveredAt}).errors.some(e=>e.field==='deliveredAt'));
 const s=state();s.items[0].quantity=999999999999999;s.deliveries=[];s.invoices=[];assert.equal(executionDeliveryPreview(s,'delivery','i',{quantity:'999999999999.999',deliveredAt:'2026-10-01'}).after.remaining,'0');
});
test('missing records, reviewed deliveries and paused or closed executions are blocked',()=>{
 for(const action of ['accept','reject'])for(const id of ['a','r','missing']){const r=executionDeliveryPreview(state(),action,id);assert.ok(r.errors.length);assert.equal(r.after,null);}
 for(const status of ['paused','closed'])for(const action of ['delivery','accept','reject'])assert.ok(executionDeliveryPreview({...state(),status},action,action==='delivery'?'i':'p',{quantity:0.1,deliveredAt:'2026-10-01'}).errors.length);
 assert.ok(executionDeliveryPreview(state(),'delivery','missing').errors.length);assert.ok(executionDeliveryPreview(state(),'other','i').errors.length);
});
test('review displays original criteria and evidence as escaped text with before and after quantities',()=>{
 const s=state();s.items[0].criteria='<img src=x onerror=alert(1)>';s.deliveries[1].reference='<script>bad</script>';
 const html=renderExecutionDeliveryPreview(executionDeliveryPreview(s,'reject','p'));
 assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('tabindex="0"'));assert.ok(html.includes('پس از اقدام'));assert.ok(html.includes('معیار پذیرش'));
});
test('preview matches committed delivery, rejection and acceptance commands in a temporary database',{timeout:180000},async()=>{
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db);
 try{
  const data=await store.bootstrap();let c=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'پیش‌نمایش تحویل',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافق آزمون',services:[]});
  while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null});
  let s=null;const cmd=async(action,payload)=>{const r=['delivery','accept','reject'].includes(action)?executionDeliveryPreview(s,action,payload.itemId||payload.id,payload):null;if(r)assert.deepEqual(r.errors,[]);s=await store.execution.command(c.id,{action,payload,expectedRevision:s?.revision||0,idempotencyKey:randomUUID()});if(r)assert.deepEqual(executionDeliveryCapacity(s,r.item.id),r.after);};
  await cmd('start',{reference:'SIGNED',counterparties:'طرفین آزمون',confirmSigned:true,signedDate:'2026-10-01',startDate:'2026-10-01',endDate:'2027-10-01',amount:1000,advanceLimit:0,direction:'receivable'});
  await cmd('milestone',{title:'مرحله',gross:1000,dueDate:'2026-12-01',condition:'پذیرش'});await cmd('item',{milestoneId:s.milestones[0].id,title:'قلم',quantity:2.5,unitPrice:100,unit:'بسته',dueDate:'2026-12-01',owner:'مجری',criteria:'مدرک پذیرش'});
  const itemId=s.items[0].id,delivery=quantity=>({itemId,quantity,deliveredAt:'2026-10-01',reference:'DEL'}),review=id=>({id,reference:'REVIEW',comment:'بررسی مستند'});
  await cmd('delivery',delivery('1'));await cmd('accept',review(s.deliveries[0].id));
  await cmd('invoice',{kind:'progress',number:'INV',milestoneId:s.milestones[0].id,lines:[{itemId,quantity:0.4}],tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0,dueDate:'2026-12-01',reference:'INV'});
  const historic=structuredClone(s.invoices);await cmd('delivery',delivery('0.75'));await cmd('reject',review(s.deliveries[1].id));await cmd('delivery',delivery('1.5'));await cmd('accept',review(s.deliveries[2].id));assert.deepEqual(s.invoices,historic);
  assert.equal(executionDeliveryCapacity(s,itemId).remaining,'0');assert.equal(executionDeliveryCapacity(s,itemId).invoiceable,'2100');
  const before=await store.execution.read(c.id);await assert.rejects(store.execution.command(c.id,{action:'delivery',payload:delivery('0.001'),expectedRevision:s.revision,idempotencyKey:randomUUID()}),e=>e.status===400);assert.deepEqual(await store.execution.read(c.id),before);
 }finally{await db.close();}
});
