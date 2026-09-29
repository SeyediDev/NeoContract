import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { createApi } from '../lib/http-api.mjs';
import { createStaticServer } from '../server.mjs';
import { DEMO_TENANT_ID } from '../lib/database.mjs';

function http(port,path,{method='GET',body,raw,headers={}}={}) {
 return new Promise((resolve,reject)=>{
  const payload=raw ?? (body===undefined ? undefined : JSON.stringify(body));
  const req=request({hostname:'127.0.0.1',port,path,method,headers:{...(payload===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,data});});
  });req.on('error',reject);if(payload!==undefined)req.write(payload);req.end();
 });
}

test('real HTTP API with PostgreSQL: CRM, templates, snapshots, workflow and document boundary', {timeout:180000}, async t=>{
 const app=await createApi({dataDir:'memory://'});
 const server=createStaticServer({apiHandler:app.handler});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const call=(path,options)=>http(port,path,options);
 const ok=async(path,options={},status=200)=>{const r=await call(path,options);assert.equal(r.status,status,`${options.method||'GET'} ${path}: ${r.text}`);return r.data;};
 let bootstrap,manager,parent,customer,template,versionOne,contract,contractSnapshot;
 const validTerms={start:'2026-10-01',end:'2027-09-30',owner:'مالک آزمون',paymentTerms:'پرداخت ماهانه پس از پذیرش'};
 const advanceInput=value=>({expectedStatus:value.status,expectedStepId:value.stages.find(s=>s.status==='active')?.stepId||null});
 const malicious='<img src=x onerror="alert(1)"> & <script>alert(2)</script>';
 try {
  await t.test('bootstrap reports actual persisted catalog and seeds',async()=>{
   bootstrap=await ok('/api/bootstrap');assert.equal(bootstrap.catalog.services.length,87);assert.equal(bootstrap.catalog.centers.length,14);assert.equal(bootstrap.templates.length,15);assert.equal(bootstrap.customers.length,4);assert.equal(bootstrap.managers.length,3);
   assert.ok(bootstrap.catalog.services.every(s=>s.tier===null && s.delivery===null));
   const health=await ok('/api/health');assert.equal(health.backend,'pglite-postgresql');assert.equal(health.counts.services,87);
  });
  await t.test('CRM validates input, hierarchy cycles and cross-tenant IDs',async()=>{
   assert.equal((await call('/api/managers',{method:'POST',body:{name:'مدیر آزمون',email:'invalid'}})).status,400);
   manager=await ok('/api/managers',{method:'POST',body:{name:'مدیر آزمون',email:'manager@example.invalid',role:'مسئول حساب',phone:'000'}},201);
   parent=await ok('/api/customers',{method:'POST',body:{name:'هلدینگ آزمون',managerId:manager.id,unit:'ستاد',industry:'خدمات'}},201);
   customer=await ok('/api/customers',{method:'POST',body:{name:'شرکت آزمون',managerId:manager.id,parentId:parent.id,unit:'فناوری',industry:'فناوری'}},201);
   const cycle=await call(`/api/customers/${parent.id}`,{method:'PUT',body:{...parent,parentId:customer.id}});assert.equal(cycle.status,400);
   const foreignTenant=randomUUID(),foreignManager=randomUUID();
   await app.db.query('INSERT INTO contracts.tenants(id,slug,name) VALUES($1,$2,$3)',[foreignTenant,'api-foreign','Foreign']);
   await app.db.query('INSERT INTO contracts.account_managers(id,tenant_id,manager_code,display_name) VALUES($1,$2,$3,$4)',[foreignManager,foreignTenant,'FOREIGN','Foreign manager']);
   assert.equal((await call('/api/customers',{method:'POST',body:{name:'cross tenant',managerId:foreignManager}})).status,404);
   assert.equal((await call(`/api/managers/${foreignManager}`,{method:'PUT',body:{name:'overwrite'}})).status,404);
   const listed=await ok('/api/managers');assert.ok(!listed.some(m=>m.id===foreignManager));
   assert.equal((await call(`/api/managers/${manager.id}`,{method:'DELETE'})).status,409,'referenced manager cannot be deleted');
   assert.equal((await ok('/api/customers')).find(c=>c.id===parent.id).parentId,null,'failed cycle did not mutate parent');
  });
  await t.test('concurrent customer reparenting cannot create a hierarchy cycle',async()=>{
   const left=await ok('/api/customers',{method:'POST',body:{name:'شاخه نخست هم‌زمانی'}},201),right=await ok('/api/customers',{method:'POST',body:{name:'شاخه دوم هم‌زمانی'}},201);
   const results=await Promise.all([call(`/api/customers/${left.id}`,{method:'PUT',body:{...left,parentId:right.id}}),call(`/api/customers/${right.id}`,{method:'PUT',body:{...right,parentId:left.id}})]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,400],results.map(r=>r.text).join('\n'));
   const rows=(await ok('/api/customers')).filter(c=>[left.id,right.id].includes(c.id));assert.equal(rows.filter(c=>c.parentId===null).length,1);assert.equal(rows.filter(c=>c.parentId!==null).length,1);
   const winner=results.find(r=>r.status===200).data;assert.equal(rows.find(c=>c.id===winner.id).parentId,winner.parentId);assert.equal(rows.find(c=>c.id===winner.parentId).parentId,null);
  });
  await t.test('template draft editing and publication preserve old published versions',async()=>{
   const base=bootstrap.templates.find(x=>x.code==='purchase');
   template=await ok('/api/templates',{method:'POST',body:{...base,title:'الگوی آزمون مستقل',body:'سند {{title}} برای {{party}}؛ مبلغ {{amount}}؛ {{services}}؛ {{sla}}؛ مسئول {{owner}}',stages:[...base.stages,{id:'optional-review',name:'بازبینی اختیاری',role:'observer',slaDays:1,required:false,enabled:false}]}},201);
   assert.equal(template.status,'draft');assert.equal(template.version,1);
   const firstId=template.templateVersionId;
   template=await ok(`/api/templates/${template.id}`,{method:'PUT',body:{...template,body:template.body+'؛ متن تکمیلی'}});
   assert.equal(template.templateVersionId,firstId);assert.equal(template.version,1);
   template=await ok(`/api/templates/${template.id}/publish`,{method:'POST',body:{}});assert.equal(template.status,'published');versionOne={...template};
   template=await ok(`/api/templates/${template.id}`,{method:'PUT',body:{...template,body:template.body+'؛ نسخه دوم'}});
   assert.equal(template.status,'draft');assert.equal(template.version,2);assert.notEqual(template.templateVersionId,versionOne.templateVersionId);
   const old=(await app.db.query('SELECT body_template,status FROM contracts.contract_template_versions WHERE tenant_id=$1 AND id=$2',[DEMO_TENANT_ID,versionOne.templateVersionId])).rows[0];assert.equal(old.body_template,versionOne.body);assert.equal(old.status,'published');
   template=await ok(`/api/templates/${template.id}/publish`,{method:'POST',body:{}});assert.equal(template.status,'published');
   assert.equal((await call('/api/templates',{method:'POST',body:{...template,body:'{{unknownVariable}}'}})).status,400);
  });
  await t.test('stale draft revisions cannot overwrite a newer edit',async()=>{
   const first=await ok('/api/templates',{method:'POST',body:{...bootstrap.templates.find(x=>x.code==='purchase'),title:'آزمون ویرایش هم‌زمان الگو',body:'متن نخست {{title}}'}},201);
   assert.match(first.revision,/^[a-f0-9]{64}$/);
   const saved=await ok(`/api/templates/${first.id}`,{method:'PUT',body:{...first,body:'متن تغییرکرده توسط ویراستار نخست {{title}}'}});assert.equal(saved.version,first.version);assert.equal(saved.templateVersionId,first.templateVersionId);assert.notEqual(saved.revision,first.revision);
   const stale=await call(`/api/templates/${first.id}`,{method:'PUT',body:{...first,title:'عنوان ویراستار دوم'}});assert.equal(stale.status,409);
   const after=(await ok('/api/templates')).find(x=>x.id===first.id);assert.equal(after.body,saved.body);assert.equal(after.title,saved.title);assert.equal(after.revision,saved.revision);
   const {revision,...withoutRevision}=saved;assert.equal((await call(`/api/templates/${first.id}`,{method:'PUT',body:withoutRevision})).status,409);
   const raced=await Promise.all([call(`/api/templates/${first.id}`,{method:'PUT',body:{...saved,title:'عنوان هم‌زمان نخست'}}),call(`/api/templates/${first.id}`,{method:'PUT',body:{...saved,title:'عنوان هم‌زمان دوم'}})]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409],raced.map(r=>r.text).join('\n'));
   const latest=(await ok('/api/templates')).find(x=>x.id===first.id);assert.equal(latest.title,raced.find(r=>r.status===200).data.title);assert.equal(latest.body,saved.body);
  });
  await t.test('preview/create validate requirements and atomically store the full snapshot',async()=>{
   const service=bootstrap.catalog.services[0];
   const input={...validTerms,templateId:template.id,customerId:customer.id,managerId:manager.id,title:malicious,party:customer.name,amount:'۱۲۰۰۰',start:'2026-10-01',end:'2027-09-30',owner:'مالک آزمون',unit:'فناوری',services:[{code:service.code,slaTier:'T1',quantity:2,unitPrice:6000,delivery:'managed'}]};
   assert.equal((await call('/api/contracts/preview',{method:'POST',body:{...input,end:'2026-01-01'}})).status,400);
   assert.equal((await call('/api/contracts/preview',{method:'POST',body:{...input,start:'2026-02-30'}})).status,400);
   assert.equal((await call('/api/contracts/preview',{method:'POST',body:{...input,services:[{code:service.code,quantity:-1}]}})).status,400);
   assert.equal((await call('/api/contracts/preview',{method:'POST',body:{...input,services:[...input.services,...input.services]}})).status,400);
   assert.equal((await call('/api/contracts/preview',{method:'POST',body:{...input,stages:template.stages.filter(s=>!s.required)}})).status,400);
   const preview=await ok('/api/contracts/preview',{method:'POST',body:input});assert.equal(preview.snapshot.services[0].name,service.name);assert.equal(preview.snapshot.services[0].sla.code,'T1');assert.equal(preview.snapshot.services[0].model,service.model);assert.ok(!preview.document.includes('{{'));assert.equal(preview.snapshot.template.version,2);
   assert.equal((await ok('/api/contracts')).length,0,'preview and invalid requests create no contracts');
   contract=await ok('/api/contracts',{method:'POST',body:input},201);contractSnapshot=structuredClone(contract.snapshot);
   assert.equal(contract.status,'draft');assert.equal(contract.services[0].quantity,2);assert.equal(contract.services[0].slaTier,'T1');assert.equal(contract.snapshot.customer.name,customer.name);assert.equal(contract.snapshot.manager.name,manager.name);assert.equal(contract.history.length,1);
   const count=(await app.db.query(`SELECT (SELECT count(*)::int FROM contracts.contract_services WHERE contract_id=$1) services,(SELECT count(*)::int FROM contracts.contract_documents WHERE contract_id=$1) documents,(SELECT count(*)::int FROM contracts.contract_events WHERE contract_id=$1) events,(SELECT count(*)::int FROM contracts.contract_processes WHERE contract_id=$1) processes`,[contract.id])).rows[0];assert.deepEqual(count,{services:1,documents:1,events:1,processes:1});
   const savedService=(await app.db.query('SELECT service_snapshot FROM contracts.contract_services WHERE contract_id=$1',[contract.id])).rows[0];assert.equal(savedService.service_snapshot.name,service.name);assert.equal(savedService.service_snapshot.sla.code,'T1');
  });
  await t.test('required contract terms reject missing values while explicit zero remains valid',async()=>{
   const input={...validTerms,templateId:template.id,customerId:customer.id,title:'آزمون مقادیر الزامی',amount:0,services:[{code:bootstrap.catalog.services[0].code,slaTier:'T1',quantity:1,unitPrice:0,delivery:'managed'}]};
   const before=(await ok('/api/contracts')).length;
   const invalid=[];
   for(const key of ['amount','owner','start','end','paymentTerms'])for(const value of [undefined,null,'','   '])invalid.push({label:`${key}: ${String(value)}`,body:{...input,[key]:value}});
   for(const key of ['unitPrice','delivery'])for(const value of [undefined,null,'','   '])invalid.push({label:`service ${key}: ${String(value)}`,body:{...input,services:[{...input.services[0],[key]:value}]}});
   invalid.push({label:'unsupported delivery',body:{...input,services:[{...input.services[0],delivery:'unsupported'}]}},{label:'boolean amount',body:{...input,amount:false}},{label:'separator-only price',body:{...input,services:[{...input.services[0],unitPrice:','}]}});
   for(const example of invalid)for(const path of ['/api/contracts/preview','/api/contracts']){const response=await call(path,{method:'POST',body:example.body});assert.equal(response.status,400,`${example.label} at ${path}: ${response.text}`);}
   assert.equal((await ok('/api/contracts')).length,before,'invalid terms cannot persist an immutable snapshot');
   const preview=await ok('/api/contracts/preview',{method:'POST',body:input});assert.equal(preview.amount,0);assert.equal(preview.services[0].unitPrice,0);
   const created=await ok('/api/contracts',{method:'POST',body:input},201);assert.equal(created.amount,0);assert.equal(created.services[0].unitPrice,0);assert.equal(created.services[0].delivery,'managed');
  });
  await t.test('registered document resolves the final contract number everywhere',async()=>{
   const input={...validTerms,templateId:template.id,customerId:customer.id,managerId:manager.id,title:'آزمون شماره سند',amount:100,services:[],body:'شماره قطعی {{contractNumber}}'};
   const preview=await ok('/api/contracts/preview',{method:'POST',body:input});assert.ok(preview.document.includes('پس از ثبت'));
   const created=await ok('/api/contracts',{method:'POST',body:input},201);assert.match(created.number,/^NC-\d{4}-[A-F0-9]{8}$/);assert.ok(created.document.includes(created.number));assert.ok(!created.document.includes('پس از ثبت'));assert.ok(!created.document.includes('{{contractNumber}}'));assert.equal(created.snapshot.number,created.number);assert.equal(created.snapshot.document,created.document);
   const stored=(await app.db.query('SELECT metadata,sha256,byte_size FROM contracts.contract_documents WHERE contract_id=$1',[created.id])).rows[0];assert.equal(stored.metadata.body,created.document);assert.equal(stored.sha256,createHash('sha256').update(created.document).digest('hex'));assert.equal(Number(stored.byte_size),Buffer.byteLength(created.document));
   const reread=await ok(`/api/contracts/${created.id}`);assert.equal(reread.document,created.document);const printable=await call(`/api/contracts/${created.id}/document`);assert.equal(printable.status,200);assert.ok(printable.text.includes(created.number));assert.ok(!printable.text.includes('پس از ثبت'));
  });
  await t.test('concurrent idempotent creation saves one contract and rejects conflicting payloads',async()=>{
   const input={...validTerms,templateId:template.id,customerId:customer.id,managerId:manager.id,title:'قرارداد درخواست هم‌زمان',party:customer.name,amount:100,start:'2026-10-01',end:'2027-09-30',owner:'مالک آزمون',unit:'فناوری',services:[],idempotencyKey:randomUUID()};
   const same=await Promise.all([call('/api/contracts',{method:'POST',body:input}),call('/api/contracts',{method:'POST',body:input})]);
   assert.deepEqual(same.map(r=>r.status),[201,201],same.map(r=>r.text).join('\n'));assert.equal(same[0].data.id,same[1].data.id);
   const id=same[0].data.id;const persisted=(await app.db.query(`SELECT (SELECT count(*)::int FROM contracts.contracts WHERE tenant_id=$1 AND metadata->>'idempotencyKey'=$2) contracts,(SELECT count(*)::int FROM contracts.contract_processes WHERE contract_id=$3) processes,(SELECT count(*)::int FROM contracts.contract_documents WHERE contract_id=$3) documents,(SELECT count(*)::int FROM contracts.contract_events WHERE contract_id=$3) events`,[DEMO_TENANT_ID,input.idempotencyKey,id])).rows[0];assert.deepEqual(persisted,{contracts:1,processes:1,documents:1,events:1});
   assert.equal((await call('/api/contracts',{method:'POST',body:{...input,title:'محتوای متفاوت'}})).status,409);assert.equal((await ok(`/api/contracts/${id}`)).title,input.title);
   const key=randomUUID(),left={...input,idempotencyKey:key,title:'گزینه نخست'},right={...input,idempotencyKey:key,title:'گزینه دوم'};
   const raced=await Promise.all([call('/api/contracts',{method:'POST',body:left}),call('/api/contracts',{method:'POST',body:right})]);assert.deepEqual(raced.map(r=>r.status).sort(),[201,409],raced.map(r=>r.text).join('\n'));
   const records=(await app.db.query("SELECT id,title FROM contracts.contracts WHERE tenant_id=$1 AND metadata->>'idempotencyKey'=$2",[DEMO_TENANT_ID,key])).rows;assert.equal(records.length,1);assert.equal(records[0].id,raced.find(r=>r.status===201).data.id);assert.equal(records[0].title,raced.find(r=>r.status===201).data.title);
  });
  await t.test('concurrent workflow retries cannot approve the following stage',async()=>{
   const created=await ok('/api/contracts',{method:'POST',body:{...validTerms,templateId:template.id,customerId:customer.id,managerId:manager.id,title:'آزمون هم‌زمانی مراحل',party:customer.name,amount:100,services:[]}},201);
   const path=`/api/contracts/${created.id}/advance`,start={...advanceInput(created),comment:'شروع یکسان'};
   const starting=await Promise.all([call(path,{method:'POST',body:start}),call(path,{method:'POST',body:start})]);assert.deepEqual(starting.map(r=>r.status).sort(),[200,409],starting.map(r=>r.text).join('\n'));
   let current=await ok(`/api/contracts/${created.id}`);assert.equal(current.stages.filter(s=>s.status==='completed').length,0);assert.equal(current.stages.filter(s=>s.status==='active').length,1);
   const first=current.stages.find(s=>s.status==='active'),approve={...advanceInput(current),comment:'تأیید یکسان'};
   const approving=await Promise.all([call(path,{method:'POST',body:approve}),call(path,{method:'POST',body:approve})]);assert.deepEqual(approving.map(r=>r.status).sort(),[200,409],approving.map(r=>r.text).join('\n'));
   current=await ok(`/api/contracts/${created.id}`);assert.deepEqual(current.stages.filter(s=>s.status==='completed').map(s=>s.stepId),[first.stepId]);assert.equal(current.stages.filter(s=>s.status==='active').length,1);assert.notEqual(current.stages.find(s=>s.status==='active').stepId,first.stepId);assert.equal(current.history.filter(e=>e.type==='workflow_advanced').length,2);
   assert.equal((await call(path,{method:'POST',body:approve})).status,409,'delayed retry still cannot approve the next stage');
  });
  await t.test('workflow advances required stages and amendments have sequential numbers',async()=>{
   let value=await ok(`/api/contracts/${contract.id}/advance`,{method:'POST',body:{...advanceInput(contract),comment:'شروع'}});assert.equal(value.status,'in_process');assert.equal(value.stages.filter(s=>s.status==='active').length,1);
   let advances=0;while(value.status!=='active'&&advances<30){value=await ok(`/api/contracts/${contract.id}/advance`,{method:'POST',body:{...advanceInput(value),comment:'تأیید آزمون'}});advances++;}
   assert.equal(value.status,'active');assert.ok(value.stages.filter(s=>s.required).every(s=>s.status==='completed'));assert.equal(value.stages.find(s=>s.id==='optional-review').status,'skipped');
   assert.equal((await call(`/api/contracts/${contract.id}/advance`,{method:'POST',body:{}})).status,409);
   value=await ok(`/api/contracts/${contract.id}/amendments`,{method:'POST',body:{title:'الحاقیه نخست',reason:'تغییر دامنه',body:'بند تکمیلی'}});assert.equal(value.amendments[0].number,1);
   value=await ok('/api/amendments',{method:'POST',body:{contractId:contract.id,title:'الحاقیه دوم',reason:'تمدید',body:'بند مدت'}});assert.deepEqual(value.amendments.map(a=>a.number),[1,2]);
   assert.deepEqual(value.snapshot,contractSnapshot,'workflow and amendment do not rewrite original snapshot');
  });
  await t.test('later customer, manager, template and catalog edits leave contract snapshots unchanged',async()=>{
   await ok(`/api/customers/${customer.id}`,{method:'PUT',body:{...customer,name:'نام تازه مشتری'}});
   await ok(`/api/managers/${manager.id}`,{method:'PUT',body:{...manager,name:'نام تازه مدیر'}});
   const draft=await ok(`/api/templates/${template.id}`,{method:'PUT',body:{...template,body:template.body+'؛ نسخه سوم'}});assert.equal(draft.version,3);await ok(`/api/templates/${template.id}/publish`,{method:'POST',body:{}});
   await app.db.query('UPDATE contracts.catalog_services SET name=$1 WHERE tenant_id=$2 AND service_code=$3',['نام تازه سرویس',DEMO_TENANT_ID,contract.services[0].code]);
   const reread=await ok(`/api/contracts/${contract.id}`);assert.deepEqual(reread.snapshot,contractSnapshot);assert.equal(reread.customerName,customer.name);assert.equal(reread.managerName,manager.name);
  });
  await t.test('HTML escapes hostile text and HTTP rejects foreign origin and invalid JSON',async()=>{
   const doc=await call(`/api/contracts/${contract.id}/document`);assert.equal(doc.status,200);assert.match(doc.headers['content-type'],/text\/html/);assert.ok(!doc.text.includes('<script>alert(2)</script>'));assert.ok(!doc.text.includes('<img src=x'));assert.ok(doc.text.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));assert.ok(doc.text.includes('&amp;'));
   assert.equal((await call('/api/managers',{method:'POST',body:{name:'blocked'},headers:{Origin:'https://unrelated.example'}})).status,403);
   assert.equal((await call('/api/managers',{method:'POST',body:{name:'blocked'},headers:{Origin:'null'}})).status,403);
   assert.equal((await call('/api/managers',{method:'POST',raw:'{bad json'})).status,400);
   assert.equal((await call('/api/contracts/not-a-uuid')).status,409);
   assert.equal((await call('/api/unknown')).status,404);
   const created=await ok('/api/managers',{method:'POST',body:{name:'same-origin'},headers:{Origin:`http://127.0.0.1:${port}`}},201);assert.ok(created.id);
   assert.equal((await call(`/api/managers/${created.id}`,{method:'DELETE'})).status,200);
  });
 } finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await app.close();}
});
