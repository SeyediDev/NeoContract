import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {executionGuaranteeAdvance,executionGuaranteePreview} from '../public/execution-guarantee.js';
import {renderExecutionGuaranteePreview,renderExecutionGuaranteeHistory} from '../public/execution-guarantee-ui.js';
const state=()=>({status:'running',guarantees:[{id:'g',kind:'advance',amount:300,reference:'GUARANTEE',issuer:'بانک',beneficiary:'طرف قرارداد',condition:'تسویه مستند',expiryDate:'2026-12-01',status:'held'}],invoices:[{id:'a',kind:'advance',status:'approved',advanceRecovery:0},{id:'p',kind:'progress',status:'submitted',advanceRecovery:100},{id:'c',kind:'progress',status:'cancelled',advanceRecovery:70},{id:'r',kind:'advance',status:'rejected',advanceRecovery:0}],payments:[{id:'one',invoiceId:'a',amount:200},{id:'reversed',invoiceId:'a',amount:50},{id:'ignored',invoiceId:'r',amount:20}],reversals:[{paymentId:'reversed'}]});
test('advance rule excludes reversed receipts and rejected or cancelled financial documents',()=>{
 assert.deepEqual(executionGuaranteeAdvance(state()),{paid:'200',recoveryReserved:'100',outstanding:'100'});
 const s=state();s.invoices[1].status='disputed';assert.equal(executionGuaranteeAdvance(s).recoveryReserved,'100');s.invoices[1].status='rejected';assert.equal(executionGuaranteeAdvance(s).outstanding,'200');
});
test('release blocks outstanding advances, allows zero reserved remainder and leaves other guarantee kinds independent',()=>{
 const s=state(),r=executionGuaranteePreview(s,'guarantee-release','g');assert.ok(r.errors.some(e=>e.field==='reference'));assert.equal(r.after,null);
 s.invoices[1].advanceRecovery=200;const frozen=structuredClone(s),ok=executionGuaranteePreview(s,'guarantee-release','g');assert.deepEqual(ok.errors,[]);assert.deepEqual(ok.after,{status:'released',expiryDate:'2026-12-01',amount:'300'});assert.deepEqual(s,frozen);ok.guarantee.reference='changed';assert.equal(s.guarantees[0].reference,'GUARANTEE');
 s.invoices[1].advanceRecovery=0;for(const kind of ['performance','insurance','other']){s.guarantees[0].kind=kind;assert.deepEqual(executionGuaranteePreview(s,'guarantee-release','g').errors,[]);}
});
test('extension requires a real later date and preserves amount, identity and historical extensions',()=>{
 const s=state();s.guarantees[0].extensions=[{from:'2026-11-01',to:'2026-12-01',reference:'OLD',comment:'مدرک'}];const frozen=structuredClone(s);
 for(const expiryDate of ['',undefined,'2026-02-30','2026-12-01','2026-11-30','2027-13-01']){const r=executionGuaranteePreview(s,'guarantee-extend','g',{expiryDate});assert.ok(r.errors.some(e=>e.field==='expiryDate'));assert.equal(r.after,null);}
 const r=executionGuaranteePreview(s,'guarantee-extend','g',{expiryDate:'2027-02-28'});assert.deepEqual(r.errors,[]);assert.deepEqual(r.after,{status:'held',expiryDate:'2027-02-28',amount:'300'});assert.deepEqual(s,frozen);
});
test('paused execution permits guarantee follow-up, while closed, released and missing records are blocked',()=>{
 const s=state();s.guarantees[0].kind='performance';s.status='paused';for(const action of ['guarantee-release','guarantee-extend'])assert.deepEqual(executionGuaranteePreview(s,action,'g',{expiryDate:'2027-01-01'}).errors,[]);
 s.status='closed';assert.ok(executionGuaranteePreview(s,'guarantee-release','g').errors.length);s.status='running';s.guarantees[0].status='released';assert.ok(executionGuaranteePreview(s,'guarantee-extend','g',{expiryDate:'2027-01-01'}).errors.length);
 assert.ok(executionGuaranteePreview(s,'guarantee-release','missing').errors.length);assert.ok(executionGuaranteePreview(s,'other','g').errors.length);
});
test('preview and extension history escape evidence and retain exact amounts',()=>{
 const s=state(),g=s.guarantees[0];g.kind='performance';g.amount=Number.MAX_SAFE_INTEGER;g.reference='<img src=x onerror=alert(1)>';g.extensions=[{from:'2026-11-01',to:'2026-12-01',reference:'<script>bad</script>',comment:'مجوز <b>قدیمی</b>'}];
 const html=renderExecutionGuaranteePreview(executionGuaranteePreview(s,'guarantee-release','g'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱'));assert.ok(html.includes('tabindex="0"'));assert.ok(renderExecutionGuaranteeHistory(g).includes('انقضای پیش از تمدید'));assert.equal(renderExecutionGuaranteeHistory({...g,extensions:undefined}),'');
});
test('preview matches actual blocked release, reserved recovery, extension and paused release in a temporary database',{timeout:180000},async()=>{
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db);
 try{
  const data=await store.bootstrap();let c=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'پذیرش تضمین',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'مدرک واقعی',services:[]});while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(x=>x.status==='active')?.stepId||null});
  let s=null;const cmd=async(action,payload)=>{const r=['guarantee-release','guarantee-extend'].includes(action)?executionGuaranteePreview(s,action,payload.id,payload):null;if(r)assert.deepEqual(r.errors,[]);s=await store.execution.command(c.id,{action,payload,expectedRevision:s?.revision||0,idempotencyKey:randomUUID()});if(r){const g=s.guarantees.find(g=>g.id===payload.id);assert.deepEqual({status:g.status,expiryDate:g.expiryDate,amount:String(g.amount)},r.after);}if(s)assert.equal(executionGuaranteeAdvance(s).outstanding,String(s.summary.advanceOutstanding));};
  await cmd('start',{reference:'SIGNED',counterparties:'طرفین',confirmSigned:true,signedDate:'2026-10-01',startDate:c.start,endDate:c.end,amount:1000,advanceLimit:200,direction:'receivable'});
  await cmd('guarantee',{kind:'advance',amount:200,reference:'G',issuer:'صادرکننده',beneficiary:'ذی‌نفع',expiryDate:'2026-12-01',condition:'تسویه'});const gid=s.guarantees[0].id;
  const invoice={kind:'advance',number:'ADV',gross:200,tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0,dueDate:'2026-12-01',reference:'INV'};await cmd('invoice',invoice);await cmd('invoice-approve',{id:s.invoices[0].id,reference:'APPROVED',comment:'تأیید'});await cmd('payment',{invoiceId:s.invoices[0].id,amount:200,paidAt:'2026-10-01',reference:'PAY',method:'حواله'});
  assert.ok(executionGuaranteePreview(s,'guarantee-release',gid).errors.length);const frozen=await store.execution.read(c.id);await assert.rejects(store.execution.command(c.id,{action:'guarantee-release',payload:{id:gid,reference:'BLOCKED',comment:'مجوز'},expectedRevision:s.revision,idempotencyKey:randomUUID()}),e=>e.status===400);assert.deepEqual(await store.execution.read(c.id),frozen);
  await cmd('guarantee-extend',{id:gid,expiryDate:'2027-01-01',reference:'EXT',comment:'مجوز تمدید'});assert.equal(s.guarantees[0].extensions[0].from,'2026-12-01');
  await cmd('milestone',{title:'مرحله',gross:1000,dueDate:'2026-12-01',condition:'پذیرش'});await cmd('item',{milestoneId:s.milestones[0].id,title:'خدمت',quantity:1,unitPrice:200,unit:'بسته',dueDate:'2026-12-01',owner:'مجری',criteria:'پذیرش'});await cmd('delivery',{itemId:s.items[0].id,quantity:1,deliveredAt:'2026-10-01',reference:'DEL'});await cmd('accept',{id:s.deliveries[0].id,reference:'ACCEPT',comment:'پذیرفته'});
  await cmd('invoice',{...invoice,kind:'progress',number:'RECOVERY',milestoneId:s.milestones[0].id,lines:[{itemId:s.items[0].id,quantity:1}],advanceRecovery:200,basis:'بند بازیافت پیش‌پرداخت در صورت‌وضعیت'});assert.equal(executionGuaranteePreview(s,'guarantee-release',gid).advance.outstanding,'0');
  const financial=structuredClone({invoices:s.invoices,payments:s.payments});await cmd('pause',{reference:'PAUSE',comment:'توقف'});await cmd('guarantee-release',{id:gid,reference:'RELEASE',comment:'مجوز مستند'});assert.deepEqual({invoices:s.invoices,payments:s.payments},financial);assert.equal(s.status,'paused');assert.equal(s.guarantees[0].amount,200);assert.equal(s.guarantees[0].extensions[0].reference,'EXT');
 }finally{await db.close();}
});
