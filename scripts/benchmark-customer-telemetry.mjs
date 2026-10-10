// Synthetic operational data in an explicitly named EMPTY PostgreSQL scratch DB only.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createDatabase,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createCustomerTelemetryStore} from '../lib/customer-telemetry.mjs';
const connectionString=process.env.NEOCONTRACT_TELEMETRY_BENCHMARK_URL;
if(!connectionString)throw Error('NEOCONTRACT_TELEMETRY_BENCHMARK_URL is required');
assert.match(decodeURIComponent(new URL(connectionString).pathname.slice(1)),/^neocontract_telemetry_benchmark_\d+$/);
const probe=new Client({connectionString});await probe.connect();try{assert.equal(Number((await probe.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n),0);}finally{await probe.end();}
const db=await createDatabase({connectionString});
try{
 const to=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString(),from=new Date(Date.parse(to)-86400000).toISOString();
 await db.query(`INSERT INTO contracts.api_calls(tenant_id,event_id,producer_id,event_hash,occurred_at,service_key,request_id,method,path,status_code,duration_ms,request_bytes,response_bytes,request_body,response_body,search_document)
  SELECT $1,'perf-'||i,'synthetic-benchmark','fixture-only',$2::timestamptz-interval '1 second'-(i%86400)*interval '1 second','perf-api','req-'||i,'POST','/fixture',CASE WHEN i%20=0 THEN 503 ELSE 200 END,10+(i%1000),100,200,jsonb_build_object('query',CASE WHEN i%1000=0 THEN 'needle' ELSE 'normal' END),'{"result":"ok"}'::jsonb,to_tsvector('simple',CASE WHEN i%1000=0 THEN 'needle' ELSE 'normal' END) FROM generate_series(1,100000) i`,[DEMO_TENANT_ID,to]);
 await db.query(`INSERT INTO contracts.api_call_hourly(tenant_id,hour,service_key,status_code,latency_bucket,calls,duration_sum,request_bytes,response_bytes) SELECT tenant_id,date_trunc('hour',occurred_at),service_key,status_code,CASE WHEN duration_ms<=10 THEN 10 WHEN duration_ms<=25 THEN 25 WHEN duration_ms<=50 THEN 50 WHEN duration_ms<=100 THEN 100 WHEN duration_ms<=250 THEN 250 WHEN duration_ms<=500 THEN 500 WHEN duration_ms<=1000 THEN 1000 ELSE 2500 END,count(*),sum(duration_ms),sum(request_bytes),sum(response_bytes) FROM contracts.api_calls GROUP BY 1,2,3,4,5`);
 await db.exec('ANALYZE contracts.api_calls; ANALYZE contracts.api_call_hourly;');
 const store=createCustomerTelemetryStore(db,DEMO_TENANT_ID),filters={from,to,service:'perf-api'},times={};
 let start=performance.now();const report=await store.report(filters);times.reportMs=Math.round(performance.now()-start);assert.equal(report.total,100000);assert.equal(report.errorRate,.05);
 start=performance.now();const page=await store.search({...filters,q:'needle'});times.searchMs=Math.round(performance.now()-start);assert.equal(page.rows.length,50);assert.ok(page.nextCursor);
 start=performance.now();const next=await store.search({...filters,q:'needle',cursor:page.nextCursor});times.nextPageMs=Math.round(performance.now()-start);assert.equal(next.rows.length,50);assert.equal(next.nextCursor,null);
 const plan=(await db.query("EXPLAIN (FORMAT JSON) SELECT event_id FROM contracts.api_calls WHERE tenant_id=$1 AND search_document @@ websearch_to_tsquery('simple','needle')",[DEMO_TENANT_ID])).rows[0]['QUERY PLAN'];assert.match(JSON.stringify(plan),/api_calls_content/);
 console.log(JSON.stringify({postgresqlBenchmark:'PASS',syntheticRows:100000,...times,contentIndexUsed:true,scope:'one synthetic service, single sequential client, no production load guarantee'}));
}finally{await db.close();}
