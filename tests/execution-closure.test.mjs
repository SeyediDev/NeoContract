import test from 'node:test';
import assert from 'node:assert/strict';
import {executionClosure} from '../public/execution-closure.js';
const invoice=(fields={})=>({id:'inv',number:'INV',status:'approved',kind:'final',net:1000,retention:0,withholding:0,insurance:0,advanceRecovery:0,lines:[{itemId:'item',quantity:1000}],...fields});
const state=()=>({status:'running',items:[{id:'item',title:'قلم',quantity:1000,unit:'واحد'}],deliveries:[{id:'delivery',itemId:'item',quantity:1000,status:'accepted'}],invoices:[invoice()],payments:[{id:'pay',invoiceId:'inv',amount:1000}],reversals:[],deductionSettlements:[],deductionReversals:[],obligations:[],issues:[],guarantees:[]});
const rows=(result,key)=>result.groups.find(g=>g.key===key).rows;

test('closure checks actual records, ignores rejected/cancelled documents and includes zero-price items',()=>{
 const s=state(),before=structuredClone(s);assert.equal(executionClosure(s).ready,true);assert.deepEqual(s,before);
 s.invoices.push(invoice({id:'rejected',status:'rejected',retention:99}),invoice({id:'cancelled',status:'cancelled',advanceRecovery:99}));s.deliveries.push({itemId:'item',status:'rejected',quantity:500});assert.equal(executionClosure(s).ready,true);
 s.items.push({id:'free',title:'قلم رایگان',quantity:1,unit:'واحد'});s.deliveries.push({itemId:'free',quantity:1,status:'accepted'});assert.equal(rows(executionClosure(s),'items')[0].billed,'0');
 s.invoices.push(invoice({id:'free-inv',number:'FREE',net:0,lines:[{itemId:'free',quantity:1}]}));assert.equal(executionClosure(s).ready,true);
 s.invoices.at(-1).status='submitted';assert.equal(rows(executionClosure(s),'items').length,0);assert.equal(rows(executionClosure(s),'invoices').length,1);assert.equal(executionClosure(s).ready,false);
 s.invoices.at(-1).status='cancelled';assert.equal(rows(executionClosure(s),'items').length,1);
 s.items=[];assert.equal(rows(executionClosure(s),'items')[0].id,'no-items');
});

test('closure traces receipt reversals, reserved recovery, released retention and deduction reversals exactly',()=>{
 const s=state();s.invoices[0]=invoice({net:600,retention:100,withholding:100,insurance:100,advanceRecovery:100});s.payments[0].amount=600;
 s.invoices.push(invoice({id:'advance',number:'ADV',kind:'advance',net:100,lines:[]}),invoice({id:'retention',number:'RET',kind:'retention',net:100,lines:[]}));s.payments.push({id:'adv-pay',invoiceId:'advance',amount:100},{id:'ret-pay',invoiceId:'retention',amount:100});
 s.deductionSettlements=[{id:'tax',invoiceId:'inv',kind:'withholding',amount:100},{id:'insurance',invoiceId:'inv',kind:'insurance',amount:100}];assert.equal(executionClosure(s).ready,true);
 s.deductionReversals.push({settlementId:'tax'});assert.equal(rows(executionClosure(s),'balances')[0].amount,'100');assert.equal(rows(executionClosure(s),'balances')[0].id,'withholding');
 s.reversals.push({paymentId:'ret-pay'});assert.equal(rows(executionClosure(s),'balances').some(r=>r.id==='retention'),false);assert.equal(rows(executionClosure(s),'invoices')[0].title,'RET');
 s.reversals.push({paymentId:'pay'});assert.equal(rows(executionClosure(s),'invoices').find(r=>r.title==='INV').amount,'600');
 s.invoices.find(i=>i.id==='retention').status='cancelled';assert.equal(rows(executionClosure(s),'balances').find(r=>r.id==='retention').amount,'100');
 const large=state();large.invoices=[invoice({id:'a',net:0,withholding:Number.MAX_SAFE_INTEGER}),invoice({id:'b',net:0,withholding:2,lines:[]})];large.payments=[];assert.equal(rows(executionClosure(large),'balances')[0].amount,'9007199254740993');
});

test('all closure blockers remain visible for paid disputes, obligations, guarantees and paused execution',()=>{
 const s=state();s.invoices[0].status='disputed';s.obligations=[{id:'o',title:'تعهد',status:'open'}];s.issues=[{id:'i',title:'اختلاف',status:'open'}];s.guarantees=[{id:'g',reference:'GUARANTEE',amount:100,status:'held'}];s.status='paused';
 const result=executionClosure(s);assert.equal(result.blockedCount,5);assert.equal(result.ready,false);assert.equal(rows(result,'invoices')[0].amount,'0');
 for(const key of ['obligations','issues','guarantees','status'])assert.equal(rows(result,key).length,1);
 s.invoices[0].status='approved';s.obligations[0].status='completed';s.issues[0].status='resolved';s.guarantees[0].status='released';assert.equal(executionClosure(s).blockedCount,1);
 s.status='running';assert.equal(executionClosure(s).ready,true);s.status='closed';assert.equal(executionClosure(s).closed,true);assert.equal(executionClosure(s).ready,false);
});
