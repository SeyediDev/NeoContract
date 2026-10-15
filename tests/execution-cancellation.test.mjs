import test from 'node:test';
import assert from 'node:assert/strict';
import {executionCancellationPreview} from '../public/execution-finance.js';
const state=()=>({status:'running',basis:{advanceLimit:500},effectiveAmount:1000,milestones:[{id:'m',title:'مرحله',gross:1000}],items:[{id:'item',milestoneId:'m',quantity:2000,unitPrice:500,unit:'بسته'}],deliveries:[{itemId:'item',quantity:2000,status:'accepted'}],invoices:[{id:'a',number:'ADV',kind:'advance',status:'approved',net:500,gross:500,retention:0,withholding:0,insurance:0,advanceRecovery:0,lines:[]},{id:'i',number:'INV',kind:'progress',status:'approved',milestoneId:'m',net:600,gross:1000,retention:100,withholding:50,insurance:50,advanceRecovery:200,lines:[{itemId:'item',title:'خدمت',quantity:2000,unitPrice:500,amount:1000}]}],payments:[{id:'fund',invoiceId:'a',amount:500,reference:'FUND'}],reversals:[],deductionSettlements:[],deductionReversals:[]});
test('cancellation restores only live invoice capacity and accepted quantities without mutating historic evidence',()=>{
 const s=state(),before=structuredClone(s),r=executionCancellationPreview(s,'i');
 assert.deepEqual(r.errors,[]);assert.equal(r.before.contractRemaining,'0');assert.equal(r.after.contractRemaining,'1000');assert.equal(r.after.stageRemaining,'1000');assert.equal(r.before.lines[0].availableUnits,'0');assert.equal(r.after.lines[0].availableUnits,'2000');assert.equal(r.after.advanceRecoverable,'500');assert.equal(r.before.advanceRecoverable,'300');assert.equal(r.before.retentionHeld,'100');assert.equal(r.after.retentionHeld,'0');assert.deepEqual(s,before);
 s.invoices[1].status='submitted';assert.equal(executionCancellationPreview(s,'i').before.retentionHeld,'0');assert.equal(executionCancellationPreview(s,'i').after.advanceRecoverable,'500');
 for(const status of ['rejected','cancelled']){s.invoices[1].status=status;const p=executionCancellationPreview(s,'i');assert.ok(p.errors.length);assert.equal(p.after,null);assert.equal(p.before.contractRemaining,'1000');}
});
test('effective payment and deduction references block cancellation while reversed receipts preserve their audit only',()=>{
 const s=state();s.payments.push({id:'pay',invoiceId:'i',amount:600,reference:'PAY-I'});s.deductionSettlements.push({id:'tax',invoiceId:'i',kind:'withholding',amount:50,reference:'TAX-I'},{id:'insurance',invoiceId:'i',kind:'insurance',amount:50,reference:'INS-I'});
 let r=executionCancellationPreview(s,'i');assert.equal(r.after,null);assert.match(r.errors.join(' '),/PAY-I/);assert.match(r.errors.join(' '),/TAX-I/);assert.match(r.errors.join(' '),/INS-I/);
 s.reversals.push({paymentId:'pay'});s.deductionReversals.push({settlementId:'tax'},{settlementId:'insurance'});r=executionCancellationPreview(s,'i');assert.deepEqual(r.errors,[]);assert.equal(r.after.contractRemaining,'1000');assert.equal(s.payments.length,2);
});
test('retention authorizations require sufficient other sources and cancel independently of their receipt',()=>{
 const s=state(),release={id:'r',number:'RET-1',kind:'retention',status:'approved',net:60,gross:0,retention:0,withholding:0,insurance:0,advanceRecovery:0,lines:[]};s.invoices.push(release);
 let r=executionCancellationPreview(s,'i');assert.equal(r.after,null);assert.match(r.errors.join(' '),/RET-1/);
 r=executionCancellationPreview(s,'r');assert.deepEqual(r.errors,[]);assert.equal(r.before.retentionRemaining,'40');assert.equal(r.after.retentionRemaining,'100');assert.equal(r.after.retentionReserved,'0');assert.equal(r.after.contractRemaining,'0');
 s.invoices.push({...s.invoices[1],id:'other',number:'OTHER',gross:0,retention:60,advanceRecovery:0,lines:[]});assert.deepEqual(executionCancellationPreview(s,'i').errors,[]);
 s.invoices.at(-1).status='submitted';assert.equal(executionCancellationPreview(s,'i').after,null);
 for(const status of ['cancelled','rejected']){s.invoices[2].status=status;assert.deepEqual(executionCancellationPreview(s,'i').errors,[]);}
});
test('advance cancellation restores issuance limit only after refunds and reservation correction; lifecycle and exact money remain enforced',()=>{
 const s=state();assert.equal(executionCancellationPreview(s,'a').after,null);s.reversals.push({paymentId:'fund'});assert.equal(executionCancellationPreview(s,'a').after,null);s.invoices[1].status='cancelled';const r=executionCancellationPreview(s,'a');assert.deepEqual(r.errors,[]);assert.equal(r.before.advanceAvailable,'0');assert.equal(r.after.advanceAvailable,'500');
 s.status='paused';assert.match(executionCancellationPreview(s,'a').errors.join(' '),/متوقف/);s.status='closed';assert.equal(executionCancellationPreview(s,'a').after,null);assert.ok(executionCancellationPreview(s,'missing').errors.length);
 const exact=state();exact.effectiveAmount=Number.MAX_SAFE_INTEGER;exact.milestones[0].gross=Number.MAX_SAFE_INTEGER;exact.invoices[1].gross=Number.MAX_SAFE_INTEGER;assert.equal(executionCancellationPreview(exact,'i').after.contractRemaining,'9007199254740991');assert.equal(executionCancellationPreview(exact,'i').after.stageRemaining,'9007199254740991');
});
