import {createDatabase} from '../lib/database.mjs';
import {createCustomerTelemetryStore} from '../lib/customer-telemetry.mjs';
const [command,...options]=process.argv.slice(2);
if(command!=='prune')throw Error('Usage: node scripts/customer-telemetry.mjs prune [--apply]');
const days=Number(process.env.NEOCONTRACT_TELEMETRY_RETENTION_DAYS||30);
if(!Number.isSafeInteger(days)||days<1||days>90)throw Error('Retention must be 1–90 days');
const db=await createDatabase({dataDir:process.env.NEOCONTRACT_DATA_DIR,connectionString:process.env.NEOCONTRACT_DATABASE_URL});
try{
 const cutoff=new Date(Date.now()-days*86400000).toISOString(),tenants=(await db.query('SELECT id FROM contracts.tenants')).rows;const results=[];
 for(const tenant of tenants){const candidates=Number((await db.query('SELECT count(*) AS n FROM contracts.api_calls WHERE tenant_id=$1 AND occurred_at<$2',[tenant.id,cutoff])).rows[0].n);results.push({tenantId:tenant.id,candidates,...(options.includes('--apply')?await createCustomerTelemetryStore(db,tenant.id,{retentionDays:days}).prune():{})});}
 console.log(JSON.stringify({apply:options.includes('--apply'),retentionDays:days,results}));
}finally{await db.close();}
