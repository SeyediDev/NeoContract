import {executionActionAvailable} from './execution-permissions.js';
export const followupUrgencies={overdue:'موعد گذشته',today:'موعد امروز',upcoming:'تا ۱۴ روز آینده',future:'موعد آینده',undated:'بدون موعد'};
export const followupCategories={delivery:'تحویل و پذیرش',finance:'مالی',obligation:'تعهد',guarantee:'تضمین',issue:'ریسک و اختلاف',contract:'پایان قرارداد'};
const sum=values=>Number(values.reduce((a,v)=>a+BigInt(v),0n));
const quantity=v=>new Intl.NumberFormat('fa-IR',{maximumFractionDigits:3}).format(Math.round(v*1000)/1000);
const reviewKinds=new Set(['delivery-review','invoice-review','invoice-dispute']);
export function executionFollowups(s,summary,{today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}={}){
 const date=new Date(today+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||Number.isNaN(+date)||date.toISOString().slice(0,10)!==today)throw new Error('Invalid follow-up date');
 const until=new Date(+date+14*86400000).toISOString().slice(0,10),rows=[];
 const counts=()=>({total:rows.length,overdue:rows.filter(r=>r.urgency==='overdue').length,near:rows.filter(r=>['today','upcoming'].includes(r.urgency)).length,review:rows.filter(r=>reviewKinds.has(r.kind)).length,finance:rows.filter(r=>r.category==='finance').length});
 if(!s||s.status==='closed')return {asOf:today,until,rows,counts:counts()};
 const add=(kind,recordId,title,category,section,dueDate,owner,action,detail,amount=null,actionId=recordId)=>{
  const urgency=!dueDate?'undated':dueDate<today?'overdue':dueDate===today?'today':dueDate<=until?'upcoming':'future';
  rows.push({key:kind+':'+recordId,kind,recordId,title,category,section,dueDate:dueDate||null,owner,urgency,daysLate:urgency==='overdue'?Math.round((+date-+new Date(dueDate+'T00:00:00Z'))/86400000):0,review:reviewKinds.has(kind),action,actionId,blockedReason:action&&!executionActionAvailable(s.status,action)?'این اقدام به شروع مجدد اجرا نیاز دارد.':null,detail,amount});
 };
 const itemName=id=>s.items.find(i=>i.id===id)?.title||'قلم';
 for(const i of s.items){
  const p=summary.itemProgress.find(p=>p.id===i.id);if(!p)continue;
  if(p.submitted<p.quantity)add('item-delivery',i.id,i.title,'delivery','items',i.dueDate,i.owner,'delivery','باقیمانده تحویل: '+quantity(p.quantity-p.submitted)+' '+i.unit);
  if(p.accepted>p.billed)add('item-billing',i.id,i.title,'finance','finance',null,'مدیر حساب / مالی',null,'کارکرد پذیرفته‌شده قابل صورت‌وضعیت: '+quantity(p.accepted-p.billed)+' '+i.unit);
 }
 for(const d of s.deliveries.filter(d=>d.status==='submitted')){
  const i=s.items.find(i=>i.id===d.itemId);add('delivery-review',d.id,itemName(d.itemId),'delivery','items',i?.dueDate,'بازبین حقوقی','accept','تحویل در انتظار بررسی؛ مرجع: '+d.reference);
 }
 for(const i of s.invoices){
  if(['cancelled','rejected'].includes(i.status))continue;
  const paid=sum(s.payments.filter(p=>p.invoiceId===i.id&&!s.reversals.some(r=>r.paymentId===p.id)).map(p=>p.amount));
  if(i.status==='submitted')add('invoice-review',i.id,i.number,'finance','finance',i.dueDate,'بازبین مالی','invoice-approve','صورت‌وضعیت در انتظار بررسی مالی؛ خالص پیشنهادی',i.net);
  if(i.status==='disputed')add('invoice-dispute',i.id,i.number,'finance','finance',i.dueDate,'بازبین مالی','invoice-resolve','اختلاف مالی باز؛ دریافت / پرداخت به رفع اختلاف نیاز دارد.',i.net-paid);
  if(i.status==='approved'&&paid<i.net)add('invoice-payment',i.id,i.number,'finance','finance',i.dueDate,'بازبین مالی','payment',s.basis.direction==='receivable'?'مانده قابل دریافت از مشتری':'مانده قابل پرداخت به طرف قرارداد',i.net-paid);
  if(['approved','disputed'].includes(i.status)){
   const settled=kind=>sum(s.deductionSettlements.filter(d=>d.invoiceId===i.id&&d.kind===kind&&!s.deductionReversals.some(r=>r.settlementId===d.id)).map(d=>d.amount));
   const remaining=(i.withholding-settled('withholding'))+(i.insurance-settled('insurance'));
   if(remaining>0)add('invoice-deductions',i.id,i.number,'finance','finance',null,'بازبین مالی',i.status==='approved'?'deduction-settle':null,i.status==='disputed'?'تسویه کسورات پس از رفع اختلاف؛ تاریخ قانونی از این فهرست استنتاج نمی‌شود.':'کسورات بیمه / مالیات تکلیفی تسویه‌نشده؛ موعد در این بخش ثبت نشده است.',remaining);
  }
 }
 if(summary.retentionHeld>0){
  const ready=s.invoices.filter(i=>!['cancelled','rejected'].includes(i.status)&&i.retention>0).every(i=>i.status==='approved'&&sum(s.payments.filter(p=>p.invoiceId===i.id&&!s.reversals.some(r=>r.paymentId===p.id)).map(p=>p.amount))===i.net);
  add('retention','retention','سپرده حسن انجام','finance','finance',null,'بازبین مالی',ready?'retention-release':null,ready?'برای آزادسازی، مجوز و مدرک توافق‌شده ثبت کنید.':'آزادسازی سپرده به تسویه صورت‌وضعیت‌های دارای سپرده و رفع اختلاف نیاز دارد.',summary.retentionHeld,'');
 }
 if(summary.advanceOutstanding>0)add('advance','advance','پیش‌پرداخت باقیمانده','finance','finance',null,'مدیر حساب / مالی',null,'بازیافت در صورت‌وضعیت‌های آتی مطابق توافق پیگیری شود.',summary.advanceOutstanding);
 for(const o of s.obligations.filter(o=>o.status==='open'))add('obligation',o.id,o.title,'obligation','obligations',o.dueDate,o.owner,'obligation-complete',o.condition);
 for(const g of s.guarantees.filter(g=>g.status==='held'&&g.expiryDate<=until))add('guarantee',g.id,g.reference,'guarantee','obligations',g.expiryDate,'بازبین حقوقی','guarantee-extend','انقضای تضمین؛ تمدید یا آزادسازی مستند را بررسی کنید.',g.amount);
 for(const i of s.issues.filter(i=>i.status==='open'))add('issue',i.id,i.title,'issue','issues',i.dueDate,i.owner,'issue-resolve',i.impact);
 if(s.endDate<=until)add('contract-end','contract-end','پایان جاری قرارداد','contract','issues',s.endDate,'مدیر قرارداد / حقوقی','change','تمدید توافق‌شده یا شرایط خاتمه و تسویه را بررسی کنید.',null,'');
 const rank={overdue:0,today:1,upcoming:2,undated:3,future:4};rows.sort((a,b)=>rank[a.urgency]-rank[b.urgency]||(a.dueDate||'').localeCompare(b.dueDate||'')||Number(b.review)-Number(a.review)||a.key.localeCompare(b.key));
 return {asOf:today,until,rows,counts:counts()};
}
