// Runs the same signed/amendment/outbox invariants against an empty scratch PostgreSQL.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const connectionString=process.env.NEOCONTRACT_SERVICE_LIMIT_ACCEPTANCE_URL;
if(!connectionString)throw Error('NEOCONTRACT_SERVICE_LIMIT_ACCEPTANCE_URL is required.');
assert.match(decodeURIComponent(new URL(connectionString).pathname.slice(1)),/^neocontract_capacity_acceptance_\d+$/,'Only a named capacity acceptance database is permitted.');
const probe=new Client({connectionString});await probe.connect();
try{assert.equal(Number((await probe.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n),0,'Acceptance DB must be empty.');}finally{await probe.end();}
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/service-limits.test.mjs'],{cwd:new URL('..',import.meta.url),env:process.env,stdio:'inherit',timeout:240000});
if(result.error||result.status!==0)throw Error('Scratch capacity acceptance failed.');
console.log(JSON.stringify({postgresqlAcceptance:'PASS',migrations:12,signedAmendments:true,transactionalOutbox:true,immutableHistory:true,idempotency:true,frozenDispatch:true,centralAcceptanceDistinct:true,supersededNotRetried:true,observedGatewayReceipt:true,liveGateway:false}));
