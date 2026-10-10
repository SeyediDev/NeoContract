import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';
import {backupDatabase,restoreDatabase} from '../lib/backup.mjs';
const signed={reference:'signed-file-2026-01',counterparties:'نمایندگان مجاز دو طرف؛ صورتجلسه آزمون',confirmSigned:true,signedDate:'2026-10-01',startDate:'2026-10-01',endDate:'2027-10-01',amount:10000,advanceLimit:2000,direction:'receivable'};
async function fixture(store){
 const data=await store.bootstrap(),template=data.templates.find(t=>t.currentPublishedVersion);
 let c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'اجرای آزمون '+randomUUID(),owner:'آزمون',amount:10000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'شرایط آزمون',services:[]});
 const draft=c;
 while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null});
 return {c,draft};
}
test('execution enforces signed basis, delivery, financial settlement and immutable audit',{timeout:240000},async t=>{
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db);let target;const root=await mkdtemp(join(tmpdir(),'neocontract-execution-'));
 try{
  const {c}=await fixture(store);let s=null;const make=(action,payload,key=randomUUID())=>({action,payload,expectedRevision:s?.revision||0,idempotencyKey:key});
  const cmd=async(action,payload)=>{s=await store.execution.command(c.id,make(action,payload));return s;};
  const fail=async(action,payload,status=400)=>{const before=await store.execution.read(c.id);await assert.rejects(store.execution.command(c.id,make(action,payload)),e=>e.status===status);assert.deepEqual(await store.execution.read(c.id),before);};
  await t.test('explicit signed reference, exact dates and active contract required',async()=>{
   const data=await store.bootstrap();const draft=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'پیش از امضا',owner:'آزمون',amount:1,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافق',services:[]});
   await assert.rejects(store.execution.command(draft.id,make('start',signed)),e=>e.status===409);
   await fail('start',{...signed,confirmSigned:false});await fail('start',{...signed,signedDate:'2026-02-30'});await fail('start',{...signed,signedDate:'invalid'});await fail('start',{...signed,amount:Number.MAX_SAFE_INTEGER+1});
   const input=make('start',signed);s=await store.execution.command(c.id,input);assert.equal(s.basis.amount,10000);assert.equal(s.status,'running');assert.deepEqual(await store.execution.command(c.id,input),s);
   await assert.rejects(store.execution.command(c.id,{...input,payload:{...signed,amount:10001}}),e=>e.status===409);
   await assert.rejects(store.execution.command(c.id,{...make('milestone',{}),expectedRevision:0}),e=>e.status===409);
  });
  await t.test('milestone budgets and positive quantities are enforced',async()=>{
   await cmd('milestone',{title:'تحویل محصول',gross:10000,dueDate:'2026-12-01',condition:'صورتجلسه پذیرش'});assert.equal(s.summary.milestoneProgress[0].status,'planned');await fail('milestone',{title:'اضافی',gross:1,dueDate:'2026-12-01',condition:'شرط'});
   await fail('item',{milestoneId:s.milestones[0].id,title:'قلم',unit:'بسته',quantity:0,unitPrice:1000,dueDate:'2026-11-01',owner:'مجری',criteria:'پذیرش'});
   await cmd('item',{milestoneId:s.milestones[0].id,title:'قلم <script>bad()</script>',unit:'بسته',quantity:10,unitPrice:1000,dueDate:'2026-11-01',owner:'مجری',criteria:'آزمون پذیرش و صورتجلسه'});
  });
  await t.test('partial delivery, rejection and acceptance never overdeliver or duplicate',async()=>{
   const i=s.items[0].id;await fail('delivery',{itemId:i,quantity:11,deliveredAt:'2026-10-10',reference:'DEL-1'});
   await cmd('delivery',{itemId:i,quantity:1,deliveredAt:'2026-10-10',reference:'DEL-REJECT'});await cmd('reject',{id:s.deliveries[0].id,reference:'REVIEW-REJECT',comment:'معیار رعایت نشده'});
   await cmd('delivery',{itemId:i,quantity:4,deliveredAt:'2026-10-10',reference:'DEL-1'});await cmd('accept',{id:s.deliveries[1].id,reference:'ACCEPT-1',comment:'پذیرش داخلی با مرجع صورتجلسه'});
   await fail('accept',{id:s.deliveries[1].id,reference:'AGAIN',comment:'تکرار'},409);assert.equal(s.summary.itemProgress[0].accepted,4);
  });
  const invoice=(kind,extra={})=>({kind,milestoneId:s.milestones[0].id,number:randomUUID(),gross:0,lines:[{itemId:s.items[0].id,quantity:4}],tax:400,retention:400,withholding:100,insurance:50,penalty:50,advanceRecovery:800,dueDate:'2026-12-01',reference:'INV-MASTER',basis:'مبنای کسورات آزمون؛ بدون فرض نرخ قانونی',...extra});
  await t.test('advance is capped, paid first, and cannot be recovered twice',async()=>{
   await fail('invoice',invoice('advance',{gross:2001,tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0}));
   await fail('invoice',invoice('progress'));
   await cmd('invoice',invoice('advance',{gross:2000,tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0}));const advance=s.invoices.at(-1).id;
   await fail('payment',{invoiceId:advance,amount:2000,paidAt:'2026-10-10',reference:'PAY-ADV',method:'حواله'},409);
   await cmd('invoice-approve',{id:advance,comment:'تأیید مالی',reference:'FIN-ADV'});await cmd('payment',{invoiceId:advance,amount:2000,paidAt:'2026-10-10',reference:'PAY-ADV',method:'حواله'});
   await cmd('invoice',invoice('progress'));assert.equal(s.invoices.at(-1).gross,4000);assert.equal(s.invoices.at(-1).net,3000);assert.equal(s.summary.advanceOutstanding,1200);
   await fail('payment-reverse',{id:s.payments[0].id,reference:'REV-ADV',comment:'برگشت'},400);
   await fail('invoice',invoice('progress',{lines:[{itemId:s.items[0].id,quantity:1}],tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0}));
  });
  await t.test('approval, partial payments, disputes and reversal use immutable records',async()=>{
   const id=s.invoices.at(-1).id;await cmd('invoice-approve',{id,comment:'تأیید مالی',reference:'FIN-1'});
   await cmd('payment',{invoiceId:id,amount:1000,paidAt:'2026-10-10',reference:'PAY-1',method:'حواله'});assert.equal(s.summary.outstanding,2000);
   await fail('payment',{invoiceId:id,amount:2001,paidAt:'2026-10-10',reference:'PAY-OVER',method:'حواله'});
   await cmd('invoice-dispute',{id,comment:'اختلاف بر سر رسید',reference:'DISP-1'});await fail('payment',{invoiceId:id,amount:1,paidAt:'2026-10-10',reference:'PAY-BLOCK',method:'حواله'},409);
   await cmd('invoice-resolve',{id,comment:'رفع اختلاف',reference:'RES-1'});await cmd('payment',{invoiceId:id,amount:2000,paidAt:'2026-10-10',reference:'PAY-2',method:'حواله'});
   const payment=s.payments.at(-1);await cmd('payment-reverse',{id:payment.id,reference:'REV-2',comment:'بازگشت وجه'});assert.equal(s.summary.outstanding,2000);await fail('payment-reverse',{id:payment.id,reference:'REV-3',comment:'تکرار'},409);
   await fail('payment',{invoiceId:id,amount:2000,paidAt:'2026-10-10',reference:'PAY-2',method:'حواله'},409);await cmd('payment',{invoiceId:id,amount:2000,paidAt:'2026-10-10',reference:'PAY-3',method:'حواله'});
   await fail('invoice-cancel',{id,comment:'ابطال',reference:'CANCEL-1'});
  });
  await t.test('unpaid draft cancellation frees allocation; final requires complete acceptance',async()=>{
   await fail('invoice',invoice('final',{lines:[{itemId:s.items[0].id,quantity:1}]}));
   await cmd('delivery',{itemId:s.items[0].id,quantity:6,deliveredAt:'2026-10-11',reference:'DEL-2'});await cmd('accept',{id:s.deliveries.at(-1).id,reference:'ACCEPT-2',comment:'تحویل کامل'});
   await cmd('invoice',invoice('progress',{lines:[{itemId:s.items[0].id,quantity:1}],tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0}));await cmd('invoice-cancel',{id:s.invoices.at(-1).id,reference:'CANCEL-DRAFT',comment:'اصلاح شماره'});
   await cmd('invoice',invoice('final',{lines:[{itemId:s.items[0].id,quantity:6}],tax:600,retention:600,withholding:0,insurance:0,penalty:0,advanceRecovery:1200}));const id=s.invoices.at(-1).id;await cmd('invoice-approve',{id,reference:'FIN-2',comment:'تأیید نهایی'});assert.equal(s.summary.advanceOutstanding,0);
   await fail('retention-release',{amount:1,dueDate:'2026-12-01',reference:'EARLY',comment:'زودهنگام'});await cmd('payment',{invoiceId:id,amount:4800,paidAt:'2026-10-11',reference:'PAY-FINAL',method:'حواله'});
  });
  await t.test('guarantees, obligations, issues, pause and changes are separately evidenced',async()=>{
   await cmd('guarantee',{kind:'advance',amount:2000,reference:'G-1',issuer:'بانک آزمون',beneficiary:'کارفرما',expiryDate:'2027-01-01',condition:'تسویه پیش‌پرداخت'});
   await fail('guarantee-extend',{id:s.guarantees[0].id,expiryDate:'2026-01-01',reference:'G-INVALID',comment:'تاریخ قدیمی'});await cmd('guarantee-extend',{id:s.guarantees[0].id,expiryDate:'2027-02-01',reference:'G-EXTEND',comment:'تمدید بانک'});assert.equal(s.guarantees[0].extensions.length,1);
   await cmd('obligation',{title:'مفاصاحساب بیمه و مالیات',owner:'مالی',dueDate:'2026-12-01',condition:'مدارک بیمه و کسورات'});
   await cmd('issue',{kind:'delay',title:'تأخیر تأمین',owner:'مجری',dueDate:'2026-12-01',impact:'توافق تمدید لازم است'});
   await cmd('pause',{reference:'STOP-1',comment:'توقف توافقی'});await fail('item',{title:'قلم جدید'},409);await cmd('resume',{reference:'RESUME-1',comment:'رفع توقف'});
   const basis=structuredClone(s.basis);await cmd('change',{reference:'SIGNED-CHANGE-1',comment:'توافق تمدید بدون تغییر قیمت',effectiveAmount:10000,endDate:'2027-11-01',itemId:s.items[0].id,quantity:10,dueDate:'2026-12-01'});assert.deepEqual(s.basis,basis);assert.equal(s.endDate,'2027-11-01');await fail('change',{reference:'INVALID-CHANGE',comment:'کاهش',effectiveAmount:9999,endDate:'2027-11-01'});
   await fail('close',{reference:'EARLY-CLOSE',comment:'بستن زودهنگام'});
   await cmd('obligation-complete',{id:s.obligations[0].id,reference:'CLEARANCE-1',comment:'مفاصاحساب و رسید کسورات دریافت شد'});await cmd('issue-resolve',{id:s.issues[0].id,reference:'RESOLVE-DELAY',comment:'با تمدید رفع شد'});await cmd('guarantee-release',{id:s.guarantees[0].id,reference:'G-RELEASE',comment:'مجوز بانک و کارفرما'});
  });
  await t.test('retention release is capped and still requires receipt before closure',async()=>{
   await fail('retention-release',{amount:1001,dueDate:'2026-12-01',reference:'RET-OVER',comment:'اضافی'});await cmd('retention-release',{amount:1000,dueDate:'2026-12-01',reference:'RET-1',comment:'مجوز آزادسازی پس از پذیرش'});assert.equal(s.summary.retentionHeld,0);assert.equal(s.summary.outstanding,1000);await fail('close',{reference:'EARLY-CLOSE-2',comment:'بستن'});
   await cmd('payment',{invoiceId:s.invoices.at(-1).id,amount:1000,paidAt:'2026-10-12',reference:'PAY-RET',method:'حواله'});await fail('close',{reference:'UNCLEARED',comment:'کسورات باز'});
   const progress=s.invoices.find(i=>i.kind==='progress'&&i.status==='approved');
   await fail('deduction-settle',{invoiceId:progress.id,kind:'withholding',amount:101,settledAt:'2026-10-12',reference:'TAX-OVER',recipient:'مرجع مالیاتی',comment:'اضافی'});
   await cmd('deduction-settle',{invoiceId:progress.id,kind:'withholding',amount:100,settledAt:'2026-10-12',reference:'TAX-1',recipient:'مرجع مالیاتی',comment:'رسید واقعی تسویه'});await cmd('deduction-reverse',{id:s.deductionSettlements[0].id,reference:'TAX-REV',comment:'اصلاح رسید'});assert.equal(s.summary.withholdingOutstanding,100);
   await cmd('deduction-settle',{invoiceId:progress.id,kind:'withholding',amount:100,settledAt:'2026-10-12',reference:'TAX-2',recipient:'مرجع مالیاتی',comment:'رسید اصلاح‌شده'});await cmd('deduction-settle',{invoiceId:progress.id,kind:'insurance',amount:50,settledAt:'2026-10-12',reference:'INS-1',recipient:'مرجع بیمه',comment:'مفاصاحساب'});
   await cmd('close',{reference:'FINAL-SETTLEMENT',comment:'تسویه نهایی و خاتمه'});assert.equal(s.status,'closed');assert.equal(s.summary.milestoneProgress[0].status,'settled');await fail('resume',{reference:'REOPEN',comment:'شروع'},409);
   const original=await store.contract(c.id);for(const key of ['snapshot','amount','document','stages','status'])assert.deepEqual(original[key],c[key],key);
  });
  await t.test('SQL protects basis and command history and backup restores the whole execution',async()=>{
   await assert.rejects(db.query('UPDATE contracts.execution_commands SET action=$1 WHERE tenant_id=$2 AND contract_id=$3',['forged',DEMO_TENANT_ID,c.id]),/immutable/i);
   await assert.rejects(db.query('DELETE FROM contracts.execution_commands WHERE tenant_id=$1 AND contract_id=$2',[DEMO_TENANT_ID,c.id]),/immutable/i);
   await assert.rejects(db.query("UPDATE contracts.contract_execution SET revision=revision+1,state=jsonb_set(state,'{basis,amount}','1') WHERE tenant_id=$1 AND contract_id=$2",[DEMO_TENANT_ID,c.id]),/immutable/i);
   const file=join(root,'execution.json');await backupDatabase(db,file);target=await createDatabase({dataDir:'memory://',seed:false});await restoreDatabase(target,file);assert.deepEqual(await createStore(target).execution.read(c.id),s);
  });
 }finally{if(target)await target.close();await db.close();await rm(root,{recursive:true,force:true});}
});

test('execution API isolates tenants and roles, concurrent receipts and audit rollback',{timeout:240000},async t=>{
 const previous=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID),api=await createApi({database:db,authMode:'oidc-proxy'});
 async function call(url,method='GET',input,subject='demo-admin'){
  let status,value;await api.handler({url,method,headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(input)yield Buffer.from(JSON.stringify(input));}},{writeHead(s){status=s;},end(b){value=JSON.parse(b);}});return {status,value};
 }
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);const {c}=await fixture(store),path=`/api/contracts/${c.id}/execution`;
  await t.test('readers can view; only administrators can record signed basis',async()=>{
   for(const subject of ['demo-viewer','demo-legal','demo-finance'])assert.equal((await call(path+'/commands','POST',{action:'start',payload:signed,expectedRevision:0,idempotencyKey:randomUUID()},subject)).status,403);
   const input={action:'start',payload:signed,expectedRevision:0,idempotencyKey:randomUUID()};const results=await Promise.all([call(path+'/commands','POST',input),call(path+'/commands','POST',input)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal((await store.execution.read(c.id)).history.length,1);
   const read=await call(path,'GET',undefined,'demo-viewer');assert.equal(read.status,200);assert.equal(read.value.basis.actor.subject,'demo-admin');assert.ok(!JSON.stringify(read.value).includes('request_hash'));
   assert.equal((await call(path+'/extra')).status,404);assert.equal((await call(path+'/commands','POST',{action:'milestone',payload:{title:'مرحله',gross:100,dueDate:'2026-12-01',condition:'شرط'},expectedRevision:1,idempotencyKey:randomUUID()},'demo-finance')).status,403);
   const foreign=(await fixture(createStore(db,DEMO_TENANT_ID))).c;assert.equal((await call(`/api/contracts/${foreign.id}/execution`)).status,404);
   const before=await store.execution.read(c.id);await db.query("UPDATE contracts.app_users SET status='disabled' WHERE tenant_id=$1 AND subject='demo-viewer'",[TITAN_TENANT_ID]);assert.equal((await call(path,'GET',undefined,'demo-viewer')).status,403);assert.deepEqual(await store.execution.read(c.id),before);
  });
  await t.test('failed audit atomically rolls back state, receipt and revision',async()=>{
   const before=await store.execution.read(c.id),transaction=db.transaction;db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,p)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('Injected audit failure');return tx.query(sql,p);}}));
   try{await assert.rejects(store.execution.command(c.id,{action:'milestone',payload:{title:'مرحله',gross:100,dueDate:'2026-12-01',condition:'شرط'},expectedRevision:1,idempotencyKey:randomUUID()}),/Injected audit failure/);}finally{db.transaction=transaction;}
   assert.deepEqual(await store.execution.read(c.id),before);
  });
 }finally{await api.close();if(previous===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=previous;}
});
