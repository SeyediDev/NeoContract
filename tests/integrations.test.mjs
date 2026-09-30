import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../lib/database.mjs';
import { createStore } from '../lib/store.mjs';
import { createIntegrations } from '../lib/integrations.mjs';

const config={apiBaseUrl:'http://127.0.0.1:9999',webBaseUrl:'http://127.0.0.1:9998',organizationId:'org-test',workspaceId:'workspace-test',projectId:'project-test'};
const clone=value=>structuredClone(value);
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const prefixFor=id=>`NC-${id.replaceAll('-','').slice(0,16).toUpperCase()}`;

function neoMock({unrelated=0}={}){
  const items=[],details=new Map(),requests=[],faults={uncertainCreateKey:null,rejectCreateKey:null,uncertainDependencyId:null,uncertainLogId:null};
  function add(value){
    const item={id:randomUUID(),projectId:config.projectId,key:'UNRELATED',domain:'unrelated',description:'Unrelated record',title:'Unrelated',parentWorkItemId:null,status:'Backlog',version:1,ownerAgentId:null,ownerChatId:null,...value};
    items.push(item);details.set(item.id,{item,dependencies:[],logs:[]});return item;
  }
  for(let i=0;i<unrelated;i++)add({key:`OTHER-${i}`});
  async function fetchImpl(url,options={}){
    const u=new URL(url),method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
    assert.equal(u.origin,new URL(config.apiBaseUrl).origin,'test must not perform external I/O');
    const path=u.pathname.split(`/workspaces/${config.workspaceId}`)[1];assert.ok(path,'workspace path required');
    requests.push({path,method,body,query:u.search});
    if(path==='/catalog')return reply({projects:[{id:config.projectId,name:'Test contracts'}]});
    if(path==='/items'&&method==='GET'){
      assert.equal(u.searchParams.get('projectId'),config.projectId);
      const skip=Number(u.searchParams.get('skip')),take=Number(u.searchParams.get('take'));
      return reply({items:clone(items.slice(skip,skip+take)),total:items.length});
    }
    if(path==='/items'&&method==='POST'){
      if(faults.rejectCreateKey===body.key){faults.rejectCreateKey=null;return reply({error:'temporary failure'},503);}
      if(items.some(i=>i.key===body.key))return reply({error:'duplicate key'},409);
      const item=add({...body,ownerAgentId:'local-web',ownerChatId:process.env.CODEX_THREAD_ID||'neocontract-demo'});
      if(faults.uncertainCreateKey===body.key){faults.uncertainCreateKey=null;throw new Error('connection lost after accepted create');}
      return reply({item});
    }
    const match=path.match(/^\/items\/([^/]+)(?:\/(dependencies|logs))?$/);assert.ok(match,`Unexpected Neo request ${path}`);
    const [,id,action]=match;const detail=details.get(id);if(!detail)return reply({error:'not found'},404);
    if(method==='GET')return reply(detail);
    assert.equal(body.expectedVersion,detail.item.version,'optimistic version required');
    if(action==='dependencies'){
      assert.ok(details.has(body.dependsOnWorkItemId));
      assert.ok(!detail.dependencies.includes(body.dependsOnWorkItemId),'duplicate dependency must not be posted');
      detail.dependencies.push(body.dependsOnWorkItemId);detail.item.version++;
      if(faults.uncertainDependencyId===id){faults.uncertainDependencyId=null;throw new Error('connection lost after accepted dependency');}
    }else if(action==='logs'){
      assert.ok(!detail.logs.some(l=>l.message===body.message),'duplicate log must not be posted');
      detail.logs.push({id:randomUUID(),message:body.message});detail.item.version++;
      if(faults.uncertainLogId===id){faults.uncertainLogId=null;throw new Error('connection lost after accepted log');}
    }else assert.fail(`Unsupported mutation ${path}`);
    return reply(detail);
  }
  return {items,details,requests,faults,add,fetchImpl};
}

test('Neo synchronization and Fanasa import are idempotent, isolated and recorded in PostgreSQL',{timeout:120000},async t=>{
  const db=await createDatabase({dataDir:'memory://'});const store=createStore(db);
  const report=JSON.parse(await readFile(new URL('../planning/fanasa-catalog-current.json',import.meta.url),'utf8'));
  const templates=await store.templates(),customers=await store.customers();
  const template=templates.find(x=>x.code==='purchase')||templates.find(x=>x.status==='published');
  const input={templateId:template.id,customerId:customers[0].id,title:'قرارداد آزمون اتصال',amount:120000,start:'2026-10-01',end:'2027-09-30',owner:'آزمون',paymentTerms:'ماهانه',services:[]};
  const makeContract=extra=>store.createContract({...input,...extra});
  const jobs=id=>store.q('SELECT * FROM contracts.integration_jobs WHERE tenant_id=$1 AND contract_id=$2 ORDER BY created_at,id',[store.tenantId,id]);
  try{
    await t.test('creates one parent, enabled stages, ordered dependencies and unique logs; concurrent repeat uses pagination',async()=>{
      const c=await makeContract(),mock=neoMock({unrelated:205}),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const unrelatedBefore=clone(mock.items);const result=await integration.syncContract(c.id);
      assert.equal(result.stages.length,c.stages.filter(s=>s.enabled).length);
      assert.equal(mock.items.length,205+1+result.stages.length);
      assert.ok(mock.requests.some(r=>r.query.includes('skip=200')),'must visit the second page');
      for(const [index,stage] of result.stages.entries()){
        const d=mock.details.get(stage.itemId);assert.equal(d.item.parentWorkItemId,result.parentItemId);
        assert.deepEqual(d.dependencies,index?[result.stages[index-1].itemId]:[]);assert.equal(d.logs.length,1);
      }
      await Promise.all([integration.syncContract(c.id),integration.syncContract(c.id)]);
      assert.equal(mock.items.length,205+1+result.stages.length);
      assert.deepEqual(mock.items.slice(0,205),unrelatedBefore);
      for(const stage of result.stages)assert.equal(mock.details.get(stage.itemId).logs.length,1);
      const stored=await store.contract(c.id);assert.equal(stored.neoBinding.parentItemId,result.parentItemId);
      assert.equal((await jobs(c.id)).filter(j=>j.status==='succeeded').length,3);
      const restarted=createIntegrations(createStore(db),{neoConfig:config,fetchImpl:mock.fetchImpl});
      await restarted.syncContract(c.id);assert.equal(mock.items.length,205+1+result.stages.length,'new integration instance recovers from database and remote state');
    });

    await t.test('uncertain accepted create is discovered before retry and does not duplicate',async()=>{
      const c=await makeContract(),mock=neoMock();mock.faults.uncertainCreateKey=prefixFor(c.id)+'-S1';
      const integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const result=await integration.syncContract(c.id);await integration.syncContract(c.id);
      assert.equal(mock.items.length,result.stages.length+1);
      assert.equal(mock.requests.filter(r=>r.method==='POST'&&r.path==='/items'&&r.body.key===prefixFor(c.id)+'-S1').length,1);
      assert.ok((await jobs(c.id)).every(j=>j.status==='succeeded'));
    });

    await t.test('a failed stage create persists failure and a later retry resumes existing items',async()=>{
      const c=await makeContract(),mock=neoMock();mock.faults.rejectCreateKey=prefixFor(c.id)+'-S2';
      let integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      await assert.rejects(integration.syncContract(c.id));
      const failed=(await jobs(c.id)).find(j=>j.status==='failed');assert.ok(failed.error_message);assert.ok(failed.next_attempt_at);
      const before=clone(mock.items);integration=createIntegrations(createStore(db),{neoConfig:config,fetchImpl:mock.fetchImpl});
      const resumed=await integration.syncContract(c.id);
      assert.equal(mock.items.length,1+resumed.stages.length);
      for(const item of before)assert.equal(mock.items.filter(i=>i.key===item.key).length,1);
      assert.deepEqual((await jobs(c.id)).map(j=>j.status).sort(),['failed','succeeded']);
    });

    await t.test('uncertain dependency and log writes reconcile remote state on the next attempt',async()=>{
      const c=await makeContract(),mock=neoMock(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const first=await integration.syncContract(c.id);assert.ok(first.stages.length>=2);
      const second=mock.details.get(first.stages[1].itemId);second.dependencies=[];mock.faults.uncertainDependencyId=second.item.id;
      await integration.syncContract(c.id).catch(()=>{});await integration.syncContract(c.id);
      assert.deepEqual(second.dependencies,[first.stages[0].itemId]);
      const beforeAdvance=await store.contract(c.id);
      await store.advance(c.id,{expectedStatus:beforeAdvance.status,expectedStepId:beforeAdvance.stages.find(s=>s.status==='active')?.stepId??null});mock.faults.uncertainLogId=first.stages[0].itemId;
      await integration.syncContract(c.id).catch(()=>{});await integration.syncContract(c.id);
      const logs=mock.details.get(first.stages[0].itemId).logs;assert.equal(new Set(logs.map(l=>l.message)).size,logs.length);
      assert.equal(logs.length,2,'one pending state and one active state');
    });

    await t.test('missing predecessor on a progressed or closed Neo item fails without changing its state',async()=>{
      for(const status of ['InProgress','Done']){
        const c=await makeContract(),mock=neoMock(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
        const synced=await integration.syncContract(c.id),second=mock.details.get(synced.stages[1].itemId);
        second.item.status=status;second.dependencies=[];
        const before=clone(second),offset=mock.requests.length;
        await assert.rejects(integration.syncContract(c.id),error=>error.code==='neo_workflow_deviation'&&error.status===409);
        assert.deepEqual(second,before,'sync must not drive status, claim ownership, or mutate a progressed item');
        assert.equal(mock.requests.slice(offset).filter(r=>r.method==='POST').length,0);
        assert.equal((await jobs(c.id)).filter(j=>j.status==='failed').length,1);
      }
    });

    await t.test('unexpected dependencies on first or subsequent stages are reported and preserved',async()=>{
      for(const stageIndex of [0,1]){
        const c=await makeContract(),mock=neoMock(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
        const synced=await integration.syncContract(c.id),stage=mock.details.get(synced.stages[stageIndex].itemId);
        const extra=mock.add({key:'EXTERNAL-DEPENDENCY'});stage.dependencies.push(extra.id);
        const before=clone(stage),offset=mock.requests.length;
        await assert.rejects(integration.syncContract(c.id),error=>error.code==='neo_workflow_deviation'&&error.status===409);
        assert.deepEqual(stage,before,'unexpected dependencies belong to Neo and must not be removed');
        assert.equal(mock.requests.slice(offset).filter(r=>r.method==='POST').length,0);
        assert.equal((await jobs(c.id)).filter(j=>j.status==='failed').length,1);
      }
    });

    await t.test('binding traces frozen template and process identities separately from Neo work status',async()=>{
      let custom=await store.saveTemplate({...template,title:'الگوی مسیر مستقل آزمون اتصال',stages:[
        {id:'disabled-review',name:'بازبینی غیرفعال',role:'observer',slaDays:1,required:false,enabled:false},
        template.stages[0],{id:'optional-review',name:'بازبینی تکمیلی',role:'reviewer',slaDays:1,required:false,enabled:true},...template.stages.slice(1)
      ]});
      custom=await store.templateAction(custom.id,'publish',{templateVersionId:custom.templateVersionId,revision:custom.revision});
      const c=await makeContract({templateId:custom.id,templateVersionId:custom.templateVersionId});
      const mock=neoMock(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const first=await integration.syncContract(c.id);
      assert.equal(first.templateId,c.templateId);assert.equal(first.templateVersionId,c.templateVersionId);assert.equal(first.templateVersion,c.snapshot.template.version);assert.equal(first.workflowStatus,'draft');
      const expected=c.stages.map((s,index)=>({...s,sourceSequence:index+1})).filter(s=>s.enabled);
      for(const [index,stage] of first.stages.entries()){
        const source=expected[index];
        assert.deepEqual({stageId:stage.stageId,stepId:stage.stepId,role:stage.role,required:stage.required,sourceSequence:stage.sourceSequence,executionSequence:stage.executionSequence,workflowStatus:stage.workflowStatus},{stageId:source.id,stepId:source.stepId,role:source.role,required:source.required,sourceSequence:source.sourceSequence,executionSequence:index+1,workflowStatus:source.status});
        assert.equal(stage.status,'Backlog');assert.equal(stage.key,prefixFor(c.id)+'-S'+(index+1));
      }
      assert.equal(first.stages[0].sourceSequence,2);assert.equal(first.stages[1].required,false);
      const advanced=await store.advance(c.id,{expectedStatus:c.status,expectedStepId:null});
      let revised=await store.saveTemplate({...custom,title:'نسخه جدید مسیر آزمون',stages:custom.stages.map(s=>({...s,name:'نسخه جدید '+s.name,role:'new-'+s.role})).reverse()},custom.id);
      revised=await store.templateAction(revised.id,'publish',{templateVersionId:revised.templateVersionId,revision:revised.revision});
      assert.notEqual(revised.templateVersionId,c.templateVersionId);
      const second=await integration.syncContract(c.id);
      assert.equal(second.templateVersionId,c.templateVersionId);assert.equal(second.templateVersion,c.snapshot.template.version);assert.equal(second.templateId,c.templateId);
      assert.equal(second.workflowStatus,advanced.status);assert.equal(second.stages[0].workflowStatus,'active');assert.equal(second.stages[0].status,'Backlog');
      assert.deepEqual(second.stages.map(({workflowStatus,...trace})=>trace),first.stages.map(({workflowStatus,...trace})=>trace),'later template edits cannot change frozen routing metadata, keys, or work items');
      assert.deepEqual((await store.contract(c.id)).snapshot,c.snapshot);
      assert.deepEqual((await store.contract(c.id)).neoBinding,second);
    });

    await t.test('another agent/chat ownership never receives dependency or log mutations',async()=>{
      const c=await makeContract(),mock=neoMock(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const synced=await integration.syncContract(c.id),foreign=mock.details.get(synced.stages[1].itemId);
      foreign.item.ownerAgentId='other-agent';foreign.item.ownerChatId='other-chat';foreign.dependencies=[];foreign.logs=[];
      const before=clone(foreign),offset=mock.requests.length;await integration.syncContract(c.id).catch(()=>{});
      const writes=mock.requests.slice(offset).filter(r=>r.method==='POST'&&r.path.startsWith(`/items/${foreign.item.id}/`));
      assert.equal(writes.length,0,'foreign ownership must guard dependencies as well as logs');assert.deepEqual(foreign,before);
    });

    await t.test('a colliding key belonging to another domain is not adopted as the contract parent',async()=>{
      const c=await makeContract(),mock=neoMock();const foreign=mock.add({key:prefixFor(c.id),domain:'another-application',ownerAgentId:'someone-else',ownerChatId:'another-chat'});
      const integration=createIntegrations(store,{neoConfig:config,fetchImpl:mock.fetchImpl});
      const result=await integration.syncContract(c.id).catch(()=>null);
      assert.ok(!result||result.parentItemId!==foreign.id,'matching key alone must not authorize adoption');
      assert.equal(mock.items.filter(i=>i.parentWorkItemId===foreign.id).length,0,'must not attach contract children to an unrelated parent');
    });

    await t.test('pending import does not change active catalog; approval updates official mappings once',async()=>{
      const before=await store.catalog(),integration=createIntegrations(store,{neoConfig:config,fetchImpl:neoMock().fetchImpl,fetchCatalog:async()=>clone(report)});
      assert.deepEqual(before.operatorReview,{status:'unreviewed',importId:null,reviewedAt:null});
      const pending=await integration.runImport();assert.equal(pending.status,'pending');assert.equal(pending.sources.length,90);assert.equal(pending.counts.services,87);
      assert.deepEqual(await store.catalog(),before);
      const approved=await integration.approveImport(pending.id);assert.equal(approved.status,'approved');
      const current=await store.catalog();assert.equal(current.services.length,87);assert.equal(current.verificationStatus,'http-observed-unverified');
      const reviewRow=await store.one('SELECT reviewed_at FROM contracts.catalog_imports WHERE tenant_id=$1 AND id=$2',[store.tenantId,pending.id]);
      const reviewedAt=reviewRow.reviewed_at instanceof Date?reviewRow.reviewed_at.toISOString():reviewRow.reviewed_at;
      assert.deepEqual(current.operatorReview,{status:'approved',importId:pending.id,reviewedAt});
      assert.deepEqual(current.services,report.catalog.services,'operator review must not rewrite source observations or service provenance');
      assert.deepEqual((await integration.status()).sync.operatorReview,current.operatorReview);
      assert.deepEqual((await createStore(db).catalog()).operatorReview,current.operatorReview,'review is derived from persisted active import after creating a new store');

      assert.equal(current.services.find(s=>s.code==='ABR-07').tier,'T3');assert.equal(current.services.find(s=>s.code==='ABR-07').delivery,'on_request');
      const mapped=await store.q('SELECT s.service_code,s.delivery,t.code FROM contracts.catalog_service_sla m JOIN contracts.catalog_services s ON s.tenant_id=m.tenant_id AND s.id=m.service_id JOIN contracts.sla_tiers t ON t.tenant_id=m.tenant_id AND t.id=m.sla_tier_id WHERE m.tenant_id=$1 AND m.is_default',[store.tenantId]);
      assert.equal(mapped.length,87);assert.equal(mapped.find(x=>x.service_code==='ABR-07').code,'T3');
      assert.deepEqual(current.services.find(s=>s.code==='DZN-02').price,report.catalog.services.find(s=>s.code==='DZN-02').price);
      await integration.approveImport(pending.id);assert.equal((await store.q('SELECT * FROM contracts.catalog_service_sla WHERE tenant_id=$1 AND is_default',[store.tenantId])).length,87);
      const restarted=createIntegrations(createStore(db),{neoConfig:config,fetchImpl:neoMock().fetchImpl});assert.ok((await restarted.imports()).some(i=>i.id===pending.id&&i.status==='approved'));
      const laterPending=await integration.runImport();assert.equal(laterPending.status,'pending');assert.notEqual(laterPending.id,pending.id);
      assert.deepEqual(await store.catalog(),current,'a newer pending import does not change active reviewed state');

    });

    await t.test('catalog review rejects missing, forged and cross-tenant import references',async()=>{
      const saved=await store.getSetting('catalog-current');const approved=(await store.catalog()).operatorReview;
      const foreignTenant=randomUUID(),foreignImport=randomUUID();
      await db.query('INSERT INTO contracts.tenants(id,slug,name) VALUES($1,$2,$3)',[foreignTenant,'review-'+foreignTenant,'Foreign review tenant']);
      await db.query("INSERT INTO contracts.catalog_imports(id,tenant_id,source_url,status,reviewed_at) VALUES($1,$2,$3,'approved',now())",[foreignImport,foreignTenant,'https://fanasa.net/fa/products']);
      const invalidReferences=[undefined,null,randomUUID(),'not-a-uuid',foreignImport];
      for(const status of ['pending','approved','rejected','failed']){
        const id=randomUUID();await db.query('INSERT INTO contracts.catalog_imports(id,tenant_id,source_url,status,reviewed_at) VALUES($1,$2,$3,$4,$5)',[id,store.tenantId,'https://fanasa.net/fa/products',status,status==='approved'?null:new Date().toISOString()]);invalidReferences.push(id);
      }
      try {
        for(const importId of invalidReferences){
          await store.setSetting('catalog-current',{...saved,importId,reviewedAt:'2099-01-01T00:00:00.000Z',operatorReview:{status:'approved',importId:foreignImport,reviewedAt:'2099-01-01T00:00:00.000Z'}});
          const actual=await store.catalog();assert.deepEqual(actual.operatorReview,{status:'unreviewed',importId:null,reviewedAt:null},`invalid active reference ${String(importId)}`);assert.equal(actual.verificationStatus,'http-observed-unverified');
        }
        await store.setSetting('catalog-current',{...saved,reviewedAt:'2099-01-01T00:00:00.000Z',operatorReview:{status:'unreviewed',importId:null,reviewedAt:null}});
        assert.deepEqual((await store.catalog()).operatorReview,approved,'approval and timestamp come from the matching import row, not cached catalog fields');
      } finally {await store.setSetting('catalog-current',saved);}
    });

    await t.test('failed or incomplete import preserves last active catalog and failure history',async()=>{
      const before=await store.catalog();
      for(const provider of [async()=>{throw new Error('upstream timeout');},async()=>({...clone(report),catalog:{...clone(report.catalog),services:report.catalog.services.slice(1)}})]){
        const integration=createIntegrations(store,{fetchCatalog:provider});await assert.rejects(integration.runImport());
        assert.deepEqual(await store.catalog(),before);assert.equal((await integration.imports())[0].status,'failed');
      }
      const malformed=clone(report);malformed.catalog.services[0].name='Must be rolled back';malformed.catalog.services[1].code='ZZZ-01';
      const integration=createIntegrations(store,{fetchCatalog:async()=>malformed});const pending=await integration.runImport();
      await assert.rejects(integration.approveImport(pending.id));assert.deepEqual(await store.catalog(),before);
      const local=await store.one('SELECT name FROM contracts.catalog_services WHERE tenant_id=$1 AND service_code=$2',[store.tenantId,report.catalog.services[0].code]);
      assert.notEqual(local.name,'Must be rolled back','approval is atomic across mappings and catalog');
    });

    await t.test('contract freezes complete source tariff and provenance independently from later imports',async()=>{
      const source=(await store.catalog()).services.find(s=>s.code==='DZN-02');
      const c=await makeContract({title:'آزمون حفظ حداقل و کارمزد',services:[{code:source.code,slaTier:'T1',quantity:1,unitPrice:100,revenueModel:'overhead',delivery:source.delivery}]});
      const originalSnapshot=clone(c.snapshot);
      const frozen=c.services[0],price=frozen.sourceSnapshot?.price??frozen.sourcePrice??frozen.price;
      assert.deepEqual(price,source.price,'percent basis/minimum/rows/explanations must survive the contract snapshot');
      const provenance=frozen.sourceSnapshot??frozen;
      assert.equal(provenance.sourceHash,source.sourceHash,'source hash must be frozen');
      assert.equal(provenance.sourceUrl,source.sourceUrl,'source detail URL must be frozen');
      const next=clone(report);next.catalog.services.find(s=>s.code===source.code).price.terms[0].value='Changed tariff';
      const integration=createIntegrations(store,{fetchCatalog:async()=>next});const pending=await integration.runImport();await integration.approveImport(pending.id);
      const later=(await store.contract(c.id)).services[0];assert.deepEqual(later.sourceSnapshot?.price??later.sourcePrice??later.price,source.price);
      assert.deepEqual((await store.contract(c.id)).snapshot,originalSnapshot,'later imports or derived review state cannot rewrite a registered snapshot');
    });
  }finally{await db.close();}
});
