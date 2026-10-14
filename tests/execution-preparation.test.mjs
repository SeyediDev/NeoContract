import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPreparation,executionItemValue} from '../public/execution-preparation.js';
test('preparation separates allocation and preserves historical work, live reservations and future rates',()=>{
 const state={effectiveAmount:10000,milestones:[{id:'m',title:'مرحله',gross:8000},{id:'n',title:'دیگر',gross:1000}],items:[{id:'i',milestoneId:'m',quantity:4000,unitPrice:2000}],invoices:[
  {milestoneId:'m',status:'approved',gross:1000,lines:[{itemId:'i',quantity:1000,unitPrice:1000}]},
  {milestoneId:'m',status:'disputed',gross:2000,lines:[{itemId:'i',quantity:1000,unitPrice:2000}]},
  {milestoneId:'m',status:'submitted',gross:1000,lines:[{itemId:'i',quantity:500,unitPrice:2000}]},
  {milestoneId:'m',status:'cancelled',gross:2000,lines:[{itemId:'i',quantity:1000}]},
  {milestoneId:'m',status:'rejected',gross:2000,lines:[{itemId:'i',quantity:1000}]},
  {milestoneId:null,status:'approved',kind:'advance',gross:1000,lines:[]},
  {milestoneId:null,status:'approved',kind:'retention',gross:0,net:100,lines:[]}
 ]};
 const before=structuredClone(state),p=executionPreparation(state);
 assert.equal(p.allocated,'9000');assert.equal(p.unallocated,'1000');assert.equal(p.emptyStages,1);
 assert.equal(p.stages[0].committed,'7000');assert.equal(p.stages[0].remaining,'1000');assert.equal(p.stages[1].remaining,'1000');assert.deepEqual(state,before);
 state.invoices[2].status='cancelled';assert.equal(executionPreparation(state).stages[0].remaining,'1000');
 assert.equal(executionPreparation(null),null);
});
test('item values use exact thousandths, per-line rounding and large integer arithmetic',()=>{
 assert.equal(executionItemValue('0.001','500'),'1');assert.equal(executionItemValue('0.001','499'),'0');
 assert.equal(executionItemValue('1.234','1000'),'1234');assert.equal(executionItemValue('2','0'),'0');
 assert.equal(executionItemValue('2','9007199254740991'),'18014398509481982');
 for(const [quantity,rate] of [['0','1'],['-1','1'],['1.0001','1'],['1e2','1'],['1','1.5'],['1','9007199254740992'],['','1'],['1','']])assert.equal(executionItemValue(quantity,rate),null);
 const p=executionPreparation({effectiveAmount:Number.MAX_SAFE_INTEGER,milestones:[{id:'m',title:'بزرگ',gross:Number.MAX_SAFE_INTEGER}],items:[{id:'i',milestoneId:'m',quantity:1000,unitPrice:Number.MAX_SAFE_INTEGER}],invoices:[]});
 assert.equal(p.stages[0].committed,'9007199254740991');assert.equal(p.stages[0].remaining,'0');assert.equal(p.unallocated,'0');
});
