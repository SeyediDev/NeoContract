import test from 'node:test';
import assert from 'node:assert/strict';
import {executionSummary} from '../lib/execution.mjs';
import {executionFollowups} from '../public/execution-followups.js';
import {executionActionAvailable} from '../public/execution-permissions.js';
const today='2026-10-10';
const state=()=>({status:'running',basis:{direction:'receivable'},effectiveAmount:10000,endDate:'2027-10-01',items:[],deliveries:[],milestones:[],invoices:[],payments:[],reversals:[],deductionSettlements:[],deductionReversals:[],obligations:[],guarantees:[],issues:[],changes:[]});
const invoice=(id,status='approved')=>({id,number:id,status,kind:'progress',lines:[],gross:1000,net:900,tax:0,retention:0,withholding:100,insurance:0,advanceRecovery:0,dueDate:today});
const followups=s=>executionSummary(s,today).followups;
test('follow-up date boundaries include today and exactly 14 days, ignore released guarantees',()=>{
 const s=state();s.endDate='2026-10-24';s.obligations=[{id:'late',title:'تعهد',owner:'مجری',condition:'مدرک',status:'open',dueDate:'2026-10-09'},{id:'done',status:'completed',dueDate:'2026-10-01'}];
 s.guarantees=['2026-10-09','2026-10-10','2026-10-24','2026-10-25'].map((expiryDate,id)=>({id:String(id),reference:'G-'+id,status:'held',expiryDate,amount:1}));s.guarantees.push({id:'released',status:'released',expiryDate:'2026-10-01'});
 const before=structuredClone(s),f=followups(s);assert.equal(f.until,'2026-10-24');assert.equal(f.counts.total,5);assert.equal(f.counts.overdue,2);assert.equal(f.counts.near,3);assert.equal(f.rows.find(r=>r.recordId==='late').daysLate,1);assert.ok(!f.rows.some(r=>r.recordId==='3'||r.recordId==='released'));assert.deepEqual(s,before);
 assert.throws(()=>executionFollowups(s,executionSummary(s,today),{today:'2026-02-30'}),/Invalid/);
});
test('partial delivery, rejected delivery and cancelled billing leave exact remaining work',()=>{
 const s=state();s.items=[{id:'item',title:'قلم',unit:'بسته',quantity:2000,unitPrice:1000,owner:'مجری',dueDate:'2026-10-09'}];
 s.deliveries=[{id:'accepted',itemId:'item',quantity:1000,status:'accepted'},{id:'review',itemId:'item',quantity:500,status:'submitted',reference:'DEL'},{id:'rejected',itemId:'item',quantity:500,status:'rejected'}];
 s.invoices=[{...invoice('live'),lines:[{itemId:'item',quantity:500}]},{...invoice('cancelled','cancelled'),lines:[{itemId:'item',quantity:500}]}];
 const rows=followups(s).rows;assert.match(rows.find(r=>r.kind==='item-delivery').detail,/۰٫۵/);assert.match(rows.find(r=>r.kind==='item-billing').detail,/۰٫۵/);assert.equal(rows.filter(r=>r.kind==='delivery-review').length,1);assert.equal(rows.find(r=>r.kind==='delivery-review').actionId,'review');assert.equal(rows.find(r=>r.kind==='delivery-review').review,true);
});
test('reversed receipts restore balances; disputed statements never offer payment or deduction settlement',()=>{
 const s=state();s.invoices=[invoice('approved'),invoice('disputed','disputed'),invoice('pending','submitted'),invoice('cancelled','cancelled'),invoice('rejected','rejected')];
 s.payments=[{id:'effective',invoiceId:'approved',amount:200},{id:'reversed',invoiceId:'approved',amount:700}];s.reversals=[{paymentId:'reversed'}];
 s.deductionSettlements=[{id:'tax-effective',invoiceId:'approved',kind:'withholding',amount:40},{id:'tax-reversed',invoiceId:'approved',kind:'withholding',amount:60}];s.deductionReversals=[{settlementId:'tax-reversed'}];
 const f=followups(s);assert.equal(f.rows.find(r=>r.key==='invoice-payment:approved').amount,700);assert.equal(f.rows.find(r=>r.key==='invoice-deductions:approved').amount,60);assert.equal(f.rows.find(r=>r.key==='invoice-deductions:approved').dueDate,null);assert.equal(f.rows.find(r=>r.key==='invoice-deductions:disputed').action,null);assert.ok(!f.rows.some(r=>r.key==='invoice-payment:disputed'));assert.equal(f.rows.find(r=>r.key==='invoice-review:pending').amount,900);assert.equal(f.counts.review,2);assert.ok(!f.rows.some(r=>['cancelled','rejected'].includes(r.recordId)));
});
test('pause blocks operational review, keeps finance settlement available, closure clears follow-ups',()=>{
 const s=state();s.status='paused';s.invoices=[invoice('approved'),invoice('review','submitted'),invoice('dispute','disputed')];s.obligations=[{id:'o',status:'open',dueDate:today,title:'تعهد',owner:'مجری',condition:'مدرک'}];
 const f=followups(s);assert.ok(f.rows.find(r=>r.kind==='obligation').blockedReason);assert.ok(f.rows.find(r=>r.kind==='invoice-review').blockedReason);assert.equal(f.rows.find(r=>r.kind==='invoice-payment').blockedReason,null);assert.equal(f.rows.find(r=>r.kind==='invoice-dispute').blockedReason,null);
 assert.equal(executionActionAvailable('paused','accept'),false);assert.equal(executionActionAvailable('paused','payment'),true);assert.equal(executionActionAvailable('closed','payment'),false);
 s.status='closed';assert.equal(followups(s).counts.total,0);assert.deepEqual(followups(s).rows,[]);assert.equal(executionFollowups(null,null,{today}).counts.total,0);
});
test('retention action needs effective payment and disappears after release; money remains exact',()=>{
 const s=state();s.invoices=[{...invoice('retained'),retention:100,withholding:0}];s.payments=[{id:'pay',invoiceId:'retained',amount:900}];
 assert.equal(followups(s).rows.find(r=>r.kind==='retention').action,'retention-release');s.reversals=[{paymentId:'pay'}];assert.equal(followups(s).rows.find(r=>r.kind==='retention').action,null);
 s.reversals=[];s.invoices.push({...invoice('released'),kind:'retention',gross:0,net:100,withholding:0});assert.ok(!followups(s).rows.some(r=>r.kind==='retention'));
 s.invoices=[{...invoice('big'),gross:Number.MAX_SAFE_INTEGER,net:Number.MAX_SAFE_INTEGER,withholding:0}];s.payments=[{id:'small',invoiceId:'big',amount:1}];assert.equal(followups(s).rows.find(r=>r.kind==='invoice-payment').amount,Number.MAX_SAFE_INTEGER-1);
});
