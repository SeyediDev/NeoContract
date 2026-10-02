import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const TITAN = '00000000-0000-0000-0000-000000000002';
const manifestUrl = new URL('../planning/titan-intake.json', import.meta.url);
const json = value => JSON.stringify(value);
const portableSource = source => {
  if (!source || typeof source !== 'object') return source;
  const {path,draftFile,...publicSource}=source;
  return publicSource;
};
const stableId = key => {
  const hex = createHash('sha256').update(`neocontract:titan-board:v1:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
export const TITAN_STAGES = [
  {id:'scope',name:'تأیید دامنه و تطبیق محصول',role:'product_owner',required:true,enabled:true,slaDays:2},
  {id:'commercial',name:'تکمیل مشخصات و شرایط مالی',role:'account_manager',required:true,enabled:true,slaDays:3},
  {id:'legal',name:'بررسی حقوقی و پیوست‌ها',role:'legal',required:true,enabled:true,slaDays:3},
  {id:'signature',name:'امضای صاحبان امضای مجاز',role:'signatory',required:true,enabled:true,slaDays:3},
  {id:'handover',name:'ابلاغ و آغاز اجرای مصوب',role:'delivery',required:true,enabled:true,slaDays:2},
];

/** Import once, atomically. Repeated startup preserves workflow, source and document snapshots. */
export async function provisionTitanBoard(db) {
  const manifest = JSON.parse(await readFile(manifestUrl,'utf8'));
  if (!Array.isArray(manifest.rows) || manifest.rows.length !== 10) throw new Error('Titan intake must contain six contracts and four scope records.');
  const contractRows = manifest.rows.filter(r=>r.kind!=='product-scope');
  if (contractRows.length !== 6) throw new Error('Titan intake must contain six contracts.');
  return db.transaction(async tx=>{
    const tenant = (await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[TITAN])).rows[0];
    if (!tenant) throw new Error('Provision the Titan tenant before its board.');
    const existing = (await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v1'",[TITAN])).rows[0];
    if (existing) return existing.value;
    const customers = (await tx.query('SELECT * FROM contracts.customers WHERE tenant_id=$1',[TITAN])).rows;
    const catalog = (await tx.query('SELECT s.*,c.center_key,c.name center_name FROM contracts.catalog_services s JOIN contracts.catalog_centers c ON c.tenant_id=s.tenant_id AND c.id=s.center_id WHERE s.tenant_id=$1',[TITAN])).rows;
    const boardRows = [];
    for (const row of manifest.rows) {
      const source = catalog.find(s=>s.service_code===row.serviceCode);
      if (!source || source.center_key!==row.centerId) throw new Error(`Invalid Titan catalog mapping: ${row.id}`);
      const customerName = row.customerKey==='basalam'?'باسلام':row.customerKey==='entekhab'?'انتخاب':null;
      const customer = customerName ? customers.find(c=>c.legal_name===customerName || c.customer_code.toLowerCase().includes(row.customerKey)) : null;
      if (customerName && !customer) throw new Error(`Missing Titan customer: ${row.customerKey}`);
      const saved = {...row, customerId:customer?.id||null, customerName:customer?.legal_name||row.sourceCustomer, centerName:source.center_name, serviceName:source.name, mappingStatus:'proposed', contractId:null, templateId:null};
      if (row.kind!=='product-scope') {
        if (!row.body || row.body.length<1200) throw new Error(`Incomplete Titan draft: ${row.id}`);
        const id=stableId(`contract:${row.id}`), templateId=stableId(`template:${row.id}`), versionId=stableId(`version:${row.id}`), processId=stableId(`process:${row.id}`);
        const number=`TITAN-DRAFT-${row.id.replace(/^titan-/,'').toUpperCase()}`;
        const metadata={intakeId:row.id,source:'titan-board',mappingStatus:'proposed',baseTemplateCode:row.templateCode||null,confirmationFlags:row.confirmationFlags||[],publicationMeaning:'technical-template-availability-only'};
        const template={id:templateId,templateVersionId:versionId,version:1,title:row.templateTitle||row.title,category:'قراردادهای تایتان',description:row.scope,status:'published',body:row.body,stages:TITAN_STAGES,serviceCodes:[row.serviceCode],revenueModels:['project','fixed']};
        const service={code:source.service_code,name:source.name,centerId:source.center_key,centerName:source.center_name,model:source.pricing_model,revenueModel:source.pricing_model,quantity:null,unitPrice:null,currency:'IRR',delivery:null,slaTier:null,sla:null,sourceStatus:source.verification_status,mappingStatus:'proposed',mappingRationale:row.mappingRationale||'',sourceSnapshot:{code:source.service_code,name:source.name},capturedAt:new Date().toISOString()};
        const terms={title:row.title,party:row.sourceCustomer,amount:null,currency:'IRR',start:null,end:null,unit:'',owner:'جواد',paymentTerms:'نیازمند تکمیل و توافق طرفین'};
        const snapshot={number,template,customer:customer?{id:customer.id,name:customer.legal_name}:null,manager:null,services:[service],stages:TITAN_STAGES,terms,createdAt:new Date().toISOString(),document:row.body,sourceStatus:'manual-unverified',intake:{...metadata,sourceCustomer:row.sourceCustomer,sourceDateHint:row.contractDateHint||null,supportingServices:row.supportingServices||[]}};
        await tx.query("INSERT INTO contracts.contract_templates(id,tenant_id,code,name,category,description,status,metadata) VALUES($1,$2,$3,$4,$5,$6,'active',$7)",[templateId,TITAN,`TITAN-${row.id.toUpperCase()}`,template.title,template.category,row.scope,json(metadata)]);
        await tx.query("INSERT INTO contracts.contract_template_versions(id,tenant_id,template_id,version_no,body_template,variable_schema,process_config,status,published_at) VALUES($1,$2,$3,1,$4,$5,$6,'published',now())",[versionId,TITAN,templateId,row.body,json({templateMetadata:{title:template.title,category:template.category,description:row.scope,serviceCodes:template.serviceCodes,revenueModels:template.revenueModels}}),json({stages:TITAN_STAGES})]);
        await tx.query('UPDATE contracts.contract_templates SET current_version_id=$3 WHERE tenant_id=$1 AND id=$2',[TITAN,templateId,versionId]);
        for (const [i,s] of TITAN_STAGES.entries()) await tx.query('INSERT INTO contracts.template_workflow_stages(tenant_id,template_version_id,stage_key,name,sequence_no,required,role_key,sla_days,metadata) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)',[TITAN,versionId,s.id,s.name,i+1,s.role,s.slaDays,json({enabled:true})]);
        await tx.query("INSERT INTO contracts.contracts(id,tenant_id,contract_no,title,contract_type,status,template_version_id,customer_id,template_snapshot,variables,metadata) VALUES($1,$2,$3,$4,$5,'in_process',$6,$7,$8,$9,$10)",[id,TITAN,number,row.title,template.category,versionId,customer?.id||null,json(snapshot),json(terms),json({...metadata,idempotencyKey:`titan-board-v1:${row.id}`})]);
        await tx.query("INSERT INTO contracts.contract_processes(id,tenant_id,contract_id,template_version_id,status,started_at,process_snapshot) VALUES($1,$2,$3,$4,'running',now(),$5)",[processId,TITAN,id,versionId,json({stages:TITAN_STAGES})]);
        for (const [i,s] of TITAN_STAGES.entries()) await tx.query("INSERT INTO contracts.contract_process_steps(tenant_id,process_id,step_key,name,sequence_no,status,required,is_custom,role_key,sla_days,metadata,started_at) VALUES($1,$2,$3,$4,$5,$6,true,true,$7,$8,$9,CASE WHEN $5=1 THEN now() ELSE NULL END)",[TITAN,processId,s.id,s.name,i+1,i===0?'active':'pending',s.role,s.slaDays,json({enabled:true})]);
        await tx.query('INSERT INTO contracts.contract_services(tenant_id,contract_id,service_id,service_code,service_name_snapshot,pricing_model_snapshot,service_snapshot,source_verification_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[TITAN,id,source.id,source.service_code,source.name,source.pricing_model,json(service),source.verification_status,json({mappingStatus:'proposed'})]);
        await tx.query('INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,byte_size,sha256,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[TITAN,id,'snapshot',`${number}.txt`,`database:${id}`,'text/plain; charset=utf-8',Buffer.byteLength(row.body),createHash('sha256').update(row.body).digest('hex'),json({body:row.body})]);
        await tx.query("INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,from_status,to_status,actor_label,payload) VALUES($1,$2,'titan_intake_started',NULL,'in_process','برد تایتان',$3)",[TITAN,id,json({intakeId:row.id,message:'ثبت پیش‌نویس و آغاز بررسی دامنه؛ شرایط تجاری و تطبیق محصول نیازمند تأیید است.'})]);
        Object.assign(saved,{contractId:id,contractNumber:number,templateId,templateTitle:template.title});
      }
      // Store a portable source snapshot; absolute authoring paths never leave the server.
      const {draftFile,...portable}=saved;
      boardRows.push(portable);
    }
    const value={version:1,importedAt:new Date().toISOString(),source:portableSource(manifest.source),rows:boardRows};
    await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'titan-board-v1',$2)",[TITAN,json(value)]);
    return value;
  });
}

export async function getTitanBoard(store) {
  const empty={tenantId:store.tenantId,title:'برد تایتان',rows:[],stats:{contracts:0,scopes:0,pending:0,centers:0,totalCenters:0}};
  if (store.tenantId!==TITAN) return empty;
  const value=await store.getSetting('titan-board-v1',null);
  if (!value) return empty;
  const revisions=await store.getSetting('titan-board-v2',null);
  const contracts=await store.contracts();
  const catalog=await store.catalog();
  const rows=value.rows.map(row=>{
    const revision=revisions?.rows?.find(r=>r.id===row.id);
    const contractId=revision?.contractId||row.contractId;
    const c=contracts.find(c=>c.id===contractId);
    const {body,...summary}=row;
    const serviceCode=revision?.serviceCode||row.serviceCode;
    const service=catalog.services.find(s=>s.code===serviceCode);
    return {...summary,...(revision?{title:revision.title,contractId,contractNumber:revision.contractNumber||row.contractNumber,templateId:revision.templateId||row.templateId,templateTitle:revision.templateTitle||row.templateTitle,products:revision.products||row.products,scope:revision.scope||row.scope,serviceCode,centerId:revision.centerId||row.centerId,centerName:service?.centerName||row.centerName,serviceName:service?.name||row.serviceName,priceSummary:revision.priceSummary,pricingType:revision.pricingType,quotedAmountIRR:revision.quotedAmountIRR,exampleMonthlyIRR:revision.exampleMonthlyIRR,proposalStatus:revision.status,sourceWordSha256:revision.sourceWordSha256,previousContractId:revision.previousContractId}:{}),status:c?.status||'scope_draft',currentStage:c?.stages.find(s=>s.status==='active')?.name||null,draftUrl:c?`/api/contracts/${c.id}/document`:null};
  });
  return {tenantId:TITAN,title:'برد تایتان',source:portableSource(value.source),importedAt:value.importedAt,proposalVersion:revisions?.version||null,rows,stats:{contracts:rows.filter(r=>r.contractId).length,scopes:rows.filter(r=>r.kind==='product-scope').length,pending:rows.filter(r=>r.confirmationFlags?.length).length,centers:new Set(rows.map(r=>r.centerId)).size,totalCenters:catalog.centers.length}};
}
