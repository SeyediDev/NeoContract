import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const TABLES=['tenants','business_units','parties','account_managers','customers','contract_templates','contract_template_versions','template_workflow_stages','catalog_sources','catalog_zones','catalog_centers','catalog_services','sla_tiers','revenue_models','catalog_service_sla','catalog_service_revenue_models','contracts','contract_parties','contract_processes','contract_process_steps','contract_tasks','contract_amendments','contract_documents','contract_events','contract_services','customer_service_subscriptions','app_settings','catalog_imports','integration_jobs','app_users','app_roles','app_user_roles','app_user_audit','pricing_plans','pricing_plan_versions','contract_execution','execution_commands','contract_service_limits','service_limit_commands','service_limit_outbox','contract_parameter_definitions','contract_parameter_definition_history','contract_parameters','contract_parameter_commands','contract_parameter_outbox'];
TABLES.push('api_calls','api_call_hourly','contract_economics','economics_commands','economics_outbox','settlement_proposals','provider_applications','provider_application_commands');
const hash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
export async function backupDatabase(db,path){
 const tables={};
 await db.transaction(async tx=>{await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');for(const table of TABLES)tables[table]=(await tx.query(`SELECT * FROM contracts.${table}`)).rows;});
 const data={format:'neocontract-backup-v1',createdAt:new Date().toISOString(),schemaVersions:(await db.health()).migrations.map(x=>x.version),tables};
 const bundle={...data,checksum:hash(data)};await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(bundle,null,2),'utf8');return {path,checksum:bundle.checksum,rows:Object.values(tables).reduce((a,x)=>a+x.length,0)};
}
export async function restoreDatabase(db,path){
 const data=JSON.parse(await readFile(path,'utf8'));const {checksum,...body}=data;
 if(body.format!=='neocontract-backup-v1'||hash(body)!==checksum)throw Error('Backup format or checksum is invalid.');
 if(Object.keys(body.tables).some(t=>!TABLES.includes(t)))throw Error('Unexpected backup table.');
 const count=(await db.query('SELECT count(*)::int n FROM contracts.tenants')).rows[0].n;if(count)throw Error('Restore requires an empty database; existing data will not be overwritten.');
 await db.transaction(async tx=>{await tx.exec('SET CONSTRAINTS ALL DEFERRED');for(const table of TABLES){const columns=(await tx.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['contracts',table])).rows;const allowed=new Map(columns.map(x=>[x.column_name,x.data_type]));let restoreRows=body.tables[table]||[];if(table==='customers'){const sorted=[],remaining=[...restoreRows],seen=new Set();while(remaining.length){const index=remaining.findIndex(r=>!r.parent_id||seen.has(r.parent_id));if(index<0)throw Error('Customer hierarchy in backup is cyclic or incomplete');const row=remaining.splice(index,1)[0];sorted.push(row);seen.add(row.id);}restoreRows=sorted;}for(const row of restoreRows){const keys=Object.keys(row);if(keys.some(k=>!allowed.has(k)||!/^[a-z_][a-z0-9_]*$/.test(k)))throw Error('Unknown backup column');const values=keys.map(k=>['json','jsonb'].includes(allowed.get(k))?JSON.stringify(row[k]):row[k]);await tx.query(`INSERT INTO contracts.${table}(${keys.map(k=>'"'+k+'"').join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);}}});return db.health();
}
