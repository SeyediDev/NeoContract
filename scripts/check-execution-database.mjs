// Operator-only acceptance against an explicitly named empty PostgreSQL scratch DB.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {renderExecutionDocument} from '../lib/execution-document.mjs';
import {executionSummary} from '../lib/execution.mjs';
const connectionString=process.env.NEOCONTRACT_EXECUTION_ACCEPTANCE_URL;
if(!connectionString)throw Error('NEOCONTRACT_EXECUTION_ACCEPTANCE_URL is required.');
const url=new URL(connectionString),name=decodeURIComponent(url.pathname.slice(1));
if(!/^neocontract_execution_acceptance_\d+$/.test(name))throw Error('Only a named execution acceptance database is permitted.');
const probe=new Client({connectionString});await probe.connect();
try{assert.equal(Number((await probe.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n),0,'Acceptance DB must be empty.');}finally{await probe.end();}
let db;
try{
 db=await createDatabase({connectionString});assert.equal(db.backend,'postgresql');assert.equal((await db.health()).migrations.length,7);const store=createStore(db),data=await store.bootstrap(),template=data.templates.find(t=>t.currentPublishedVersion);
 let c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'آزمون PostgreSQL جداگانه؛ قرارداد واقعی نیست',owner:'پذیرش',amount:2000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'آزمون',services:[]});while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(x=>x.status==='active')?.stepId||null});
 let s=null;const command=(action,payload)=>({action,payload,expectedRevision:s?.revision||0,idempotencyKey:randomUUID()}),cmd=async(action,payload)=>s=await store.execution.command(c.id,command(action,payload));
 const first=command('start',{reference:'SCRATCH-SIGNED',counterparties:'طرفین آزمایشی',confirmSigned:true,signedDate:'2026-10-01',startDate:'2026-10-01',endDate:'2027-10-01',amount:2000,advanceLimit:500,direction:'payable'});const start=await Promise.all([store.execution.command(c.id,first),store.execution.command(c.id,first)]);assert.deepEqual(start[0],start[1]);s=start[0];assert.equal(s.revision,1);
 await cmd('milestone',{title:'پذیرش',gross:2000,dueDate:'2026-12-01',condition:'صورتجلسه'});await cmd('item',{milestoneId:s.milestones[0].id,title:'قلم',quantity:2,unit:'بسته',unitPrice:1000,dueDate:'2026-12-01',owner:'مجری',criteria:'پذیرش'});await cmd('delivery',{itemId:s.items[0].id,quantity:2,deliveredAt:'2026-10-10',reference:'DEL'});await cmd('accept',{id:s.deliveries[0].id,reference:'ACCEPT',comment:'پذیرش'});
 await cmd('invoice',{kind:'final',number:'INV',milestoneId:s.milestones[0].id,lines:[{itemId:s.items[0].id,quantity:2}],tax:200,retention:200,withholding:100,insurance:100,penalty:0,advanceRecovery:0,dueDate:'2026-12-01',reference:'INV',basis:'مقادیر آزمون؛ بدون نرخ قانونی'});const invoice=s.invoices[0].id;assert.equal(s.invoices[0].net,1800);await cmd('invoice-approve',{id:invoice,reference:'FIN',comment:'تأیید'});await cmd('payment',{invoiceId:invoice,amount:1800,paidAt:'2026-10-10',reference:'PAY',method:'آزمون'});
 const followups=executionSummary(s,'2026-10-10').followups;assert.equal(followups.counts.finance,2);assert.equal(followups.rows.find(r=>r.kind==='invoice-deductions').amount,200);assert.equal(followups.rows.find(r=>r.kind==='retention').action,'retention-release');assert.ok(!followups.rows.some(r=>r.kind==='invoice-payment'));
 for(const kind of ['withholding','insurance'])await cmd('deduction-settle',{invoiceId:invoice,kind,amount:100,settledAt:'2026-10-10',reference:kind,recipient:'مرجع آزمون',comment:'تسویه'});
 await cmd('retention-release',{amount:200,dueDate:'2026-12-01',reference:'RET',comment:'مجوز'});await cmd('payment',{invoiceId:s.invoices.at(-1).id,amount:200,paidAt:'2026-10-10',reference:'RET-PAY',method:'آزمون'});
 const before=structuredClone(s),transaction=db.transaction;db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,p)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('acceptance rollback');return tx.query(sql,p);}}));
 try{await assert.rejects(cmd('issue',{kind:'risk',title:'rollback',owner:'آزمون',dueDate:'2026-12-01',impact:'آزمون'}),/acceptance rollback/);}finally{db.transaction=transaction;}assert.deepEqual(await store.execution.read(c.id),before);
 await cmd('close',{reference:'CLOSE',comment:'تسویه کامل آزمون'});assert.equal(s.status,'closed');const result=await store.contract(c.id);assert.deepEqual(result.snapshot,c.snapshot);assert.equal(result.amount,c.amount);assert.equal(result.execution.summary.followups.counts.total,0);
 const report=renderExecutionDocument(result);assert.match(report,/SCRATCH-SIGNED/);assert.match(report,/خاتمه و تسویه‌شده/);assert.match(report,/RET-PAY/);assert.match(report,/data:font\/woff2;base64/);assert.deepEqual(await store.execution.read(c.id),s);
 await assert.rejects(db.query('DELETE FROM contracts.execution_commands WHERE contract_id=$1',[c.id]),/immutable/i);
 console.log(JSON.stringify({postgresqlAcceptance:'PASS',migrations:7,status:s.status,revision:s.revision,originalPreserved:true,concurrentRetry:true,auditRollback:true,executionReport:true,executionFollowups:true}));
}finally{if(db)await db.close();}
