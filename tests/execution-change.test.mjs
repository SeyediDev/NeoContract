import test from 'node:test';
import assert from 'node:assert/strict';
import {executionChangePreview} from '../public/execution-change.js';
import {renderExecutionChangePreview,renderExecutionChangeHistory} from '../public/execution-change-ui.js';
const fixture=()=>({status:'running',basis:{startDate:'2026-10-01'},effectiveAmount:1000,endDate:'2027-10-01',milestones:[{id:'m',title:'مرحله',gross:1000}],items:[{id:'i',milestoneId:'m',title:'خدمت',unit:'بسته',quantity:2000,unitPrice:500,dueDate:'2026-12-01'}],deliveries:[{itemId:'i',quantity:1500,status:'accepted'},{itemId:'i',quantity:500,status:'submitted'},{itemId:'i',quantity:1000,status:'rejected'}],invoices:[{milestoneId:'m',status:'approved',gross:400,lines:[{itemId:'i',quantity:1000,unitPrice:400,amount:400}]},{milestoneId:'m',status:'cancelled',gross:800,lines:[{itemId:'i',quantity:1000}]},{milestoneId:'m',status:'rejected',gross:900,lines:[{itemId:'i',quantity:1000}]}]});
const input={effectiveAmount:'1200',endDate:'2027-11-01',milestoneId:'m',gross:'1100',itemId:'i',quantity:'2',unitPrice:'600',dueDate:'2026-12-15'};

test('change preview retains historical billing and prices only remaining units without mutating state',()=>{
 const s=fixture(),copy=structuredClone(s),r=executionChangePreview(s,input);assert.deepEqual(r.errors,[]);assert.equal(r.before.stages[0].committed,'900');assert.equal(r.after.stages[0].committed,'1000');assert.equal(r.after.stages[0].remaining,'100');assert.equal(r.after.unallocated,'100');assert.equal(r.item.billed,'1000');assert.equal(r.item.delivered,'2000');assert.equal(r.item.after.unbilled,'1000');assert.deepEqual(s,copy);
});
test('blank rate preserves the current rate and explicit zero is a real future rate',()=>{
 const unchanged=executionChangePreview(fixture(),{...input,unitPrice:''}),free=executionChangePreview(fixture(),{...input,unitPrice:'0'});assert.equal(unchanged.item.after.unitPrice,'500');assert.equal(unchanged.after.stages[0].committed,'900');assert.equal(free.item.after.unitPrice,'0');assert.equal(free.after.stages[0].committed,'400');assert.deepEqual(free.errors,[]);
});
test('pending deliveries and live billing prevent lowering committed quantity',()=>{
 const r=executionChangePreview(fixture(),{...input,quantity:'1.5'});assert.ok(r.errors.some(e=>e.field==='quantity'));assert.equal(r.after,null);
 const s=fixture();s.deliveries=[];assert.ok(executionChangePreview(s,{...input,quantity:'0.999'}).errors.some(e=>e.field==='quantity'));
});
test('a ceiling change to another stage cannot hide a deficit in the selected item stage',()=>{
 const s=fixture();s.effectiveAmount=2000;s.milestones.push({id:'other',title:'مرحله دیگر',gross:1000});
 const r=executionChangePreview(s,{...input,effectiveAmount:'3000',milestoneId:'other',gross:'1500',unitPrice:'1000'});assert.ok(r.errors.some(e=>e.field==='unitPrice'));assert.equal(r.stages.length,2);assert.equal(r.stages.find(m=>m.id==='m').after.remaining,'-400');
});
test('selected fields require valid dates, safe money and positive thousandth quantities',()=>{
 for(const [field,value] of [['effectiveAmount',''],['effectiveAmount','9007199254740992'],['gross','0'],['quantity','0'],['quantity','2.0001'],['quantity','2e0'],['unitPrice','-1'],['endDate','2026-02-30'],['endDate','2026-09-30'],['dueDate','']])assert.ok(executionChangePreview(fixture(),{...input,[field]:value}).errors.some(e=>e.field===field),field+':'+value);
 for(const status of ['paused','closed'])assert.ok(executionChangePreview({...fixture(),status},input).errors.some(e=>e.field==='reference'));
 assert.ok(executionChangePreview(fixture(),{...input,itemId:'unknown'}).errors.some(e=>e.field==='itemId'));assert.ok(executionChangePreview(fixture(),{...input,milestoneId:'unknown'}).errors.some(e=>e.field==='milestoneId'));
 const onlyContract=executionChangePreview(fixture(),{effectiveAmount:'1000',endDate:'2027-10-02',quantity:'bad',gross:'bad',unitPrice:'bad'});assert.deepEqual(onlyContract.errors,[]);
});
test('half-up rounding and excessive future line values match supported monetary boundaries',()=>{
 const s=fixture();s.deliveries=[];s.invoices=[];s.items[0].quantity=1;s.items[0].unitPrice=500;s.milestones[0].gross=2;s.effectiveAmount=2;
 const r=executionChangePreview(s,{...input,effectiveAmount:'2',gross:'2',quantity:'0.001',unitPrice:'1500'});assert.deepEqual(r.errors,[]);assert.equal(r.before.stages[0].committed,'1');assert.equal(r.after.stages[0].committed,'2');
 assert.ok(executionChangePreview(s,{...input,quantity:'999999999999',unitPrice:String(Number.MAX_SAFE_INTEGER)}).errors.some(e=>e.field==='unitPrice'));
});
test('preview and historical change rendering escape evidence and preserve unknown legacy rates',()=>{
 const s=fixture();s.items[0].title='<img src=x onerror=alert(1)>';const r=executionChangePreview(s,input),html=renderExecutionChangePreview(r);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('tabindex="0"'));assert.ok(html.includes('scope="col"'));
 const history=renderExecutionChangeHistory(s,{id:'x',reference:'<script>',reason:'شرح',before:{amount:1000,endDate:s.endDate},after:{amount:1200,endDate:input.endDate},milestoneChange:{milestoneId:'m',before:1000,after:1100},itemChange:{itemId:'i',before:{quantity:2000,dueDate:'2026-12-01'},after:{quantity:2000,unitPrice:0,dueDate:'2026-12-15'}}});assert.ok(history.includes('نرخ واحد پیش از تغییر: نامشخص'));assert.ok(history.includes('پس از تغییر: ۰ ریال'));assert.ok(history.includes('سقف پیش از تغییر'));assert.ok(!history.includes('<script>'));
});
