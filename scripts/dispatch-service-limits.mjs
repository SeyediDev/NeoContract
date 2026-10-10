// Operator entry point. No new worker/service or automatic gateway credential use.
import {readFile} from 'node:fs/promises';
import {createDatabase} from '../lib/database.mjs';
import {dispatchServiceLimits} from '../lib/service-limit-dispatch.mjs';
const config=process.env.NEOCONTRACT_SERVICE_LIMIT_BINDINGS_FILE;
if(!process.argv.includes('--apply'))throw Error('Explicit --apply is required; review central bindings and permissions first.');
if(process.env.NEOCONTRACT_SERVICE_LIMIT_LIFECYCLE_READY!=='true')throw Error('Dispatch is disabled until central pause/resume/close, expiry and invalidation handling are accepted. Set NEOCONTRACT_SERVICE_LIMIT_LIFECYCLE_READY=true only after that acceptance.');
if(!config||!process.env.NEOCONTRACT_SERVICE_LIMIT_ENDPOINT||!process.env.NEOCONTRACT_SERVICE_LIMIT_TOKEN||!process.env.NEOCONTRACT_DATABASE_URL)throw Error('Database URL, central endpoint, limited service token and approved bindings file are required.');
const bindings=JSON.parse(await readFile(config,'utf8'));if(!Array.isArray(bindings))throw Error('Central bindings must be an array.');
const db=await createDatabase({connectionString:process.env.NEOCONTRACT_DATABASE_URL,seed:false,migrate:false});
try{
 const result=await dispatchServiceLimits(db,{endpoint:process.env.NEOCONTRACT_SERVICE_LIMIT_ENDPOINT,token:process.env.NEOCONTRACT_SERVICE_LIMIT_TOKEN,bindingForEvent:event=>bindings.find(b=>b.localTenantId===event.localTenantId&&b.contractId===event.contractId&&b.serviceKey===event.terms.serviceKey)});
 console.log(JSON.stringify(result));
}finally{await db.close();}
