import { randomUUID, createHash } from 'node:crypto';
import { AppError, requireValue, text, validateTemplate, prepareContract, clone } from './domain.mjs';
export const DEMO_TENANT = '00000000-0000-0000-0000-000000000001';
const json = value => JSON.stringify(value);
const dt = value => value instanceof Date ? value.toISOString() : value;
const dateOnly = value => value ? String(dt(value)).slice(0,10) : '';
const managerDto = r => ({id:r.id,name:r.display_name,role:r.portfolio||'',email:r.email||'',phone:r.phone||'',status:r.status,verificationStatus:r.verification_status});
const customerDto = r => ({id:r.id,name:r.legal_name,parentId:r.parent_id,managerId:r.account_manager_id,unit:r.unit||'',industry:r.industry||'',status:r.status,segment:r.segment||'',contactName:r.primary_contact_name||'',email:r.primary_contact_email||'',verificationStatus:r.verification_status});

export function createStore(db, tenantId = DEMO_TENANT) {
  const q = async (sql,params=[]) => (await db.query(sql,params)).rows;
  const one = async (sql,params=[]) => (await q(sql,params))[0];
  const requireRecord = row => { requireValue(row,'رکورد یافت نشد.',404); return row; };
  const inTenant = async (table,id) => id ? requireRecord(await one(`SELECT * FROM contracts.${table} WHERE tenant_id=$1 AND id=$2`,[tenantId,id])) : null;
  async function managers(){return (await q('SELECT * FROM contracts.account_managers WHERE tenant_id=$1 ORDER BY created_at,id',[tenantId])).map(managerDto);}
  async function customers(){return (await q('SELECT * FROM contracts.customers WHERE tenant_id=$1 ORDER BY created_at,id',[tenantId])).map(customerDto);}
  async function getSetting(key,fallback={}) { return (await one('SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key=$2',[tenantId,key]))?.value ?? fallback; }
  async function setSetting(key,value) { await q('INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,$2,$3) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value',[tenantId,key,json(value)]);return value; }
  async function settings(){const tenant=await one('SELECT name FROM contracts.tenants WHERE id=$1',[tenantId]);return {tenantId,workspaceName:tenant?.name||'نئوکنتراکت',currency:'IRR',...await getSetting('workspace',{})};}
  async function saveSettings(input){return setSetting('workspace',{workspaceName:text(input.workspaceName,'نام فضای کاری'),currency:'IRR',defaultPaymentTerms:text(input.defaultPaymentTerms,'شرایط پرداخت پیش‌فرض',{optional:true,max:4000})});}
  async function catalog() {
    const current=await getSetting('catalog-current',null);
    if(current){const value=clone(current);value.centers=value.centers.map(c=>({...c,services:value.services.filter(s=>s.centerId===c.id)}));return value;}
    const centers=await q('SELECT c.*,z.name zone FROM contracts.catalog_centers c JOIN contracts.catalog_zones z ON z.tenant_id=c.tenant_id AND z.id=c.zone_id WHERE c.tenant_id=$1 ORDER BY z.display_order,c.center_key',[tenantId]);
    const services=await q('SELECT s.*,c.center_key,c.name center_name,z.name zone FROM contracts.catalog_services s JOIN contracts.catalog_centers c ON c.tenant_id=s.tenant_id AND c.id=s.center_id JOIN contracts.catalog_zones z ON z.tenant_id=c.tenant_id AND z.id=c.zone_id WHERE s.tenant_id=$1 ORDER BY s.service_code',[tenantId]);
    const source=await one('SELECT * FROM contracts.catalog_sources WHERE tenant_id=$1 ORDER BY created_at LIMIT 1',[tenantId]);
    const sla=await q('SELECT * FROM contracts.sla_tiers WHERE tenant_id=$1 ORDER BY code',[tenantId]);
    const models=await q('SELECT * FROM contracts.revenue_models WHERE tenant_id=$1 ORDER BY code',[tenantId]);
    const items=services.map(s=>({id:s.id,code:s.service_code,name:s.name,centerId:s.center_key,centerName:s.center_name,zone:s.zone,model:s.pricing_model,revenueModel:s.pricing_model,tier:null,delivery:s.delivery,source:source?.source_url,verificationStatus:s.verification_status}));
    return {centers:centers.map(c=>({id:c.center_key,name:c.name,zone:c.zone,services:items.filter(s=>s.centerId===c.center_key)})),services:items,slaProfiles:sla.map(s=>({id:s.id,code:s.code,tier:s.code,label:s.label,name:s.label,availabilityPct:Number(s.availability_pct),availability:`${s.availability_pct}%`,response:s.first_response_text,resolution:s.resolution_target_text,responseValue:Number(s.first_response_value),responseUnit:s.first_response_unit,resolutionValue:Number(s.resolution_target_value),resolutionUnit:s.resolution_target_unit,coverage:s.coverage,businessCalendar:s.business_calendar})),revenueModels:models.map(m=>({code:m.code,name:m.name,description:m.description})),source:source?.source_url,observedAt:dt(source?.observed_at),verificationStatus:source?.verification_status||'manual-unverified'};
  }
  async function saveManager(input,id){
    if(id)await inTenant('account_managers',id);
    const value={name:text(input.name,'نام مدیر حساب'),role:text(input.role,'مسئولیت',{optional:true}),email:text(input.email,'ایمیل',{optional:true}),phone:text(input.phone,'تلفن',{optional:true}),status:input.status||'active'};
    requireValue(['active','inactive'].includes(value.status),'وضعیت مدیر حساب معتبر نیست.');
    requireValue(!value.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email),'ایمیل معتبر نیست.');
    const row=id?await one('UPDATE contracts.account_managers SET display_name=$3,portfolio=$4,email=$5,phone=$6,status=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenantId,id,value.name,value.role,value.email,value.phone,value.status]):await one('INSERT INTO contracts.account_managers(tenant_id,manager_code,display_name,portfolio,email,phone,status,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[tenantId,`AM-${randomUUID().slice(0,8)}`,value.name,value.role,value.email,value.phone,value.status,'manual-unverified']);
    return managerDto(row);
  }
  async function saveCustomer(input,id){
    const value={name:text(input.name,'نام مشتری'),unit:text(input.unit,'واحد',{optional:true}),industry:text(input.industry,'صنعت',{optional:true}),status:input.status||'active'};
    requireValue(['lead','active','paused','churned'].includes(value.status),'وضعیت مشتری معتبر نیست.');
    let row;
    await db.transaction(async tx=>{
      await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
      const related=async(table,key)=>requireRecord((await tx.query('SELECT * FROM contracts.'+table+' WHERE tenant_id=$1 AND id=$2',[tenantId,key])).rows[0]);
      if(id)await related('customers',id);
      if(input.managerId)await related('account_managers',input.managerId);
      if(input.parentId){let cursor=input.parentId;const seen=new Set(id?[id]:[]);while(cursor){requireValue(!seen.has(cursor),'رابطه هلدینگ نمی‌تواند چرخه داشته باشد.');seen.add(cursor);cursor=(await related('customers',cursor)).parent_id;}}
      row=id?(await tx.query('UPDATE contracts.customers SET legal_name=$3,parent_id=$4,account_manager_id=$5,unit=$6,industry=$7,status=$8 WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenantId,id,value.name,input.parentId||null,input.managerId||null,value.unit,value.industry,value.status])).rows[0]:(await tx.query('INSERT INTO contracts.customers(tenant_id,customer_code,legal_name,parent_id,account_manager_id,unit,industry,status,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[tenantId,'CUS-'+randomUUID().slice(0,8),value.name,input.parentId||null,input.managerId||null,value.unit,value.industry,value.status,'manual-unverified'])).rows[0];
    });return customerDto(row);
  }
  async function removeEntity(kind,id){const table=kind==='customers'?'customers':'account_managers';await inTenant(table,id);await q(`DELETE FROM contracts.${table} WHERE tenant_id=$1 AND id=$2`,[tenantId,id]);return {deleted:true,id};}
  const templateDto=r=>{
    const saved=r.variable_schema?.templateMetadata;
    const metadata={title:saved?.title??r.name,category:saved?.category??r.category,description:saved?.description??r.description,revenueModels:saved?.revenueModels??r.variable_schema?.revenueModels??r.metadata?.revenueModels??[],serviceCodes:saved?.serviceCodes??r.metadata?.serviceCodes??[]};
    const status=r.status==='archived'?'archived':r.version_status==='published'?'published':'draft';
    return {revision:createHash('sha256').update(JSON.stringify([r.version_id,r.version_no,status,metadata,r.body_template,r.process_config])).digest('hex'),id:r.id,code:r.code,...metadata,status,version:r.version_no,templateVersionId:r.version_id,body:r.body_template,stages:r.process_config?.stages||[],createdAt:dt(r.created_at)};
  };
  async function templates(){
    const rows=await q('SELECT * FROM contracts.contract_templates WHERE tenant_id=$1 ORDER BY created_at,code',[tenantId]);
    const result=[];
    for(const t of rows){
      const versions=await q('SELECT * FROM contracts.contract_template_versions WHERE tenant_id=$1 AND template_id=$2 ORDER BY version_no DESC',[tenantId,t.id]);
      const values=versions.map(v=>templateDto({...t,version_id:v.id,version_no:v.version_no,version_status:v.status,body_template:v.body_template,process_config:v.process_config,variable_schema:v.variable_schema}));
      if(values.length)result.push({...values[0],versions:values,currentPublishedVersion:t.status==='archived'?null:values.find(v=>v.templateVersionId===t.current_version_id&&v.status==='published')||null});
    }
    return result;
  }
  async function selectedTemplate(id,versionId){
    const row=await one(`SELECT t.*,v.id version_id,v.version_no,v.status version_status,v.body_template,v.process_config,v.variable_schema FROM contracts.contract_templates t JOIN contracts.contract_template_versions v ON v.tenant_id=t.tenant_id AND v.template_id=t.id AND v.id=COALESCE($3::uuid,t.current_version_id) WHERE t.tenant_id=$1 AND t.id=$2`,[tenantId,id,versionId||null]);return row?templateDto(row):null;
  }
  async function saveTemplate(input,id){
    const previous=id?(await templates()).find(x=>x.id===id):{};if(id)requireRecord(previous);
    const value=validateTemplate(input,previous);const templateId=id||randomUUID();
    const variableSchema={revenueModels:value.revenueModels,templateMetadata:{title:value.title,category:value.category,description:value.description,revenueModels:value.revenueModels,serviceCodes:value.serviceCodes}};
    await db.transaction(async tx=>{
      const query=async(s,p)=>(await tx.query(s,p)).rows;
      if(id){const t=(await query('SELECT * FROM contracts.contract_templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id]))[0];const v=(await query('SELECT * FROM contracts.contract_template_versions WHERE tenant_id=$1 AND template_id=$2 ORDER BY version_no DESC LIMIT 1',[tenantId,id]))[0];const current=templateDto({...t,version_id:v.id,version_no:v.version_no,version_status:v.status,body_template:v.body_template,process_config:v.process_config,variable_schema:v.variable_schema});requireValue(input.revision===current.revision,'این الگو توسط درخواست دیگری تغییر کرده است؛ تازه‌سازی و تغییرات را دوباره بررسی کنید.',409);}

      if(!id)await query('INSERT INTO contracts.contract_templates(id,tenant_id,code,name,category,description,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[templateId,tenantId,`CUSTOM-${randomUUID().slice(0,8)}`,value.title,value.category,value.description,json({revenueModels:value.revenueModels,serviceCodes:value.serviceCodes})]);
      // Keep legacy master metadata stable; mutable draft metadata belongs to its version.
      const versions=await query('SELECT * FROM contracts.contract_template_versions WHERE tenant_id=$1 AND template_id=$2 ORDER BY version_no DESC FOR UPDATE',[tenantId,templateId]);
      const latest=versions[0];const versionId=latest?.status==='draft'?latest.id:randomUUID();const version=latest?.status==='draft'?latest.version_no:(latest?.version_no||0)+1;
      if(latest?.status==='draft')await query('UPDATE contracts.contract_template_versions SET body_template=$3,process_config=$4,variable_schema=$5 WHERE tenant_id=$1 AND id=$2',[tenantId,versionId,value.body,json({stages:value.stages}),json(variableSchema)]);
      else await query('INSERT INTO contracts.contract_template_versions(id,tenant_id,template_id,version_no,body_template,process_config,variable_schema) VALUES($1,$2,$3,$4,$5,$6,$7)',[versionId,tenantId,templateId,version,value.body,json({stages:value.stages}),json(variableSchema)]);
      await query('DELETE FROM contracts.template_workflow_stages WHERE tenant_id=$1 AND template_version_id=$2',[tenantId,versionId]);
      for(const [i,s] of value.stages.entries())await query('INSERT INTO contracts.template_workflow_stages(tenant_id,template_version_id,stage_key,name,sequence_no,required,role_key,sla_days,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenantId,versionId,s.id,s.name,i+1,s.required,s.role,s.slaDays,json({enabled:s.enabled})]);
    });
    return (await templates()).find(x=>x.id===templateId);
  }
  async function templateAction(id,action,input={}){
    await db.transaction(async tx=>{
      const t=requireRecord((await tx.query('SELECT * FROM contracts.contract_templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows[0]);
      if(action==='archive'){
        await tx.query("UPDATE contracts.contract_templates SET status='archived' WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
        return;
      }
      const v=requireRecord((await tx.query('SELECT * FROM contracts.contract_template_versions WHERE tenant_id=$1 AND template_id=$2 ORDER BY version_no DESC LIMIT 1 FOR UPDATE',[tenantId,id])).rows[0]);
      const current=templateDto({...t,version_id:v.id,version_no:v.version_no,version_status:v.status,body_template:v.body_template,process_config:v.process_config,variable_schema:v.variable_schema});
      requireValue(input.templateVersionId===current.templateVersionId&&input.revision===current.revision,'نسخه الگو تغییر کرده است؛ پیش از انتشار دوباره آن را بازبینی کنید.',409);
      requireValue(current.status!=='archived','الگوی بایگانی‌شده قابل انتشار نیست.');validateTemplate(current);
      await tx.query("UPDATE contracts.contract_template_versions SET status='published',published_at=COALESCE(published_at,now()) WHERE tenant_id=$1 AND id=$2",[tenantId,current.templateVersionId]);
      await tx.query("UPDATE contracts.contract_templates SET status='active',current_version_id=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,current.templateVersionId]);
    });
    return (await templates()).find(x=>x.id===id);
  }
  async function preview(input,options={}){const template=await selectedTemplate(input.templateId,input.templateVersionId);return prepareContract(input,{templates:template?[template]:[],customers:await customers(),managers:await managers(),catalog:await catalog()},options);}
  async function event(tx,id,type,payload={},from=null,to=null){await tx.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,from_status,to_status,actor_label,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,id,type,from,to,'مدیر قراردادها',json(payload)]);}
  async function createContract(input){
    const idempotencyKey=input.idempotencyKey?text(input.idempotencyKey,'کلید درخواست',{max:120}):null;
    const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    async function existing(){if(!idempotencyKey)return null;const row=await one("SELECT id,metadata FROM contracts.contracts WHERE tenant_id=$1 AND metadata->>'idempotencyKey'=$2",[tenantId,idempotencyKey]);if(!row)return null;requireValue(row.metadata.requestHash===requestHash,'کلید درخواست برای محتوای دیگری استفاده شده است.',409);return contract(row.id);}
    const reused=await existing();if(reused)return reused;
    const id=randomUUID();const number=`NC-${new Date().getFullYear()}-${id.slice(0,8).toUpperCase()}`;const processId=randomUUID();const value=await preview(input,{contractNumber:number});
    value.snapshot.number=number;
    try { await db.transaction(async tx=>{
      await tx.query('INSERT INTO contracts.contracts(id,tenant_id,contract_no,title,contract_type,template_version_id,customer_id,account_manager_id,template_snapshot,start_date,end_date,total_value,variables,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,tenantId,number,value.title,value.snapshot.template.category,value.templateVersionId,value.customerId,value.managerId,json(value.snapshot),value.start,value.end,value.amount,json(value.snapshot.terms),json({idempotencyKey,requestHash})]);
      await tx.query('INSERT INTO contracts.contract_processes(id,tenant_id,contract_id,template_version_id,process_snapshot) VALUES($1,$2,$3,$4,$5)',[processId,tenantId,id,value.templateVersionId,json({stages:value.stages})]);
      for(const [i,s] of value.stages.entries())await tx.query('INSERT INTO contracts.contract_process_steps(tenant_id,process_id,step_key,name,sequence_no,status,required,is_custom,role_key,sla_days,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[tenantId,processId,s.id,s.name,i+1,s.enabled?'pending':'skipped',s.required,true,s.role,s.slaDays,json({enabled:s.enabled})]);
      for(const s of value.services){const row=(await tx.query('SELECT id FROM contracts.catalog_services WHERE tenant_id=$1 AND service_code=$2',[tenantId,s.code])).rows[0];await tx.query('INSERT INTO contracts.contract_services(tenant_id,contract_id,service_id,service_code,service_name_snapshot,pricing_model_snapshot,sla_tier_snapshot,service_snapshot,delivery,quantity,unit_price,source_verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[tenantId,id,row?.id||null,s.code,s.name,s.model,s.slaTier,json(s),s.delivery,s.quantity,s.unitPrice,s.sourceStatus]);}
      await tx.query('INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,byte_size,sha256,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenantId,id,'snapshot',`${number}.txt`,`database:${id}`,'text/plain; charset=utf-8',Buffer.byteLength(value.document),createHash('sha256').update(value.document).digest('hex'),json({body:value.document})]);
      await event(tx,id,'created',{number},null,'draft');
    }); } catch(error) {if(error.code==='23505'&&idempotencyKey){const saved=await existing();if(saved)return saved;}throw error;} return contract(id);
  }
  async function contract(id){
    const row=requireRecord(await one('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2',[tenantId,id]));
    const stages=await q('SELECT s.* FROM contracts.contract_process_steps s JOIN contracts.contract_processes p ON p.tenant_id=s.tenant_id AND p.id=s.process_id WHERE p.tenant_id=$1 AND p.contract_id=$2 ORDER BY sequence_no',[tenantId,id]);
    const history=await q('SELECT * FROM contracts.contract_events WHERE tenant_id=$1 AND contract_id=$2 ORDER BY occurred_at,id',[tenantId,id]);
    const amendments=await q('SELECT * FROM contracts.contract_amendments WHERE tenant_id=$1 AND contract_id=$2 ORDER BY amendment_no',[tenantId,id]);
    const snap=row.template_snapshot;
    return {id:row.id,number:row.contract_no,title:row.title,status:row.status,templateId:snap.template?.id,templateVersionId:row.template_version_id,customerId:row.customer_id,customerName:snap.customer?.name,party:snap.terms?.party,managerId:row.account_manager_id,managerName:snap.manager?.name,unit:snap.terms?.unit,owner:snap.terms?.owner,amount:Number(row.total_value),currency:row.currency,start:dateOnly(row.start_date),end:dateOnly(row.end_date),createdAt:dt(row.created_at),document:snap.document||'',services:snap.services||[],snapshot:snap,stages:stages.map(s=>({id:s.step_key,stepId:s.id,name:s.name,role:s.role_key,slaDays:s.sla_days,required:s.required,enabled:s.status!=='skipped',status:s.status,completedAt:dt(s.completed_at)})),history:history.map(e=>({id:e.id,type:e.event_type,at:dt(e.occurred_at),createdAt:dt(e.occurred_at),message:e.payload?.comment||e.event_type,...e.payload})),amendments:amendments.map(a=>({id:a.id,number:a.amendment_no,title:a.title,reason:a.reason,body:a.summary,status:a.status,createdAt:dt(a.created_at)})),neoBinding:row.neo_binding};
  }
  async function contracts(){const rows=await q('SELECT id FROM contracts.contracts WHERE tenant_id=$1 ORDER BY created_at DESC',[tenantId]);const result=[];for(const r of rows)result.push(await contract(r.id));return result;}
  async function advance(id,input={}){
    await db.transaction(async tx=>{
      const rows=(await tx.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows;const r=requireRecord(rows[0]);
      requireValue(['draft','in_process','awaiting_signature'].includes(r.status),'این قرارداد در وضعیت قابل پیشروی نیست.',409);
      const process=(await tx.query('SELECT * FROM contracts.contract_processes WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0];
      const steps=(await tx.query('SELECT * FROM contracts.contract_process_steps WHERE tenant_id=$1 AND process_id=$2 ORDER BY sequence_no',[tenantId,process.id])).rows.filter(s=>s.status!=='skipped');
      const activeStep=steps.find(s=>s.status==='active');
      requireValue(input.expectedStatus===r.status && (r.status==='draft'?input.expectedStepId==null:input.expectedStepId===activeStep?.id),'وضعیت یا مرحله قرارداد تغییر کرده است؛ جزئیات را تازه‌سازی کنید.',409);
      let next=r.status;
      if(r.status==='draft'){next='in_process';if(steps[0])await tx.query("UPDATE contracts.contract_process_steps SET status='active',started_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,steps[0].id]);await tx.query("UPDATE contracts.contract_processes SET status='running',started_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,process.id]);}
      else {const current=steps.find(s=>s.status==='active');requireValue(current,'مرحله فعال یافت نشد.',409);await tx.query("UPDATE contracts.contract_process_steps SET status='completed',completed_at=now(),completed_by_label=$3,output_data=$4 WHERE tenant_id=$1 AND id=$2",[tenantId,current.id,current.role_key,json({comment:text(input.comment,'توضیح',{optional:true,max:2000})})]);const following=steps.find(s=>s.sequence_no>current.sequence_no&&s.status==='pending');if(following){next=/امضا|sign/.test(following.name+' '+following.role_key)?'awaiting_signature':'in_process';await tx.query("UPDATE contracts.contract_process_steps SET status='active',started_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,following.id]);}else{next='active';await tx.query("UPDATE contracts.contract_processes SET status='completed',completed_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,process.id]);}}
      await tx.query('UPDATE contracts.contracts SET status=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,id,next]);await event(tx,id,'workflow_advanced',{comment:input.comment||'',status:next},r.status,next);
    });return contract(id);
  }
  async function amend(id,input){await inTenant('contracts',id);const title=text(input.title,'عنوان الحاقیه'),reason=text(input.reason,'علت الحاقیه'),body=text(input.body,'متن الحاقیه',{max:20000});await db.transaction(async tx=>{await tx.query('SELECT id FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id]);const r=(await tx.query('SELECT COALESCE(MAX(amendment_no),0)+1 n FROM contracts.contract_amendments WHERE tenant_id=$1 AND contract_id=$2',[tenantId,id])).rows[0];await tx.query('INSERT INTO contracts.contract_amendments(tenant_id,contract_id,amendment_no,title,reason,summary) VALUES($1,$2,$3,$4,$5,$6)',[tenantId,id,r.n,title,reason,body]);await event(tx,id,'amendment_created',{title,number:r.n});});return contract(id);}
  async function bootstrap(){return {catalog:await catalog(),customers:await customers(),managers:await managers(),templates:await templates(),contracts:await contracts(),settings:await settings()};}
  return {db,tenantId,q,one,inTenant,managers,customers,saveManager,saveCustomer,removeEntity,templates,saveTemplate,templateAction,selectedTemplate,catalog,preview,createContract,contract,contracts,advance,amend,settings,saveSettings,getSetting,setSetting,bootstrap};
}
