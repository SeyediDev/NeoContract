import test from 'node:test';
import assert from 'node:assert/strict';
import {executionInvoiceCapacity,executionInvoicePreview,executionDeductionRemaining,executionQuantityText} from '../public/execution-finance.js';
const invoice=(fields={})=>({id:'old',number:'OLD',kind:'progress',status:'approved',milestoneId:'m',gross:500,tax:0,net:300,advanceRecovery:200,withholding:50,insurance:20,lines:[{itemId:'i',quantity:500,unitPrice:1000}],...fields});
const state=()=>({basis:{advanceLimit:2000},effectiveAmount:10000,milestones:[{id:'m',title:'اول',gross:6000},{id:'n',title:'دوم',gross:4000}],items:[{id:'i',milestoneId:'m',quantity:2000,unitPrice:2000},{id:'j',milestoneId:'n',quantity:1000,unitPrice:1000}],deliveries:[{itemId:'i',quantity:1500,status:'accepted'},{itemId:'i',quantity:500,status:'submitted'},{itemId:'j',quantity:1000,status:'rejected'}],invoices:[invoice(),invoice({id:'advance',number:'ADV',kind:'advance',milestoneId:null,gross:1000,advanceRecovery:0,lines:[]}),invoice({id:'cancelled',status:'cancelled',gross:1000,advanceRecovery:200,lines:[{itemId:'i',quantity:500}]}),invoice({id:'rejected',status:'rejected',gross:1000,lines:[{itemId:'i',quantity:500}]}),invoice({id:'retention',kind:'retention',milestoneId:null,gross:0,advanceRecovery:0,lines:[]})],payments:[{id:'p1',invoiceId:'advance',amount:600},{id:'p2',invoiceId:'advance',amount:400}],reversals:[{paymentId:'p2'}],deductionSettlements:[{id:'d1',invoiceId:'old',kind:'withholding',amount:20},{id:'d2',invoiceId:'old',kind:'insurance',amount:20}],deductionReversals:[{settlementId:'d2'}]});
const input=(fields={})=>({kind:'progress',milestoneId:'m',number:'NEW',lines:[{itemId:'i',quantity:'1'}],tax:'200',retention:'100',withholding:'50',insurance:'20',penalty:'30',advanceRecovery:'400',basis:'مبنای آزمون',...fields});
test('invoice capacity follows accepted units, live reservations, reversed receipts and historical gross',()=>{
 const s=state(),before=structuredClone(s),capacity=executionInvoiceCapacity(s);
 assert.equal(capacity.advanceAvailable,'1000');assert.equal(capacity.advanceRecoverable,'400');assert.equal(capacity.contractRemaining,'9500');assert.equal(capacity.stages[0].remaining,'5500');assert.equal(capacity.stages[0].lines[0].availableUnits,'1000');assert.equal(capacity.stages[1].lines[0].availableUnits,'0');assert.equal(capacity.finalReady,false);assert.deepEqual(s,before);
 s.invoices[0].status='disputed';assert.deepEqual(executionInvoiceCapacity(s),capacity);
 s.invoices[0].status='cancelled';const released=executionInvoiceCapacity(s);assert.equal(released.advanceRecoverable,'600');assert.equal(released.stages[0].lines[0].availableUnits,'1500');assert.equal(released.contractRemaining,'10000');
 assert.deepEqual(executionDeductionRemaining(state(),'old'),{withholding:'30',insurance:'20'});assert.equal(executionDeductionRemaining(state(),'missing'),null);
 assert.equal(executionQuantityText('1'),'0.001');assert.equal(executionQuantityText('1500'),'1.5');assert.equal(executionQuantityText('999999999999999'),'999999999999.999');
});
test('preview enforces line capacity, final acceptance, advance funding, deductions and documented basis',()=>{
 const s=state(),result=executionInvoicePreview(s,input());assert.deepEqual(result.errors,[]);assert.equal(result.gross,'2000');assert.equal(result.deductions,'600');assert.equal(result.net,'1600');assert.equal(result.basisRequired,true);
 const cases=[[{lines:[{itemId:'i',quantity:'1.001'}]},'line-i'],[{kind:'final'},'kind'],[{advanceRecovery:'401'},'advanceRecovery'],[{basis:''},'basis'],[{retention:'2001'},'retention'],[{number:' OLD '},'number'],[{milestoneId:'n'},'kind'],[{tax:'1.5'},'tax'],[{lines:[{itemId:'i',quantity:'0.0001'}]},'line-i'],[{lines:[{itemId:'i',quantity:'1'},{itemId:'i',quantity:'1'}]},'kind']];
 for(const [changes,field] of cases)assert.ok(executionInvoicePreview(s,input(changes)).errors.some(error=>error.field===field),JSON.stringify(changes));
 const zero={tax:'0',retention:'0',withholding:'0',insurance:'0',penalty:'0',advanceRecovery:'0',basis:''};
 assert.deepEqual(executionInvoicePreview(s,input({...zero,kind:'advance',gross:'1000'})).errors,[]);
 assert.ok(executionInvoicePreview(s,input({...zero,kind:'advance',gross:'1001'})).errors.some(error=>error.field==='gross'));
 assert.ok(executionInvoicePreview(s,input({...zero,kind:'advance',gross:'1000',tax:'1'})).errors.some(error=>error.field==='tax'));
 s.milestones[0].gross=1500;assert.ok(executionInvoicePreview(s,input()).errors.some(error=>error.field==='milestoneId'));
});
test('exact preview handles safe-boundary net, line rounding and free accepted work',()=>{
 const s=state();s.invoices=[];s.payments=[];s.reversals=[];s.items=[{id:'i',milestoneId:'m',quantity:1000,unitPrice:Number.MAX_SAFE_INTEGER}];s.deliveries=[{itemId:'i',quantity:1000,status:'accepted'}];s.effectiveAmount=Number.MAX_SAFE_INTEGER;s.milestones=[{id:'m',gross:Number.MAX_SAFE_INTEGER}];
 const values=input({kind:'final',tax:'2',retention:'2',withholding:'0',insurance:'0',penalty:'0',advanceRecovery:'0'}),result=executionInvoicePreview(s,values);
 assert.equal(result.net,'9007199254740991');assert.deepEqual(result.errors,[]);
 assert.notEqual(Number.MAX_SAFE_INTEGER+2-2,Number.MAX_SAFE_INTEGER);
 const overflow=executionInvoicePreview(s,{...values,retention:'0'});assert.equal(overflow.net,'9007199254740993');assert.ok(overflow.errors.some(error=>error.field==='tax'));
 s.items[0].unitPrice=500;assert.equal(executionInvoicePreview(s,{...values,lines:[{itemId:'i',quantity:'0.001'}]}).gross,'1');
 s.items[0].unitPrice=0;const free=executionInvoicePreview(s,{...values,tax:'0',retention:'0',basis:''});assert.equal(free.net,'0');assert.deepEqual(free.errors,[]);
});
