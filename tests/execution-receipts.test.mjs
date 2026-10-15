import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPaymentCapacity,executionRetentionCapacity,executionReceiptPreview} from '../public/execution-finance.js';
import {executionSummary} from '../lib/execution.mjs';
const state=()=>({status:'running',effectiveAmount:1000,items:[],deliveries:[],milestones:[],obligations:[],issues:[],guarantees:[],basis:{advanceLimit:0},invoices:[{id:'i',number:'INV',status:'approved',kind:'progress',gross:1000,net:900,tax:0,retention:100,withholding:0,insurance:0,advanceRecovery:0,lines:[]},{id:'r',number:'RET',status:'approved',kind:'retention',gross:0,net:30,retention:0,withholding:0,insurance:0,advanceRecovery:0,lines:[]}],payments:[{id:'p',invoiceId:'i',amount:400,reference:'FIRST'},{id:'q',invoiceId:'i',amount:500,reference:'REVERSED'}],reversals:[{paymentId:'q'}],deductionSettlements:[],deductionReversals:[]});
test('receipt preview uses effective receipts, preserves historical references and matches retention summary',()=>{
 const s=state(),before=structuredClone(s);
 assert.deepEqual(executionPaymentCapacity(s,'i'),{number:'INV',net:'900',paid:'400',reversed:'500',remaining:'500',approved:true});
 assert.equal(executionPaymentCapacity(s,'missing'),null);
 const preview=executionReceiptPreview(s,'payment',{amount:'300',reference:'NEW'},'i');assert.deepEqual(preview.errors,[]);assert.equal(preview.after,'200');
 for(const reference of [' FIRST ','REVERSED'])assert.ok(executionReceiptPreview(s,'payment',{amount:'1',reference},'i').errors.some(e=>e.field==='reference'));
 for(const amount of ['0','-1','0.1','1e2','9007199254740992','501',''])assert.ok(executionReceiptPreview(s,'payment',{amount},'i').errors.some(e=>e.field==='amount'),amount);
 assert.ok(executionReceiptPreview(s,'payment',{amount:'1'},'missing').errors.length);
 assert.equal(executionRetentionCapacity(s).remaining,String(executionSummary(s).retentionHeld));assert.equal(executionRetentionCapacity(s).blockers.length,1);assert.deepEqual(s,before);
 s.reversals=[];assert.equal(executionPaymentCapacity(s,'i').remaining,'0');assert.equal(executionRetentionCapacity(s).blockers.length,0);
 assert.deepEqual(executionReceiptPreview(s,'retention-release',{amount:'70'}).errors,[]);assert.equal(executionReceiptPreview(s,'retention-release',{amount:'70'}).after,'0');
 assert.ok(executionReceiptPreview(s,'retention-release',{amount:'71'}).errors.length);
 s.invoices[0].status='disputed';assert.equal(executionRetentionCapacity(s).blockers.length,1);assert.ok(executionReceiptPreview(s,'retention-release',{amount:'1'}).errors.length);assert.ok(executionReceiptPreview(s,'payment',{amount:'1'},'i').errors.length);
 s.invoices[0].status='approved';s.status='paused';assert.deepEqual(executionReceiptPreview(s,'retention-release',{amount:'1'}).errors,[]);s.status='closed';assert.ok(executionReceiptPreview(s,'retention-release',{amount:'1'}).errors.length);
});
test('retention capacity excludes voids, reserves release invoices and blocks submitted sources even with zero net',()=>{
 const s=state();s.reversals=[];
 s.invoices.push({...s.invoices[0],id:'void',status:'cancelled',retention:200},{...s.invoices[0],id:'rejected',status:'rejected',retention:200},{...s.invoices[0],id:'pending',status:'submitted',retention:10,net:0});
 let c=executionRetentionCapacity(s);assert.equal(c.held,'100');assert.equal(c.reserved,'30');assert.equal(c.remaining,'70');assert.deepEqual(c.blockers.map(row=>row.id),['pending']);assert.equal(c.remaining,String(executionSummary(s).retentionHeld));
 s.invoices.at(-1).status='rejected';s.invoices[1].status='cancelled';c=executionRetentionCapacity(s);assert.equal(c.reserved,'0');assert.equal(c.remaining,'100');assert.equal(c.blockers.length,0);
});
test('receipt and combined retention balances stay exact at safe integer boundaries',()=>{
 const s=state();s.invoices[0].net=Number.MAX_SAFE_INTEGER;s.payments=[{id:'p',invoiceId:'i',amount:1,reference:'ONE'}];s.reversals=[];
 assert.equal(executionReceiptPreview(s,'payment',{amount:'9007199254740989'},'i').after,'1');
 s.invoices[0].retention=Number.MAX_SAFE_INTEGER;s.invoices[1]={...s.invoices[0],id:'other',number:'OTHER'};
 const c=executionRetentionCapacity(s);assert.equal(c.held,'18014398509481982');assert.equal(c.remaining,c.held);assert.equal(c.blockers.length,2);
});
