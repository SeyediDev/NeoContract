import {createHash,timingSafeEqual} from 'node:crypto';
import {requireValue,text} from './domain.mjs';
import {serviceLimitHash} from './service-limits.mjs';
const check=(v,m,s=400)=>requireValue(v,m,s);
const iso=v=>{check(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'زمان UTC معتبر لازم است.');return v;};
const buckets=[10,25,50,100,250,500,1000,2500,5000,10000,60000,3600000];
const sensitive=/password|passwd|secret|token|authorization|cookie|credential|api.?key|national.?id|card.?number|iban|email|phone|address|کلمه.?عبور|رمز|کد.?ملی|شماره.?کارت|تلفن/i;
export function redactTelemetry(value,depth=0){
 check(depth<=12,'محتوای فراخوانی بیش از حد تو در تو است.');
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return value.replace(/\bBearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[REDACTED]');
 if(Array.isArray(value)){check(value.length<=1000,'فهرست محتوای فراخوانی بزرگ است.');return value.map(v=>redactTelemetry(v,depth+1));}
 check(value&&typeof value==='object','محتوای JSON معتبر لازم است.');check(Object.keys(value).length<=1000,'شیء محتوای فراخوانی بزرگ است.');
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redactTelemetry(v,depth+1)]));
}
export function validateCall(v,{now=Date.now(),retentionDays=30}={}){
 check(v&&typeof v==='object'&&!Array.isArray(v),'فراخوانی معتبر لازم است.');
 const eventId=text(v.eventId,'شناسه رویداد',{max:120}),requestId=text(v.requestId,'شناسه درخواست',{max:120}),serviceKey=text(v.serviceKey,'کلید سرویس',{max:120}),occurredAt=iso(v.occurredAt);check(/^[A-Za-z0-9._:-]+$/.test(eventId),'شناسه رویداد باید برای URL معتبر باشد.');
 check(Date.parse(occurredAt)<=now+60000&&Date.parse(occurredAt)>=now-retentionDays*86400000,'زمان فراخوانی خارج از بازه نگه‌داری است.');
 check(typeof v.method==='string'&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(v.method),'روش HTTP معتبر نیست.');
 check(typeof v.path==='string'&&/^\/[\x21-\x7e]*$/.test(v.path)&&v.path.length<=2000&&!/[?#]/.test(v.path),'مسیر باید بدون query، fragment و اطلاعات حساس باشد.');
 check(Number.isSafeInteger(v.statusCode)&&v.statusCode>=100&&v.statusCode<=599,'status code معتبر نیست.');
 check(typeof v.durationMs==='number'&&Number.isFinite(v.durationMs)&&v.durationMs>=0&&v.durationMs<=3600000,'زمان پاسخ معتبر نیست.');
 for(const k of ['requestBytes','responseBytes'])check(Number.isSafeInteger(v[k])&&v[k]>=0,'حجم فراخوانی معتبر نیست.');
 const bodies=Object.fromEntries(['requestBody','responseBody'].map(k=>[k,redactTelemetry(v[k]??null)]));for(const body of Object.values(bodies))check(Buffer.byteLength(JSON.stringify(body))<=65536,'محتوای پاک‌سازی‌شده باید حداکثر ۶۴ KiB باشد.');
 return {eventId,requestId,serviceKey,occurredAt,method:v.method,path:v.path,statusCode:v.statusCode,durationMs:v.durationMs,requestBytes:v.requestBytes,responseBytes:v.responseBytes,...bodies};
}
export function telemetryProducerFromEnv(env=process.env){
 if(env.NEOCONTRACT_TELEMETRY_ENABLED!=='true')return null;
 let bindings;try{bindings=JSON.parse(env.NEOCONTRACT_TELEMETRY_PRODUCERS||'[]');}catch{throw Error('Invalid telemetry producer configuration');}
 check(Array.isArray(bindings)&&bindings.length>0,'Telemetry producer bindings are required');
 const ids=new Set(),tokens=new Set();const list=bindings.map(b=>{check(typeof b.id==='string'&&b.id.length>0&&b.id.length<=120&&!ids.has(b.id)&&typeof b.token==='string'&&b.token.length>=32&&!tokens.has(b.token)&&Array.isArray(b.tenantIds)&&b.tenantIds.length>0&&b.tenantIds.every(t=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(t)),'Invalid telemetry producer binding');ids.add(b.id);tokens.add(b.token);return {...b,hash:createHash('sha256').update(b.token).digest()};});
 const days=Number(env.NEOCONTRACT_TELEMETRY_RETENTION_DAYS||30);check(Number.isSafeInteger(days)&&days>=1&&days<=90,'Telemetry retention must be 1–90 days');
 return {retentionDays:days,authenticate(headers){const token=/^Bearer ([^\s]+)$/.exec(headers.authorization||'')?.[1];check(token,'احراز هویت منبع پایش لازم است.',401);const hash=createHash('sha256').update(token).digest(),b=list.find(b=>timingSafeEqual(b.hash,hash));check(b,'منبع پایش مجاز نیست.',401);const tenantId=headers['x-tenant-id'];check(b.tenantIds.includes(tenantId),'منبع پایش به این تننت دسترسی ندارد.',403);return {producerId:b.id,tenantId};}};
}
export function createCustomerTelemetryStore(db,tenantId,{retentionDays=30}={}){
 async function ingest(producerId,events){check(Array.isArray(events)&&events.length>0&&events.length<=100,'بین یک تا ۱۰۰ فراخوانی لازم است.');const calls=events.map(v=>validateCall(v,{retentionDays}));const receipts=[];
  await db.transaction(async tx=>{check((await tx.query("SELECT id FROM contracts.tenants WHERE id=$1 AND status='active' FOR UPDATE",[tenantId])).rows[0],'تننت فعال پایش یافت نشد.',404);for(const c of calls){const hash=serviceLimitHash({producerId,...c}),old=(await tx.query('SELECT event_hash FROM contracts.api_calls WHERE tenant_id=$1 AND event_id=$2',[tenantId,c.eventId])).rows[0];if(old){check(old.event_hash===hash,'شناسه پایش با محتوای دیگری استفاده شده است.',409);receipts.push({eventId:c.eventId,duplicate:true});continue;}
   const search=JSON.stringify(c.requestBody)+' '+JSON.stringify(c.responseBody)+' '+c.requestId+' '+c.path;
   await tx.query("INSERT INTO contracts.api_calls(tenant_id,event_id,producer_id,event_hash,occurred_at,service_key,request_id,method,path,status_code,duration_ms,request_bytes,response_bytes,request_body,response_body,search_document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,to_tsvector('simple',$16))",[tenantId,c.eventId,producerId,hash,c.occurredAt,c.serviceKey,c.requestId,c.method,c.path,c.statusCode,c.durationMs,c.requestBytes,c.responseBytes,JSON.stringify(c.requestBody),JSON.stringify(c.responseBody),search]);
   const bucket=buckets.find(n=>c.durationMs<=n);await tx.query("INSERT INTO contracts.api_call_hourly(tenant_id,hour,service_key,status_code,latency_bucket,calls,duration_sum,request_bytes,response_bytes) VALUES($1,date_trunc('hour',$2::timestamptz),$3,$4,$5,1,$6,$7,$8) ON CONFLICT(tenant_id,hour,service_key,status_code,latency_bucket) DO UPDATE SET calls=api_call_hourly.calls+1,duration_sum=api_call_hourly.duration_sum+excluded.duration_sum,request_bytes=api_call_hourly.request_bytes+excluded.request_bytes,response_bytes=api_call_hourly.response_bytes+excluded.response_bytes",[tenantId,c.occurredAt,c.serviceKey,c.statusCode,bucket,c.durationMs,c.requestBytes,c.responseBytes]);receipts.push({eventId:c.eventId,duplicate:false});}
  });return {receipts,financialUsage:false};
 }
 function filters(input={}){const to=iso(input.to||new Date().toISOString()),from=iso(input.from||new Date(Date.parse(to)-86400000).toISOString());check(from<to&&Date.parse(to)-Date.parse(from)<=31*86400000,'بازه گزارش باید حداکثر ۳۱ روز باشد.');const status=input.status?Number(input.status):null;check(status===null||Number.isSafeInteger(status)&&status>=100&&status<=599,'status code معتبر نیست.');const service=input.service?text(input.service,'سرویس',{max:120}):null,q=input.q?text(input.q,'جست‌وجو',{max:200}):null;return {from,to,status,service,q};}
 function queryParts(f){const args=[tenantId,f.from,f.to],conditions=['tenant_id=$1','occurred_at >= $2','occurred_at < $3'];for(const [column,value] of [['status_code',f.status],['service_key',f.service]])if(value!==null){args.push(value);conditions.push(`${column}=$${args.length}`);}if(f.q){args.push(f.q);conditions.push(`search_document @@ websearch_to_tsquery('simple',$${args.length})`);}return {args,conditions};}
 async function search(input={}){const f=filters(input),{args,conditions}=queryParts(f),limit=Number(input.limit||50);check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'تعداد سطر باید یک تا ۱۰۰ باشد.');if(input.cursor){check(typeof input.cursor==='string'&&input.cursor.length<=1000,'نشان صفحه معتبر نیست.');let c;try{c=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{check(false,'نشان صفحه معتبر نیست.');}check(c&&c.filterHash===serviceLimitHash(f)&&typeof c.eventId==='string'&&c.eventId.length<=120,'نشان صفحه مربوط به این جست‌وجو نیست.');iso(c.at);args.push(c.at,c.eventId);conditions.push(`(occurred_at,event_id)<($${args.length-1}::timestamptz,$${args.length}::text)`);}
  args.push(limit+1);const rows=await db.transaction(async tx=>{await tx.exec('SET LOCAL statement_timeout=5000');return (await tx.query(`SELECT event_id,occurred_at,service_key,request_id,method,path,status_code,duration_ms,request_bytes,response_bytes FROM contracts.api_calls WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC,event_id DESC LIMIT $${args.length}`,args)).rows;});const more=rows.length>limit;rows.splice(limit);const last=rows.at(-1);return {filters:f,rows,nextCursor:more?Buffer.from(JSON.stringify({at:new Date(last.occurred_at).toISOString(),eventId:last.event_id,filterHash:serviceLimitHash(f)})).toString('base64url'):null,financialUsage:false};
 }
 async function detail(eventId){const r=(await db.query('SELECT event_id,producer_id,occurred_at,service_key,request_id,method,path,status_code,duration_ms,request_bytes,response_bytes,request_body,response_body FROM contracts.api_calls WHERE tenant_id=$1 AND event_id=$2',[tenantId,eventId])).rows[0];check(r,'فراخوانی یافت نشد.',404);return {...r,redacted:true,financialUsage:false};}
 async function report(input={}){
  const f=filters(input),{args,conditions}=queryParts(f),bucketCase=`CASE ${buckets.slice(0,-1).map(n=>`WHEN duration_ms<=${n} THEN ${n}`).join(' ')} ELSE 3600000 END`;
  const raw=where=>`SELECT date_trunc('hour',occurred_at) AS hour,service_key,status_code,${bucketCase} AS latency_bucket,count(*) AS calls,sum(duration_ms) AS duration_sum,sum(request_bytes) AS request_bytes,sum(response_bytes) AS response_bytes FROM contracts.api_calls WHERE ${where.join(' AND ')} GROUP BY 1,2,3,4`;
  let evidence;
  if(f.q)evidence=raw(conditions);
  else{
   const startSQL="(date_trunc('hour',$2::timestamptz)+CASE WHEN $2::timestamptz=date_trunc('hour',$2::timestamptz) THEN interval '0' ELSE interval '1 hour' END)",endSQL="date_trunc('hour',$3::timestamptz)",rollup=conditions.map(c=>c.replaceAll('occurred_at','hour'));rollup[1]=`hour >= ${startSQL}`;rollup[2]=`hour < ${endSQL}`;
   evidence=`SELECT hour,service_key,status_code,latency_bucket,calls,duration_sum,request_bytes,response_bytes FROM contracts.api_call_hourly WHERE ${rollup.join(' AND ')}`;
   if(Date.parse(f.from)%3600000||Date.parse(f.to)%3600000)evidence+=' UNION ALL '+raw([...conditions,`(occurred_at<${startSQL} OR occurred_at>=${endSQL})`]);
  }
  const sql=`WITH evidence AS MATERIALIZED (${evidence}),
   totals AS (SELECT COALESCE(sum(calls),0) total,COALESCE(sum(duration_sum),0) duration_sum,COALESCE(sum(request_bytes),0) request_bytes,COALESCE(sum(response_bytes),0) response_bytes,COALESCE(sum(calls) FILTER(WHERE status_code>=400),0) errors FROM evidence),
   status AS (SELECT status_code,sum(calls) n FROM evidence GROUP BY status_code),
   histogram AS (SELECT latency_bucket,sum(calls) n FROM evidence GROUP BY latency_bucket),
   service_counts AS (SELECT service_key,sum(calls) n FROM evidence GROUP BY service_key ORDER BY n DESC,service_key LIMIT 100),
   timeline AS (SELECT hour,sum(calls) calls,COALESCE(sum(calls) FILTER(WHERE status_code>=400),0) errors,COALESCE(sum(calls) FILTER(WHERE status_code=429),0) limited FROM evidence GROUP BY hour ORDER BY hour)
   SELECT jsonb_build_object('total',t.total,'durationSum',t.duration_sum,'requestBytes',t.request_bytes,'responseBytes',t.response_bytes,'errors',t.errors,
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status_code,n),'{}'::jsonb) FROM status),
    'latencyHistogram',(SELECT COALESCE(jsonb_object_agg(latency_bucket,n),'{}'::jsonb) FROM histogram),
    'services',(SELECT COALESCE(jsonb_object_agg(service_key,n),'{}'::jsonb) FROM service_counts),
    'timeline',(SELECT COALESCE(jsonb_agg(jsonb_build_object('hour',hour,'calls',calls,'errors',errors,'limited',limited) ORDER BY hour),'[]'::jsonb) FROM timeline)) result FROM totals t`;
  const data=await db.transaction(async tx=>{await tx.exec('SET LOCAL statement_timeout=5000');return (await tx.query(sql,args)).rows[0].result;});
  let seen=0,p95UpperMs=null;for(const b of buckets){seen+=Number(data.latencyHistogram[b]||0);if(data.total&&seen>=data.total*.95){p95UpperMs=b;break;}}
  const points=new Map(data.timeline.map(p=>[new Date(p.hour).toISOString(),p])),timeline=[];
  for(let hour=Math.floor(Date.parse(f.from)/3600000)*3600000;hour<Date.parse(f.to);hour+=3600000){const at=new Date(hour).toISOString();timeline.push(points.has(at)?{...points.get(at),hour:at}:{hour:at,calls:0,errors:0,limited:0});}
  return {filters:f,total:data.total,errorRate:data.total?data.errors/data.total:null,averageLatencyMs:data.total?data.durationSum/data.total:null,p95UpperMs,requestBytes:data.requestBytes,responseBytes:data.responseBytes,statusCounts:data.statusCounts,services:data.services,latencyHistogram:data.latencyHistogram,timeline,aggregation:f.q?'indexed-content-search':'hourly-rollup-exact-boundaries',financialUsage:false};
 }
 async function prune(){const cutoff=new Date(Date.now()-retentionDays*86400000).toISOString();return db.transaction(async tx=>{
  await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
  const removed=await tx.query('DELETE FROM contracts.api_calls WHERE tenant_id=$1 AND occurred_at<$2',[tenantId,cutoff]);
  await tx.query("DELETE FROM contracts.api_call_hourly WHERE tenant_id=$1 AND hour<=date_trunc('hour',$2::timestamptz)",[tenantId,cutoff]);
  await tx.query(`INSERT INTO contracts.api_call_hourly(tenant_id,hour,service_key,status_code,latency_bucket,calls,duration_sum,request_bytes,response_bytes) SELECT tenant_id,date_trunc('hour',occurred_at),service_key,status_code,CASE ${buckets.slice(0,-1).map(n=>`WHEN duration_ms<=${n} THEN ${n}`).join(' ')} ELSE 3600000 END,count(*),sum(duration_ms),sum(request_bytes),sum(response_bytes) FROM contracts.api_calls WHERE tenant_id=$1 AND occurred_at>=$2 AND occurred_at<date_trunc('hour',$2::timestamptz)+interval '1 hour' GROUP BY 1,2,3,4,5`,[tenantId,cutoff]);
  return {removed:removed.rowCount,cutoff};
 });}
 return {ingest,search,detail,report,prune};
}
