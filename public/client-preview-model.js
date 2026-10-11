// Isolated, deterministic UI fixtures. Never imported by ingestion or financial code.
export const demoEnd = Date.parse('2026-10-11T09:30:00Z');
export const demoServices = [
 {key:'identity-check',name:'استعلام هویت',path:'/v1/identity/check'},
 {key:'payment-inquiry',name:'استعلام پرداخت',path:'/v1/payments/inquiry'},
 {key:'document-verify',name:'اعتبارسنجی سند',path:'/v1/documents/verify'}
];
export const demoCalls = Array.from({length:360},(_,i)=>{
 const service=demoServices[i%3],status=i%31===0?503:i%19===0?429:i%17===0?400:200;
 return {id:`demo-${String(i+1).padStart(4,'0')}`,requestId:`sample-request-${i+1}`,
  service:service.key,path:service.path,method:'POST',status,
  at:demoEnd-((359-i)*4+2)*60000,duration:status===503?1100+(i%5)*90:70+(i*37)%420,
  input:{reference:`SAMPLE-${String(i+1).padStart(4,'0')}`,channel:i%2?'web':'mobile',authorization:'[REDACTED]'},
  output:status===200?{result:'verified',reference:`SAMPLE-${String(i+1).padStart(4,'0')}`}:
   {error:status===503?'upstream_unavailable':status===429?'rate_limited':'invalid_reference',retryable:status!==400}
 };
}).reverse();
const normalize=v=>String(v).toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const searchIndex=new Map(demoCalls.map(c=>[c.id,normalize(JSON.stringify([c.input,c.output,c.path,c.requestId,c.id]))]));
export function filterCalls({service='',status='',hours=24,q=''}={}){
 const needle=normalize(q.trim());
 return demoCalls.filter(c=>c.at>=demoEnd-Number(hours)*3600000&&(!service||c.service===service)&&
  (!status||(status==='errors'?c.status>=400:String(c.status)===status))&&(!needle||searchIndex.get(c.id).includes(needle)));
}
export function summarizeCalls(calls,{hours=24}={}){
 const sorted=calls.map(c=>c.duration).sort((a,b)=>a-b),errors=calls.filter(c=>c.status>=400).length;
 const timeline=Array.from({length:Number(hours)},(_,i)=>({at:demoEnd-(Number(hours)-i)*3600000,calls:0,errors:0}));
 const statusCounts={},buckets=[{label:'≤ ۲۰۰',count:0},{label:'۲۰۱–۵۰۰',count:0},{label:'۵۰۱–۱۰۰۰',count:0},{label:'> ۱۰۰۰',count:0}];
 for(const call of calls){
  statusCounts[call.status]=(statusCounts[call.status]||0)+1;
  const index=Math.floor((call.at-(demoEnd-Number(hours)*3600000))/3600000);
  if(timeline[index]){timeline[index].calls++;if(call.status>=400)timeline[index].errors++;}
  buckets[call.duration<=200?0:call.duration<=500?1:call.duration<=1000?2:3].count++;
 }
 return {total:calls.length,errors,errorRate:calls.length?errors/calls.length:null,
  average:calls.length?calls.reduce((n,c)=>n+c.duration,0)/calls.length:null,
  p95:calls.length?sorted[Math.ceil(calls.length*.95)-1]:null,statusCounts,buckets,timeline};
}
