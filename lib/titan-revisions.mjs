import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {TITAN_STAGES} from './titan-board.mjs';

const TENANT='00000000-0000-0000-0000-000000000002';
const manifestUrl=new URL('../planning/titan-revisions-v2.json',import.meta.url);
const json=JSON.stringify;
const hash=value=>createHash('sha256').update(value).digest('hex');
const stableId=key=>{const h=hash(`neocontract:titan-revision:v2:${key}`);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};

/** Add reviewed proposal versions without rewriting the original intake snapshots. */
export async function provisionTitanRevisions(db){
 const manifest=JSON.parse(await readFile(manifestUrl,'utf8'));
 if(manifest.version!==2||manifest.rows.length!==5||new Set(manifest.rows.map(r=>r.id)).size!==5)throw new Error('Invalid Titan proposal revision manifest.');
 return db.transaction(async tx=>{
  await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[TENANT]);
  const previous=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v2'",[TENANT])).rows[0];
  if(previous)return previous.value;
  const base=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v1'",[TENANT])).rows[0]?.value;
  if(!base)throw new Error('Titan base board must be provisioned first.');
  const summaries=[];
  for(const revision of manifest.rows){
   const original=base.rows.find(r=>r.id===revision.id);
   if(!original?.contractId||!revision.document||revision.document.length<3000)throw new Error(`Incomplete Titan revision: ${revision.id}`);
   const originalRow=(await tx.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[TENANT,original.contractId])).rows[0];
   if(!originalRow)throw new Error(`Missing Titan original contract: ${revision.id}`);
   const metadata={revisionNumber:2,status:revision.status,title:revision.title,priceSummary:revision.priceSummary,pricingType:revision.pricingType,quotedAmountIRR:revision.quotedAmountIRR,exampleMonthlyIRR:revision.exampleMonthlyIRR,serviceCode:revision.serviceCode||original.serviceCode,centerId:revision.centerId||original.centerId,sourceWordSha256:revision.sourceWordSha256,sourceWordName:revision.sourceWordName,sourceNote:revision.sourceNote,body:revision.document};
   let contractId=original.contractId;
   if(revision.id==='titan-04'){
    const service=(await tx.query('SELECT s.*,c.center_key,c.name center_name FROM contracts.catalog_services s JOIN contracts.catalog_centers c ON c.tenant_id=s.tenant_id AND c.id=s.center_id WHERE s.tenant_id=$1 AND s.service_code=$2',[TENANT,'FCL-01'])).rows[0];
    if(!service||service.center_key!=='fanasa-cloud')throw new Error('FCL-01 public cloud catalog mapping is missing.');
    const templateId=stableId('template:titan-04-public'),versionId=stableId('version:titan-04-public'),processId=stableId('process:titan-04-public');
    contractId=stableId('contract:titan-04-public');
    const number='TITAN-DRAFT-04-V2';
    const template={id:templateId,templateVersionId:versionId,version:1,title:revision.title,category:'قراردادهای تایتان',description:'ارائه ابر عمومی با صورتحساب بر پایه مصرف',status:'published',body:revision.document,stages:TITAN_STAGES,serviceCodes:['FCL-01'],revenueModels:['usage']};
    const serviceSnapshot={code:'FCL-01',name:service.name,centerId:'fanasa-cloud',centerName:service.center_name,model:'usage',revenueModel:'usage',quantity:null,unitPrice:null,currency:'IRR',delivery:null,slaTier:null,sla:null,sourceStatus:service.verification_status,mappingStatus:'proposed',sourceSnapshot:{code:'FCL-01',name:service.name},proposalPriceSummary:revision.priceSummary};
    const terms={title:revision.title,party:original.sourceCustomer,amount:null,currency:'IRR',start:null,end:null,unit:'مصرف ماهانه',owner:'جواد',paymentTerms:'نرخ واحد پیشنهادی؛ صورتحساب بر پایه مصرف مصوب'};
    const intake={intakeId:revision.id,source:'titan-board-v2',confirmationFlags:original.confirmationFlags||[],publicationMeaning:'technical-template-availability-only',supersedesContractId:original.contractId,proposalPricing:metadata};
    delete intake.proposalPricing.body;
    const snapshot={number,template,customer:null,manager:null,services:[serviceSnapshot],stages:TITAN_STAGES,terms,createdAt:new Date().toISOString(),document:revision.document,sourceStatus:'manual-unverified',intake};
    await tx.query("INSERT INTO contracts.contract_templates(id,tenant_id,code,name,category,description,status,metadata) VALUES($1,$2,'TITAN-04-PUBLIC',$3,$4,$5,'active',$6)",[templateId,TENANT,revision.title,template.category,template.description,json({intakeId:revision.id,revisionNumber:2})]);
    await tx.query("INSERT INTO contracts.contract_template_versions(id,tenant_id,template_id,version_no,body_template,variable_schema,process_config,status,published_at) VALUES($1,$2,$3,1,$4,$5,$6,'published',now())",[versionId,TENANT,templateId,revision.document,json({templateMetadata:{title:template.title,category:template.category,description:template.description,serviceCodes:['FCL-01'],revenueModels:['usage']}}),json({stages:TITAN_STAGES})]);
    await tx.query('UPDATE contracts.contract_templates SET current_version_id=$3 WHERE tenant_id=$1 AND id=$2',[TENANT,templateId,versionId]);
    for(const [i,s] of TITAN_STAGES.entries())await tx.query('INSERT INTO contracts.template_workflow_stages(tenant_id,template_version_id,stage_key,name,sequence_no,required,role_key,sla_days,metadata) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)',[TENANT,versionId,s.id,s.name,i+1,s.role,s.slaDays,json({enabled:true})]);
    await tx.query("INSERT INTO contracts.contracts(id,tenant_id,contract_no,title,contract_type,status,template_version_id,customer_id,template_snapshot,variables,metadata) VALUES($1,$2,$3,$4,$5,'in_process',$6,NULL,$7,$8,$9)",[contractId,TENANT,number,revision.title,template.category,versionId,json(snapshot),json(terms),json({intakeId:revision.id,revisionNumber:2,source:'titan-board-v2',supersedesContractId:original.contractId,confirmationFlags:original.confirmationFlags||[]})]);
    await tx.query("INSERT INTO contracts.contract_processes(id,tenant_id,contract_id,template_version_id,status,started_at,process_snapshot) VALUES($1,$2,$3,$4,'running',now(),$5)",[processId,TENANT,contractId,versionId,json({stages:TITAN_STAGES})]);
    for(const [i,s] of TITAN_STAGES.entries())await tx.query("INSERT INTO contracts.contract_process_steps(tenant_id,process_id,step_key,name,sequence_no,status,required,is_custom,role_key,sla_days,metadata,started_at) VALUES($1,$2,$3,$4,$5,$6,true,true,$7,$8,$9,CASE WHEN $5=1 THEN now() ELSE NULL END)",[TENANT,processId,s.id,s.name,i+1,i===0?'active':'pending',s.role,s.slaDays,json({enabled:true})]);
    await tx.query('INSERT INTO contracts.contract_services(tenant_id,contract_id,service_id,service_code,service_name_snapshot,pricing_model_snapshot,service_snapshot,source_verification_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[TENANT,contractId,service.id,'FCL-01',service.name,'usage',json(serviceSnapshot),service.verification_status,json({mappingStatus:'proposed',revisionNumber:2})]);
    await tx.query('INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,byte_size,sha256,version_no,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,$9)',[TENANT,contractId,'snapshot',`${number}.md`,`database:${contractId}`,'text/markdown; charset=utf-8',Buffer.byteLength(revision.document),hash(revision.document),json({body:revision.document,sourceWordSha256:revision.sourceWordSha256})]);
    await tx.query("INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,from_status,to_status,actor_label,payload) VALUES($1,$2,'titan_proposal_started',NULL,'in_process','بازنگری تایتان',$3)",[TENANT,contractId,json({intakeId:revision.id,message:'پیشنهاد قرارداد ابر عمومی با نرخ واحد و مصرف واقعی؛ نیازمند تأیید شرایط.'})]);
    const active=(await tx.query("SELECT s.step_key FROM contracts.contract_process_steps s JOIN contracts.contract_processes p ON p.tenant_id=s.tenant_id AND p.id=s.process_id WHERE p.tenant_id=$1 AND p.contract_id=$2 AND s.status='active'",[TENANT,original.contractId])).rows[0]?.step_key;
    if(originalRow.status==='in_process'&&active==='scope'){
     await tx.query("UPDATE contracts.contracts SET status='cancelled',updated_at=now(),metadata=metadata || $3::jsonb WHERE tenant_id=$1 AND id=$2",[TENANT,original.contractId,json({supersededByContractId:contractId})]);
     await tx.query("UPDATE contracts.contract_processes SET status='cancelled',updated_at=now() WHERE tenant_id=$1 AND contract_id=$2",[TENANT,original.contractId]);
     await tx.query("INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,from_status,to_status,actor_label,payload) VALUES($1,$2,'titan_draft_superseded','in_process','cancelled','بازنگری تایتان',$3)",[TENANT,original.contractId,json({newContractId:contractId,message:'پیش‌نویس اولیه با پیشنهاد ابر عمومی جایگزین شد.'})]);
    }
   }else{
    await tx.query('INSERT INTO contracts.contract_documents(id,tenant_id,contract_id,document_type,file_name,storage_key,mime_type,byte_size,sha256,version_no,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,2,$10)',[stableId(`document:${revision.id}`),TENANT,contractId,'proposal_revision',`${revision.id}-v2.md`,`database:${contractId}:revision:2`,'text/markdown; charset=utf-8',Buffer.byteLength(revision.document),hash(revision.document),json(metadata)]);
    await tx.query("INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,actor_label,payload) VALUES($1,$2,'proposal_revision_added','بازنگری تایتان',$3)",[TENANT,contractId,json({revisionNumber:2,title:revision.title,message:'نسخه قیمت‌گذاری‌شده برای مذاکره ثبت شد؛ سند اولیه محفوظ است.'})]);
   }
   const {document,...summary}=revision;
   summaries.push({...summary,contractId,previousContractId:contractId===original.contractId?null:original.contractId,...(revision.id==='titan-04'?{contractNumber:'TITAN-DRAFT-04-V2',templateId:stableId('template:titan-04-public'),templateTitle:revision.title,products:['ابر عمومی'],scope:'خدمات ابر عمومی برای زودکس با تعرفه واحد و صورتحساب بر پایه مصرف واقعی.'}:{})});
  }
  const value={version:2,createdAt:manifest.createdAt,rows:summaries};
  await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'titan-board-v2',$2)",[TENANT,json(value)]);
  return value;
 });
}
