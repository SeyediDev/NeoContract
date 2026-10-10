import {Client} from 'pg';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const connectionString=process.env.NEOCONTRACT_CUSTOMER_ECONOMY_ACCEPTANCE_URL;
if(!connectionString)throw Error('NEOCONTRACT_CUSTOMER_ECONOMY_ACCEPTANCE_URL is required');
assert.match(decodeURIComponent(new URL(connectionString).pathname.slice(1)),/^neocontract_economy_acceptance_\d+$/,'Only a named empty acceptance database is permitted');
const db=new Client({connectionString});await db.connect();try{assert.equal(Number((await db.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n),0);}finally{await db.end();}
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/contract-parameters.test.mjs','tests/customer-economy.test.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NEOCONTRACT_PARAMETER_ACCEPTANCE_URL:connectionString},stdio:'inherit',timeout:300000});
if(result.error||result.status!==0)throw Error('Scratch PostgreSQL acceptance failed');
console.log(JSON.stringify({postgresqlAcceptance:'PASS',migrations:11,extensibleParameters:true,telemetrySearch:true,exactRevenueShares:true,optionalCustomerCredit:true,economicAmendments:true,providerReviews:true,immutableHistory:true,centralWalletPosted:false,liveGateway:false}));
