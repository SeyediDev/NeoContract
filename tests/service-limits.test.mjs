import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,DEMO_TENANT_ID,TITAN_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {extractServiceLimits} from '../public/service-limit-extraction.js';
import {serviceLimitCurrent,validateServiceTerms,serviceLimitHash} from '../lib/service-limits.mjs';
import {dispatchServiceLimits} from '../lib/service-limit-dispatch.mjs';
import {serviceLimitProjection} from '../lib/service-limit-projection.mjs';
import {readFile} from 'node:fs/promises';
import {writeFile,mkdir} from 'node:fs/promises';
const quote='سقف TPS: ۵؛ burst: ۱۰؛ سهمیه ماهانه: ۱۰۰۰ درخواست';
const terms=(hash)=>({serviceKey:'organization-api',title:'سرویس سازمان',productKey:'organization-fabric',environment:'development',operationGroup:'organization',requestsPerSecond:5,burstCapacity:10,monthlyRequests:1000,validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-11-01T00:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',sourceKind:'contract',sourceHash:hash,clauseQuote:quote,confirmRequestMeter:true});
test('extraction preserves source evidence and detects price, ambiguity, Persian digits and zero quota',()=>{
 const s=extractServiceLimits(quote);assert.deepEqual(s.candidates.map(c=>c.value),[5,10,1000]);assert.ok(s.candidates.every(c=>c.status==='needs-review'&&c.quote===quote));assert.equal(s.automaticPublication,false);
 assert.equal(extractServiceLimits('قیمت هر TPS: ۱۰۰۰ ریال').candidates[0].status,'ambiguous');
 assert.ok(extractServiceLimits('TPS: 10\nTPS: 20').candidates.every(c=>c.status==='ambiguous'));
 assert.equal(extractServiceLimits('حداقل 20 TPS').candidates[0].status,'ambiguous');
 assert.equal(extractServiceLimits('TPS: 10 تا 20').candidates[0].status,'ambiguous');
 assert.equal(extractServiceLimits('TPS: ۰').candidates[0].status,'ambiguous');
 assert.equal(extractServiceLimits('سهمیه ماهانه: ۰').candidates[0].value,0);
 assert.equal(extractServiceLimits('TPS: ٢٫٥').candidates[0].value,2.5);
 assert.equal(extractServiceLimits('مبلغ ۱۰۰ ریال و مهلت ۵ روز').candidates.length,0);
});
test('no unlimited defaults and future changes preserve current terms until effective instant',()=>{
 const t=terms('a'.repeat(64));assert.throws(()=>validateServiceTerms({...t,burstCapacity:undefined}));assert.throws(()=>validateServiceTerms({...t,confirmRequestMeter:false}));assert.throws(()=>validateServiceTerms({...t,concurrency:2}));
 const a={id:'a',version:1,status:'signed',terms:t},b={id:'b',version:2,status:'signed',terms:{...t,requestsPerSecond:10,effectiveAt:'2026-10-15T00:00:00.000Z'}};
 assert.equal(serviceLimitCurrent({versions:[a,b]},{now:'2026-10-14T23:59:59.999Z'})[0].id,'a');assert.equal(serviceLimitCurrent({versions:[a,b]},{now:b.terms.effectiveAt})[0].id,'b');assert.equal(serviceLimitCurrent({versions:[a,b]},{now:b.terms.effectiveAt,executionStatus:'paused'}).length,0);assert.equal(serviceLimitCurrent({versions:[a,b]},{now:t.validTo}).length,0);
});
test('signed TPS amendments, transactional outbox, authorization, retry and observed gateway versions',{timeout:240000},async()=>{
 const connectionString=process.env.NEOCONTRACT_SERVICE_LIMIT_ACCEPTANCE_URL;
 if(connectionString)assert.match(decodeURIComponent(new URL(connectionString).pathname.slice(1)),/^neocontract_capacity_acceptance_\d+$/);
 const db=await createDatabase(connectionString?{connectionString}:{dataDir:'memory://'}),store=createStore(db,DEMO_TENANT_ID);let s;
 try{
  assert.equal((await db.health()).migrations.length,11);
  if(connectionString)assert.equal(db.backend,'postgresql');
  const data=await store.bootstrap();let c=await store.createContract({templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'TPS contract',owner:'آزمون',amount:10000,start:'2026-10-01',end:'2026-11-01',paymentTerms:'آزمون',services:[]});
  await db.query("INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,metadata) VALUES($1,$2,'proposal_revision','fixture.md','fixture','text/plain',$3)",[DEMO_TENANT_ID,c.id,JSON.stringify({body:quote})]);
  const x=await store.serviceLimits.extraction(c.id);assert.equal(x.source.sha256,serviceLimitHash(quote));
  const cmd=async(action,payload,key=randomUUID(),actor=null)=>{const input={action,payload,expectedRevision:s?.revision||0,idempotencyKey:key};s=await store.serviceLimits.command(c.id,input,actor);return input;};
  const initial=await cmd('draft',terms(x.source.sha256));assert.equal(s.versions[0].status,'draft');assert.equal(s.outbox.length,0);
  await assert.rejects(cmd('sign',{versionId:s.versions[0].id,confirmSigned:true,reference:'SIG',signedDate:'2026-10-01',counterparties:'طرفین'}),/مبنای امضاشده/);
  assert.equal((await store.serviceLimits.read(c.id)).revision,1);
  while(c.status!=='active')c=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:c.stages.find(x=>x.status==='active')?.stepId||null});
  await store.execution.command(c.id,{action:'start',payload:{reference:'SIGNED-TEST',counterparties:'طرفین آزمون',confirmSigned:true,signedDate:'2026-10-01',startDate:'2026-10-01',endDate:'2026-11-01',amount:10000,advanceLimit:0,direction:'receivable'},expectedRevision:0,idempotencyKey:randomUUID()});
  const input=await cmd('sign',{versionId:s.versions[0].id,confirmSigned:true,reference:'SIG-1',signedDate:'2026-10-01',counterparties:'طرفین'});assert.equal(s.outbox.length,1);assert.equal(s.gatewayApplied,false);const v1=s.versions[0];
  assert.deepEqual(await store.serviceLimits.command(c.id,input),s);await assert.rejects(store.serviceLimits.command(c.id,{...input,payload:{...input.payload,reference:'different'}}),/کلید/);
  await assert.rejects(cmd('draft',terms(x.source.sha256)),/الحاقیه/);
  await assert.rejects(cmd('draft',terms(x.source.sha256),randomUUID(),{tenantId:TITAN_TENANT_ID,roles:['contract_admin']}));
  await assert.rejects(cmd('draft',terms(x.source.sha256),randomUUID(),{tenantId:DEMO_TENANT_ID,roles:['viewer']}));
  await assert.rejects(createStore(db,TITAN_TENANT_ID).serviceLimits.read(c.id),/یافت نشد/);
  const amendedQuote='سقف TPS: ۱۲؛ burst: ۱۵؛ سهمیه ماهانه: ۲۰۰۰ درخواست';let ca=await store.amend(c.id,{title:'تغییر TPS',body:amendedQuote,reason:'افزایش ظرفیت',idempotencyKey:randomUUID()});let a=ca.amendments[0];
  const payload={...terms(serviceLimitHash(amendedQuote)),sourceKind:'amendment',amendmentId:a.id,clauseQuote:amendedQuote,requestsPerSecond:12,burstCapacity:15,monthlyRequests:2000,effectiveAt:'2026-10-15T00:00:00.000Z'};
  await assert.rejects(cmd('draft',payload),/تأیید/);
  for(const action of ['submit','approve']){ca=await store.reviewAmendment(c.id,a.id,{action,expectedStatus:a.status,expectedRevision:a.workflow.revision,idempotencyKey:randomUUID(),comment:'بازبینی'});a=ca.amendments[0];}
  await cmd('draft',payload);assert.equal(s.outbox.length,1);assert.deepEqual(s.versions[0],v1);
  await assert.rejects(cmd('sign',{versionId:s.versions[1].id,confirmSigned:true,reference:'FUTURE-SIG',signedDate:'2099-01-01',counterparties:'طرفین'}),/آینده/);
  const before=s,transaction=db.transaction;db.transaction=work=>transaction(tx=>work({...tx,query:async(sql,p)=>{if(sql.startsWith('INSERT INTO contracts.contract_events'))throw Error('audit rollback');return tx.query(sql,p);}}));
  try{await assert.rejects(cmd('sign',{versionId:s.versions[1].id,confirmSigned:true,reference:'SIG-2',signedDate:'2026-10-10',counterparties:'طرفین'}),/audit rollback/);}finally{db.transaction=transaction;}
  assert.deepEqual(await store.serviceLimits.read(c.id),before);await cmd('sign',{versionId:s.versions[1].id,confirmSigned:true,reference:'SIG-2',signedDate:'2026-10-10',counterparties:'طرفین'});assert.equal(s.outbox.length,2);assert.deepEqual(s.versions[0],v1);
  const event=(await db.query('SELECT payload FROM contracts.service_limit_outbox WHERE version_id=$1',[v1.id])).rows[0].payload;
  const projection=JSON.parse(await readFile(new URL('./fixtures/service-limit-projection.json',import.meta.url),'utf8'));
  const binding={localTenantId:DEMO_TENANT_ID,contractId:c.id,serviceKey:'organization-api',registryReference:'synthetic fixture only',projection,allocationRevisions:{[event.eventId]:41}};
  const projected=serviceLimitProjection(event,binding);assert.equal(projected.projection.limits.configRevision,41);assert.notEqual(41,event.aggregateVersion);assert.equal(projected.projection.limits.allocationId,projection.limits.allocationId);
  if(process.env.NEOCONTRACT_SERVICE_LIMIT_TEST_EVIDENCE){const out=process.env.NEOCONTRACT_SERVICE_LIMIT_TEST_EVIDENCE;await mkdir(out,{recursive:true});const events=(await db.query('SELECT payload FROM contracts.service_limit_outbox ORDER BY aggregate_version')).rows.map(r=>r.payload);await writeFile(out+'/signed-events.json',JSON.stringify({fixtureOnly:true,events},null,2),'utf8');}
  await assert.rejects(dispatchServiceLimits(db,{}),/تنظیم/);let calls=0;
  const options={endpoint:'http://localhost:9000/fixture',token:'synthetic-token',bindingForEvent:()=>binding,now:'2026-10-10T06:30:00.000Z',fetchImpl:async()=>{calls++;return new Response('{}');}};
  const invalid=await dispatchServiceLimits(db,options);assert.equal(calls,1);assert.equal(invalid.results[0].code,'invalid_ack');assert.equal((await store.serviceLimits.read(c.id)).gatewayApplied,false);
  options.fetchImpl=async(_url,request)=>{calls++;const e=JSON.parse(request.body);assert.equal(request.headers['Idempotency-Key'],event.eventId);const p=e.projection;return Response.json({eventId:e.eventId,aggregateVersion:e.aggregateVersion,phase:'acknowledged',gateway:{contractVersion:p.contractVersion,allocationId:p.limits.allocationId,canonicalScope:p.limits.canonicalScope,configRevision:p.limits.configRevision,limitsSha256:serviceLimitHash(p.limits),observedAt:options.now}});};
  assert.equal((await dispatchServiceLimits(db,options)).results[0].status,'acknowledged');assert.equal((await dispatchServiceLimits(db,options)).processed,0);assert.equal(calls,2,'future amendment was not sent early');
  const broken=structuredClone(binding);delete broken.allocationRevisions;assert.throws(()=>serviceLimitProjection(event,broken),/مستقل/);broken.allocationRevisions={[event.eventId]:41};broken.localTenantId=TITAN_TENANT_ID;assert.throws(()=>serviceLimitProjection(event,broken),/تننت/);
  await assert.rejects(db.query("UPDATE contracts.contract_service_limits SET revision=revision+1,state=jsonb_set(state,'{versions,0,terms,requestsPerSecond}','999') WHERE contract_id=$1",[c.id]),/immutable/i);
  await assert.rejects(db.query('DELETE FROM contracts.service_limit_outbox WHERE tenant_id=$1',[DEMO_TENANT_ID]),/immutable/i);
  assert.deepEqual((await store.contract(c.id)).snapshot,c.snapshot);assert.equal((await store.contract(c.id)).amendments[0].status,'approved','term signature does not invent the legal lifecycle of the whole amendment');
 }finally{await db.close();}
});
