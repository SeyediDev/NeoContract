import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEMO_TENANT_ID,TITAN_TENANT_ID} from './database.mjs';

export const CUSTOMER_TENANTS=[
  {id:DEMO_TENANT_ID,slug:'entekhab',name:'انتخاب',intakes:['titan-02']},
  {id:'00000000-0000-0000-0000-000000000003',slug:'basalam',name:'باسلام',intakes:['titan-01','titan-05']},
  {id:'00000000-0000-0000-0000-000000000004',slug:'zoodex',name:'زودکس',intakes:['titan-04']},
  {id:'00000000-0000-0000-0000-000000000005',slug:'salam-pay',name:'سلام‌پی',intakes:['titan-03']}
];
const hash=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>{const h=hash(s);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const UUID=/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi;
const TABLES=['business_units','parties','account_managers','customers','contract_templates','contract_template_versions','template_workflow_stages','pricing_plans','pricing_plan_versions','contracts','contract_parties','contract_processes','contract_process_steps','contract_tasks','contract_amendments','contract_documents','contract_events','contract_services'];

/** Correct the original demo model by copying complete aggregates into four isolated tenants.
 * The original legal snapshots and unassigned internal project remain in the archived source.
 * It imports only the four existing demo identities and their existing product roles.
 */
export async function provisionCustomerTenants(db){
 const core=await readFile(new URL('../database/seed.sql',import.meta.url),'utf8');
 const catalog=await readFile(new URL('../database/fanasa-catalog.sql',import.meta.url),'utf8');
 return db.transaction(async tx=>{
  await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[TITAN_TENANT_ID]);
  const previous=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='customer-tenancy-v1'",[TITAN_TENANT_ID])).rows[0];
  if(previous)return previous.value;
  const original=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v1'",[TITAN_TENANT_ID])).rows[0]?.value;
  const revisions=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v2'",[TITAN_TENANT_ID])).rows[0]?.value;
  if(!original||revisions?.rows?.length!==5)throw new Error('Five original proposals are required before tenant separation.');
  const columns=new Map();
  for(const table of TABLES)columns.set(table,(await tx.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',['contracts',table])).rows);
  const source=async(table,condition='',params=[])=>{
   if(!TABLES.includes(table))throw new Error('Unsupported aggregate table');
   return (await tx.query(`SELECT * FROM contracts.${table} WHERE tenant_id=$1 ${condition}`,[TITAN_TENANT_ID,...params])).rows;
  };
  const report=[];
  for(const tenant of CUSTOMER_TENANTS){
   await tx.query("INSERT INTO contracts.tenants(id,slug,name,settings) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",[tenant.id,tenant.slug,tenant.name,JSON.stringify({calendar:'jalali',currency:'IRR',source:'user-confirmed-tenant'})]);
   const actual=(await tx.query('SELECT slug,status FROM contracts.tenants WHERE id=$1 FOR UPDATE',[tenant.id])).rows[0];
   if(actual.slug!==tenant.slug||actual.status!=='active')throw new Error('Customer tenant conflicts with existing operator configuration: '+tenant.slug);
   if(tenant.id===DEMO_TENANT_ID)await tx.query("UPDATE contracts.tenants SET name=$2 WHERE id=$1 AND name='گروه انتخاب'",[tenant.id,tenant.name]);
   const seedId=id=>id===DEMO_TENANT_ID?tenant.id:uuid('customer-tenant-seed:'+tenant.id+':'+id);
   if(tenant.id!==DEMO_TENANT_ID){
    const remap=sql=>sql.replace(UUID,seedId);
    await tx.exec(remap(core.slice(core.indexOf('INSERT INTO contract_templates'),core.lastIndexOf('INSERT INTO app_settings'))));
    await tx.exec(remap(catalog));
   }
   await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'workspace',$2) ON CONFLICT(tenant_id,key) DO UPDATE SET value=contracts.app_settings.value || EXCLUDED.value",[tenant.id,JSON.stringify({workspaceName:tenant.name,organizationName:tenant.name,currency:'IRR',calendar:'jalali'})]);
   const map=new Map([[TITAN_TENANT_ID,tenant.id]]);
   const identify=rows=>{for(const r of rows)if(r.id&&!map.has(r.id))map.set(r.id,uuid('customer-tenant-copy:'+tenant.id+':'+r.id));};
   const replace=s=>s.replace(UUID,id=>map.get(id)||id);
   const deep=(v,key='')=>{
    if(['body','document','body_template','migratedFrom'].includes(key))return v;
    if(typeof v==='string')return replace(v);
    if(Array.isArray(v))return v.map(x=>deep(x));
    if(v&&typeof v==='object'&&!(v instanceof Date))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,deep(x,k)]));
    return v;
   };
   const copy=async(table,rows)=>{
    for(const row of rows){const fields=columns.get(table);const keys=fields.map(c=>c.column_name);
     const values=fields.map(c=>{const value=deep(row[c.column_name],c.column_name);return ['json','jsonb'].includes(c.data_type)?JSON.stringify(value):value;});
     await tx.query(`INSERT INTO contracts.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);
    }
   };
   const selection=revisions.rows.filter(r=>tenant.intakes.includes(r.id));
   const contractIds=selection.map(r=>r.contractId);
   const contracts=await source('contracts','AND id=ANY($2::uuid[]) FOR UPDATE',[contractIds]);
   if(contracts.length!==selection.length)throw new Error('Missing customer proposal aggregate');
   const versions=await source('contract_template_versions','AND id=ANY($2::uuid[])',[contracts.map(c=>c.template_version_id)]);
   const templates=await source('contract_templates','AND id=ANY($2::uuid[])',[versions.map(v=>v.template_id)]);
   const allVersions=await source('contract_template_versions','AND template_id=ANY($2::uuid[])',[templates.map(t=>t.id)]);
   const templateStages=await source('template_workflow_stages','AND template_version_id=ANY($2::uuid[])',[allVersions.map(v=>v.id)]);
   const processes=await source('contract_processes','AND contract_id=ANY($2::uuid[])',[contractIds]);
   const steps=await source('contract_process_steps','AND process_id=ANY($2::uuid[])',[processes.map(p=>p.id)]);
   const customers=await source('customers','AND id=ANY($2::uuid[])',[contracts.map(c=>c.customer_id).filter(Boolean)]);
   if(!customers.length)await tx.query("INSERT INTO contracts.customers(tenant_id,customer_code,legal_name,verification_status,metadata) VALUES($1,'TENANT-PARTY',$2,'manual-unverified',$3) ON CONFLICT(tenant_id,customer_code) DO NOTHING",[tenant.id,tenant.name,JSON.stringify({source:'user-confirmed-tenant',legalIdentityPending:true})]);
   if(customers.some(c=>c.parent_id))throw new Error('A source customer hierarchy requires an explicit ownership mapping.');
   const parties=await source('parties','AND id=ANY($2::uuid[])',[customers.map(c=>c.party_id).filter(Boolean)]);
   const managers=await source('account_managers','AND id=ANY($2::uuid[])',[[...contracts.map(c=>c.account_manager_id),...customers.map(c=>c.account_manager_id)].filter(Boolean)]);
   const units=await source('business_units','AND id=ANY($2::uuid[])',[contracts.map(c=>c.owning_unit_id).filter(Boolean)]);
   const plans=await source('pricing_plans','AND id=ANY($2::uuid[])',[contracts.map(c=>c.metadata.dynamicPricingPlanId).filter(Boolean)]);
   const planVersions=await source('pricing_plan_versions','AND plan_id=ANY($2::uuid[])',[plans.map(p=>p.id)]);
   const linked={};for(const table of ['contract_parties','contract_tasks','contract_amendments','contract_documents','contract_events','contract_services'])linked[table]=await source(table,'AND contract_id=ANY($2::uuid[])',[contractIds]);
   if(linked.contract_parties.some(p=>!parties.some(x=>x.id===p.party_id)))throw new Error('A separate signatory party requires an explicit mapping.');
   for(const rows of [contracts,templates,allVersions,templateStages,processes,steps,customers,parties,managers,units,plans,...Object.values(linked)])identify(rows);
   const originalServices=(await tx.query('SELECT id,service_code FROM contracts.catalog_services WHERE tenant_id=$1',[TITAN_TENANT_ID])).rows;
   const targetServices=(await tx.query('SELECT id,service_code FROM contracts.catalog_services WHERE tenant_id=$1',[tenant.id])).rows;
   for(const s of originalServices){const target=targetServices.find(t=>t.service_code===s.service_code);if(target)map.set(s.id,target.id);}
   if(linked.contract_services.some(s=>s.service_id&&!map.has(s.service_id)))throw new Error('A source service has no matching customer catalog entry.');
   await copy('business_units',units);await copy('parties',parties);await copy('account_managers',managers);await copy('customers',customers);
   await copy('contract_templates',templates);await copy('contract_template_versions',allVersions);await copy('template_workflow_stages',templateStages);
   await copy('pricing_plans',plans);await copy('pricing_plan_versions',planVersions);
   for(const c of contracts){c.metadata={...c.metadata,migratedFrom:{tenantId:TITAN_TENANT_ID,contractId:c.id},productName:'تایتان'};c.neo_binding={};}
   await copy('contracts',contracts);await copy('contract_processes',processes);await copy('contract_process_steps',steps);
   for(const [table,rows] of Object.entries(linked))await copy(table,rows);
   const rows=original.rows.filter(r=>tenant.intakes.includes(r.id)||(tenant.slug==='entekhab'&&r.kind==='product-scope'));
   const corrected=deep({version:1,source:original.source,importedAt:original.importedAt,rows});
   corrected.rows=corrected.rows.map(r=>({...r,products:(r.products||[]).map(p=>p==='نایتان'?'تایتان':p),canonicalProductName:'تایتان'}));
   await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'contract-intake-v1',$2)",[tenant.id,JSON.stringify(corrected)]);
   const scopedRevisions=deep({...revisions,rows:selection});
   scopedRevisions.rows=scopedRevisions.rows.map(r=>({...r,products:(r.products||[]).map(p=>p==='نایتان'?'تایتان':p)}));
   await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'contract-proposals-v2',$2)",[tenant.id,JSON.stringify(scopedRevisions)]);
   await tx.query("INSERT INTO contracts.app_roles(tenant_id,role_key,label,description) SELECT $1,role_key,label,description FROM contracts.app_roles WHERE tenant_id=$2 AND role_key IN ('contract_admin','viewer','legal_reviewer','finance_reviewer','account_manager') ON CONFLICT(tenant_id,role_key) DO NOTHING",[tenant.id,TITAN_TENANT_ID]);
   const demos=(await tx.query("SELECT * FROM contracts.app_users WHERE tenant_id=$1 AND metadata->>'demo'='true' AND lower(email)=ANY($2::text[]) ORDER BY id",[TITAN_TENANT_ID,['demo.admin@fanasa.example','demo.viewer@fanasa.example','demo.legal@fanasa.example','demo.finance@fanasa.example']])).rows;
   for(const user of demos){
    const memberId=uuid('customer-member:'+tenant.id+':'+user.id);
    await tx.query('INSERT INTO contracts.app_users(id,tenant_id,subject,email,display_name,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[memberId,tenant.id,user.subject,user.email,user.display_name,user.status,JSON.stringify({demo:true,ssoProvider:'fanasa',migratedFromUserId:user.id})]);
    const roles=(await tx.query("SELECT r.role_key,r.label,r.description FROM contracts.app_roles r JOIN contracts.app_user_roles ur ON ur.tenant_id=r.tenant_id AND ur.role_id=r.id WHERE ur.tenant_id=$1 AND ur.user_id=$2 AND r.role_key IN ('contract_admin','viewer','legal_reviewer','finance_reviewer','account_manager')",[TITAN_TENANT_ID,user.id])).rows;
    for(const r of roles){
     await tx.query('INSERT INTO contracts.app_roles(tenant_id,role_key,label,description) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,role_key) DO NOTHING',[tenant.id,r.role_key,r.label,r.description]);
     await tx.query('INSERT INTO contracts.app_user_roles(tenant_id,user_id,role_id) SELECT $1,$2,id FROM contracts.app_roles WHERE tenant_id=$1 AND role_key=$3',[tenant.id,memberId,r.role_key]);
    }
   }
   report.push({tenantId:tenant.id,name:tenant.name,slug:tenant.slug,contracts:contracts.length,models:plans.length,sourceContractIds:contractIds,contractIds:contractIds.map(id=>map.get(id))});
  }
  await tx.query("UPDATE contracts.tenants SET status='archived',settings=settings || $2::jsonb WHERE id=$1",[TITAN_TENANT_ID,JSON.stringify({purpose:'legacy-demo-archive',productName:'تایتان',replacedByTenants:CUSTOMER_TENANTS.map(t=>t.id)})]);
  const value={version:1,productName:'تایتان',createdAt:new Date().toISOString(),tenants:report,unassignedInternalProject:'titan-06'};
  await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'customer-tenancy-v1',$2)",[TITAN_TENANT_ID,JSON.stringify(value)]);
  return value;
 });
}
