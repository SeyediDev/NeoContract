import test from 'node:test';
import assert from 'node:assert/strict';
import {executionReversalPreview} from '../public/execution-finance.js';
const state=()=>({status:'running',basis:{advanceLimit:500},effectiveAmount:1000,milestones:[],items:[],deliveries:[],invoices:[{id:'i',number:'INV',kind:'progress',status:'approved',net:600,gross:1000,retention:100,withholding:50,insurance:50,advanceRecovery:200,lines:[]},{id:'a',number:'ADV',kind:'advance',status:'approved',net:500,gross:500,retention:0,withholding:0,insurance:0,advanceRecovery:0,lines:[]}],payments:[{id:'p',invoiceId:'i',amount:600,reference:'PAY'},{id:'a1',invoiceId:'a',amount:200,reference:'ADV-1'},{id:'a2',invoiceId:'a',amount:300,reference:'ADV-2'}],reversals:[],deductionSettlements:[{id:'d',invoiceId:'i',kind:'withholding',amount:50,reference:'TAX'}],deductionReversals:[]});
test('reversal preview reopens the exact invoice balance and identifies retention consequences without mutation',()=>{
 const s=state(),before=structuredClone(s),r=executionReversalPreview(s,'payment-reverse','p');
 assert.deepEqual(r.errors,[]);assert.equal(r.amount,'600');assert.equal(r.paidBefore,'600');assert.equal(r.paidAfter,'0');assert.equal(r.remainingBefore,'0');assert.equal(r.remainingAfter,'600');assert.match(r.effects[0],/مجوزهای قبلی/);assert.deepEqual(s,before);
 s.invoices[0].kind='retention';s.invoices[0].retention=0;const release=executionReversalPreview(s,'payment-reverse','p');assert.match(release.effects[0],/سپرده آزاد‌نشده تغییر نمی‌کند/);
 s.invoices[0].status='disputed';assert.deepEqual(executionReversalPreview(s,'payment-reverse','p').errors,[]);s.status='paused';assert.deepEqual(executionReversalPreview(s,'payment-reverse','p').errors,[]);
});
test('advance reversal uses all effective funding and live recovery reservations, including pending invoices',()=>{
 const s=state();let r=executionReversalPreview(s,'payment-reverse','a2');assert.equal(r.advanceBefore,'300');assert.equal(r.advanceAfter,'0');assert.deepEqual(r.errors,[]);
 s.reversals.push({paymentId:'a2'});r=executionReversalPreview(s,'payment-reverse','a1');assert.equal(r.advanceBefore,'0');assert.equal(r.advanceAfter,'-200');assert.match(r.errors[0],/بازیافت رزرو/);
 s.invoices[0].status='submitted';assert.ok(executionReversalPreview(s,'payment-reverse','a1').errors.length);
 for(const status of ['cancelled','rejected']){s.invoices[0].status=status;r=executionReversalPreview(s,'payment-reverse','a1');assert.deepEqual(r.errors,[]);assert.equal(r.advanceAfter,'0');}
});
test('deduction reversal reopens only its own tax or insurance balance and rejects repeated or closed reversals',()=>{
 const s=state(),before=structuredClone(s);let r=executionReversalPreview(s,'deduction-reverse','d');assert.equal(r.remainingBefore,'0');assert.equal(r.remainingAfter,'50');assert.match(r.effects[0],/خالص صورت‌وضعیت تغییر نمی‌کند/);assert.deepEqual(s,before);
 s.deductionSettlements[0].kind='insurance';assert.equal(executionReversalPreview(s,'deduction-reverse','d').kind,'insurance');
 s.deductionReversals.push({settlementId:'d'});r=executionReversalPreview(s,'deduction-reverse','d');assert.equal(r.remainingBefore,'50');assert.equal(r.remainingAfter,'50');assert.match(r.errors[0],/قبلاً/);
 s.reversals.push({paymentId:'p'});r=executionReversalPreview(s,'payment-reverse','p');assert.equal(r.remainingAfter,'600');assert.match(r.errors[0],/قبلاً/);
 s.status='closed';assert.ok(executionReversalPreview(s,'payment-reverse','a1').errors.some(message=>message.includes('خاتمه')));assert.ok(executionReversalPreview(s,'deduction-reverse','d').errors.some(message=>message.includes('خاتمه')));
 assert.ok(executionReversalPreview(s,'payment-reverse','missing').errors.length);
});
test('reversal amounts remain exact at the maximum safe rial boundary',()=>{
 const s=state();s.invoices[0].net=Number.MAX_SAFE_INTEGER;s.payments[0].amount=Number.MAX_SAFE_INTEGER;s.reversals=[];
 const r=executionReversalPreview(s,'payment-reverse','p');assert.equal(r.paidAfter,'0');assert.equal(r.remainingAfter,'9007199254740991');assert.equal(r.amount,'9007199254740991');
});
