import {allocateRevenue} from './economy-model.js';
const limit=BigInt(Number.MAX_SAFE_INTEGER);
const amount=v=>typeof v==='string'&&/^\d{1,16}$/.test(v)&&BigInt(v)<=limit?BigInt(v):null;
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
// Local review only. The server rechecks revision, evidence, lifecycle and period.
export function settlementPreview(data,input,{now=Date.now()}={}){
 const errors=[],error=(field,message)=>errors.push({field,message});
 const version=(data.versions||[]).find(v=>v.id===input.versionId),terms=version?.terms;
 if(!version||version.status!=='signed')error('periodStart','نسخه امضاشده برای پیشنهاد تسویه لازم است.');
 if(data.executionStatus!=='running')error('periodStart','اجرای قرارداد متوقف، خاتمه‌یافته یا آغازنشده است.');
 const from=instant(input.periodStart)?Date.parse(input.periodStart):null,to=instant(input.periodEnd)?Date.parse(input.periodEnd):null;
 if(from===null)error('periodStart','شروع دوره معتبر لازم است.');
 if(to===null)error('periodEnd','پایان دوره معتبر لازم است.');
 const next=version?(data.versions||[]).filter(v=>v.status==='signed'&&v.effectiveAt>version.effectiveAt).sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt))[0]:null;
 let dueAt=null;
 if(terms&&from!==null&&to!==null){
  const duration=terms.periodDays*86400000,anchor=Date.parse(terms.anchor);
  if(from<anchor||from<Date.parse(version.validFrom)||from<Date.parse(version.effectiveAt))error('periodStart','شروع دوره باید از مبدأ تسویه، شروع اعتبار و زمان اثر این نسخه به بعد باشد.');
  if((from-anchor)%duration!==0)error('periodStart','شروع دوره با مبدأ و فاصله تسویه قرارداد منطبق نیست.');
  if(to-from!==duration)error('periodEnd','یک دوره کامل مطابق فاصله تسویه قرارداد لازم است.');
  if(to>Date.parse(version.validTo))error('periodEnd','پایان دوره از اعتبار این نسخه عبور می‌کند.');
  if(next&&Date.parse(next.effectiveAt)<to)error('periodEnd','دوره از مرز اصلاحیه امضاشده عبور می‌کند؛ تفکیک حسابداری مرکزی لازم است.');
  const due=to+terms.holdDays*86400000;
  if(Number.isFinite(due)&&Number.isFinite(new Date(due).getTime()))dueAt=new Date(due).toISOString();
  if(due>now)error('periodEnd','دوره و مهلت نگه‌داشت آن هنوز پایان نیافته‌اند.');
  if((data.settlements||[]).some(s=>s.proposal.periodStart===input.periodStart&&s.proposal.periodEnd===input.periodEnd))error('periodStart','برای این دوره پیشنهاد ثبت شده است؛ سند قبلی بازنویسی نمی‌شود.');
 }
 const values={};for(const field of ['collected','refunds','tax','disputed']){
  values[field]=amount(input[field]);if(values[field]===null)error(field,'مبلغ صحیح، نامنفی و در محدوده امن ریالی لازم است.');
 }
 let allocation=null;
 if(Object.values(values).every(v=>v!==null)&&terms){
  const {collected,refunds,tax,disputed}=values;
  if(refunds+tax+disputed>collected)error('collected','مجموع برگشت، مالیات و اختلاف از دریافت‌شده بیشتر است.');
  else{
   const base=collected-refunds-(terms.revenueBase==='net_collected'?tax:0n),held=terms.disputePolicy==='hold-all'&&disputed>0n?base:disputed,distributable=base-held;
   try{
    const allocations=allocateRevenue(String(distributable),terms.actors).map(a=>({...a,disposition:BigInt(a.amount)<BigInt(terms.minimumPayout)?'carry-forward':'request-central-credit'}));
    allocation={collected:String(collected),refunds:String(refunds),tax:String(tax),disputed:String(disputed),distributionBase:String(base),held:String(held),distributable:String(distributable),allocations,balanced:allocations.reduce((s,a)=>s+BigInt(a.amount),0n)+held===base};
   }catch{error('collected','شرایط سهم‌ها معتبر نیست؛ نسخه قرارداد را بازخوانی کنید.');}
  }
 }
 const reference=String(input.evidenceReference||'').trim();
 if(!reference||reference.length>1000)error('evidenceReference','مرجع گزارش مالی، حداکثر هزار نویسه، لازم است.');
 if(input.confirmEvidence!==true)error('confirmEvidence','تأیید بازبینی مدارک مالی لازم است.');
 return {version:version||null,next:next||null,dueAt,allocation,errors};
}
