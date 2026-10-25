import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {executionDecisionActions,executionDecisionPreview} from '../public/execution-decision.js';
import {renderExecutionDecisionPreview,renderExecutionDecisionHistory} from '../public/execution-decision-ui.js';
const invoice=()=>({id:'i',number:'DOC-1',kind:'progress',status:'submitted',reference:'ORIGINAL',basis:'بند کسورات',dueDate:'2026-12-01',gross:200,tax:20,retention:20,withholding:5,insurance:5,penalty:0,advanceRecovery:10,net:180,lines:[{itemId:'item',title:'خدمت',quantity:1250,unitPrice:160,amount:200}],decisions:[]});
const state=()=>({status:'running',invoices:[invoice()],payments:[],reversals:[]});

test('financial decisions match status transitions without changing the invoice snapshot',()=>{
 for(const [action,from,to] of [['invoice-approve','submitted','approved'],['invoice-reject','submitted','rejected'],['invoice-dispute','approved','disputed'],['invoice-resolve','disputed','approved']]){
  const s=state();s.invoices[0].status=from;const frozen=structuredClone(s),r=executionDecisionPreview(s,action,'i');
  assert.deepEqual(r.errors,[]);assert.equal(r.before.status,from);assert.equal(r.after.status,to);assert.equal(r.after.paymentAvailable,to==='approved');assert.deepEqual(s,frozen);r.invoice.reference='changed';assert.equal(s.invoices[0].reference,'ORIGINAL');
 }
});
test('paused financial decisions match server permissions and closed or stale records are blocked',()=>{
 for(const action of executionDecisionActions){
  const s=state();s.status='paused';s.invoices[0].status=action==='invoice-dispute'?'approved':action==='invoice-resolve'?'disputed':'submitted';
  const r=executionDecisionPreview(s,action,'i');assert.equal(r.errors.length===0,['invoice-dispute','invoice-resolve'].includes(action));
  s.status='closed';assert.equal(executionDecisionPreview(s,action,'i').after,null);
 }
 const s=state();for(const action of executionDecisionActions){s.invoices[0].status='cancelled';assert.equal(executionDecisionPreview(s,action,'i').after,null);assert.equal(executionDecisionPreview(s,action,'missing').after,null);}
 assert.ok(executionDecisionPreview(s,'invoice-cancel','i').errors.length);
});
test('effective and reversed receipts remain separate and exact, including a settled or zero net document',()=>{
 const s=state(),i=s.invoices[0];i.status='disputed';i.net=Number.MAX_SAFE_INTEGER;s.payments=[{id:'one',invoiceId:'i',amount:1},{id:'old',invoiceId:'i',amount:Number.MAX_SAFE_INTEGER},{id:'other',invoiceId:'other',amount:200}];s.reversals=[{paymentId:'old'}];
 const r=executionDecisionPreview(s,'invoice-resolve','i');assert.equal(r.financial.remaining,'9007199254740990');assert.equal(r.financial.reversed,'9007199254740991');assert.equal(r.financial.paid,'1');
 i.net=1;assert.equal(executionDecisionPreview(s,'invoice-resolve','i').after.paymentAvailable,false);
 i.net=0;s.payments=[];assert.equal(executionDecisionPreview(s,'invoice-resolve','i').after.paymentAvailable,false);
 i.kind='retention';assert.deepEqual(executionDecisionPreview(s,'invoice-resolve','i').errors,[]);
});
test('review and decision history escape source and permit evidence, preserve historical rates and identify the document',()=>{
 const s=state(),i=s.invoices[0];i.reference='<script>original</script>';i.lines[0].title='<img src=x onerror=alert(1)>';i.decisions=[{action:'invoice-dispute',at:'bad-date',reference:'<b>permit</b>',comment:'<svg onload=alert(1)>'}];
 const html=renderExecutionDecisionPreview(executionDecisionPreview(s,'invoice-approve','i'));assert.ok(html.includes('DOC-1'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;svg'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('1.25'));assert.ok(html.includes('۱۶۰ ریال'));assert.ok(html.includes('tabindex="0"'));assert.ok(html.includes('ردیف‌های تاریخی'));assert.ok(!html.includes('Invalid Date'));assert.equal(renderExecutionDecisionHistory({...i,decisions:[]}),'');
 assert.ok(renderExecutionDecisionPreview(executionDecisionPreview(s,'invoice-approve','missing')).includes('یافت نشد'));
 for(const [direction,label] of [['receivable','دریافت از مشتری'],['payable','پرداخت به طرف قرارداد']]){s.basis={direction};assert.ok(renderExecutionDecisionPreview(executionDecisionPreview(s,'invoice-approve','i')).includes(label));}
});

test('decision preview matches actual approvals, rejection, dispute and resolution while preserving receipts and financial snapshots',{timeout:180000},async()=>{
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db);
 try{
  const data=await store.bootstrap();let c=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'پذیرش تصمیم مالی',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'مدرک',services:[]});while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(x=>x.status==='active')?.stepId||null});
  let s=null;const cmd=async(action,payload)=>{const r=executionDecisionActions.includes(action)?executionDecisionPreview(s,action,payload.id):null;if(r)assert.deepEqual(r.errors,[]);s=await store.execution.command(c.id,{action,payload,expectedRevision:s?.revision||0,idempotencyKey:randomUUID()});if(r){const after=s.invoices.find(i=>i.id===payload.id);assert.equal(after.status,r.after.status);const {status,decisions,...record}=after,{status:oldStatus,decisions:oldDecisions,...original}=r.invoice;assert.deepEqual(record,original);assert.equal(decisions.length,oldDecisions.length+1);}return s;};
  await cmd('start',{reference:'SIGNED',counterparties:'طرفین',confirmSigned:true,signedDate:'2026-10-01',startDate:c.start,endDate:c.end,amount:1000,advanceLimit:200,direction:'receivable'});
  const payload={kind:'advance',number:'ADV-1',gross:100,tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0,dueDate:'2026-12-01',reference:'INV'};
  await cmd('invoice',payload);const id=s.invoices[0].id;await cmd('invoice-approve',{id,reference:'APP',comment:'تأیید'});await cmd('payment',{invoiceId:id,amount:30,paidAt:'2026-10-25',reference:'PAY',method:'حواله'});const payments=structuredClone(s.payments);
  await cmd('pause',{reference:'PAUSE',comment:'توقف'});await cmd('invoice-dispute',{id,reference:'DISPUTE',comment:'اختلاف مستند'});
  const frozen=await store.execution.read(c.id);await assert.rejects(store.execution.command(c.id,{action:'payment',payload:{invoiceId:id,amount:10,paidAt:'2026-10-25',reference:'BLOCKED',method:'حواله'},expectedRevision:s.revision,idempotencyKey:randomUUID()}),e=>e.status===409);assert.deepEqual(await store.execution.read(c.id),frozen);
  await cmd('invoice-resolve',{id,reference:'RESOLVE',comment:'رفع مستند'});assert.equal(s.status,'paused');assert.deepEqual(s.payments,payments);assert.equal(s.invoices[0].decisions[1].reference,'DISPUTE');
  await cmd('resume',{reference:'RESUME',comment:'ادامه'});await cmd('invoice',{...payload,number:'ADV-2'});const rejected=s.invoices[1].id;await cmd('invoice-reject',{id:rejected,reference:'REJECT',comment:'رد مستند'});assert.equal(s.invoices[1].number,'ADV-2');
  await cmd('invoice',{...payload,number:'ADV-3'});assert.equal(s.invoices[2].gross,100);assert.deepEqual(s.payments,payments);assert.equal(s.summary.advanceOutstanding,30);
 }finally{await db.close();}
});
