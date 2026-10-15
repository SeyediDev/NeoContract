// A read-only view of contractual applicability. A receipt is historical evidence,
// not a live probe of Gateway enforcement or acceptance of contract lifecycle.
export const serviceLimitImpactLabels={draft:'پیش‌نویس؛ بدون اثر اجرایی',cancelled:'پیش‌نویس لغوشده',scheduled:'امضاشده؛ منتظر تاریخ اثر',current:'نسخه مؤثر قراردادی',superseded:'با نسخه جدیدتر جایگزین شده',expired:'اعتبار نسخه پایان یافته',paused:'نسخه در زمان توقف اجرا',closed:'اجرای قرارداد خاتمه یافته',inactive:'اجرای قرارداد آغاز نشده'};
export function serviceLimitImpact(data,{now=new Date().toISOString()}={}){
 const groups=new Map(),versions=new Map(),outbox=new Map((data.outbox||[]).map(row=>[row.version_id,row]));
 for(const v of [...(data.versions||[])].sort((a,b)=>a.version-b.version)){
  const key=v.terms.serviceKey;
  if(!groups.has(key))groups.set(key,{key,title:v.terms.title,versions:[]});
  groups.get(key).versions.push(v);
 }
 for(const group of groups.values()){
  const signed=group.versions.filter(v=>v.status==='signed');
  const latest=signed.filter(v=>v.terms.effectiveAt<=now).at(-1);
  const effective=latest&&latest.terms.validFrom<=now&&now<latest.terms.validTo?latest:null;
  group.effective=effective;group.next=signed.find(v=>v.terms.effectiveAt>now)||null;
  group.current=data.executionStatus==='running'?effective:null;
  let previous=null;
  for(const v of group.versions){
   const t=v.terms,row=outbox.get(v.id);
   let status=v.status;
   if(v.status==='signed')status=t.effectiveAt>now?'scheduled':v.id!==latest?.id?'superseded':!effective?'expired':data.executionStatus==='running'?'current':data.executionStatus==='paused'?'paused':data.executionStatus==='closed'?'closed':'inactive';
   versions.set(v.id,{status,previous,changes:['requestsPerSecond','burstCapacity','monthlyRequests'].map(key=>({key,before:previous?.terms[key]??null,after:t[key],changed:previous?previous.terms[key]!==t[key]:false})),observed:row?.status==='acknowledged'&&row?.receipt?.phase==='acknowledged',row});
   if(v.status==='signed')previous=v;
  }
  group.status=latest?versions.get(latest.id).status:group.next?'scheduled':'unsigned';
 }
 return {asOf:now,services:[...groups.values()],versions};
}
