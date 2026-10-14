// Read-only explanation of the existing close gates in lib/execution.mjs.
// A passing preview does not replace server authorization or revision checks.
export function executionClosure(s){
 const live=s.invoices.filter(i=>!['cancelled','rejected'].includes(i.status));
 const approved=live.filter(i=>['approved','disputed'].includes(i.status));
 const reversed=new Set(s.reversals.map(r=>r.paymentId)),deductionReversed=new Set(s.deductionReversals.map(r=>r.settlementId));
 const total=(rows,key)=>rows.reduce((n,row)=>n+BigInt(row[key]),0n);
 const paid=new Map(),accepted=new Map(),billed=new Map(),deductions=new Map();
 const add=(map,key,n)=>map.set(key,(map.get(key)||0n)+BigInt(n));
 for(const p of s.payments)if(!reversed.has(p.id))add(paid,p.invoiceId,p.amount);
 for(const d of s.deliveries)if(d.status==='accepted')add(accepted,d.itemId,d.quantity);
 for(const i of live)for(const line of i.lines||[])add(billed,line.itemId,line.quantity);
 for(const d of s.deductionSettlements)if(!deductionReversed.has(d.id))add(deductions,d.invoiceId+':'+d.kind,d.amount);
 const balances={
  advance:live.filter(i=>i.kind==='advance').reduce((n,i)=>n+(paid.get(i.id)||0n),0n)-total(live,'advanceRecovery'),
  retention:total(approved,'retention')-total(live.filter(i=>i.kind==='retention'),'net'),
  withholding:approved.reduce((n,i)=>n+BigInt(i.withholding)-(deductions.get(i.id+':withholding')||0n),0n),
  insurance:approved.reduce((n,i)=>n+BigInt(i.insurance)-(deductions.get(i.id+':insurance')||0n),0n)
 };
 const groups=[
  {key:'items',title:'تحویل و صورت‌وضعیت کامل اقلام',section:'items',rows:s.items.length?s.items.filter(i=>(accepted.get(i.id)||0n)!==BigInt(i.quantity)||(billed.get(i.id)||0n)!==BigInt(i.quantity)).map(i=>({id:i.id,title:i.title,detail:'تحویل پذیرفته‌شده و صورت‌وضعیت‌شده باید هر دو برابر مقدار تعهد باشند.',unit:i.unit,quantity:String(i.quantity),accepted:String(accepted.get(i.id)||0n),billed:String(billed.get(i.id)||0n)})):[{id:'no-items',title:'اقلام قرارداد',detail:'حداقل یک قلم و تحویل و صورت‌وضعیت کامل آن لازم است.'}]},
  {key:'obligations',title:'انجام تعهدات',section:'obligations',rows:s.obligations.filter(o=>o.status!=='completed').map(o=>({id:o.id,title:o.title,detail:'انجام مستند تعهد هنوز ثبت نشده است.'}))},
  {key:'issues',title:'رسیدگی به اختلاف‌ها و ریسک‌ها',section:'issues',rows:s.issues.filter(i=>i.status!=='resolved').map(i=>({id:i.id,title:i.title,detail:'نتیجه رسیدگی و بسته‌شدن این مورد لازم است.'}))},
  {key:'guarantees',title:'آزادسازی تضمین‌ها',section:'obligations',rows:s.guarantees.filter(g=>g.status!=='released').map(g=>({id:g.id,title:g.reference,detail:'مجوز مستند آزادسازی تضمین هنوز ثبت نشده است.',amount:String(g.amount)}))},
  {key:'invoices',title:'تأیید و تسویه صورت‌وضعیت‌ها',section:'finance',rows:live.filter(i=>i.status!=='approved'||(paid.get(i.id)||0n)!==BigInt(i.net)).map(i=>({id:i.id,title:i.number,detail:i.status==='disputed'?'اختلاف مالی باز است؛ رفع اختلاف و تسویه لازم است.':i.status!=='approved'?'تأیید مالی و تسویه صورت‌وضعیت لازم است.':'مانده دریافت / پرداخت باید تسویه شود.',amount:String(BigInt(i.net)-(paid.get(i.id)||0n))}))},
  {key:'balances',title:'تسویه پیش‌پرداخت، سپرده و کسورات',section:'finance',rows:Object.entries(balances).filter(([,n])=>n!==0n).map(([key,n])=>({id:key,title:{advance:'پیش‌پرداخت قابل بازیافت',retention:'سپرده آزادنشده',withholding:'مالیات تکلیفی تسویه‌نشده',insurance:'بیمه تسویه‌نشده'}[key],detail:key==='advance'?'بازیافت رزروشده در صورت‌وضعیت‌های زنده از پرداخت مؤثر کسر شده است.':key==='retention'?'مجوز آزادسازی، رسید دریافت / پرداخت مستقل لازم دارد.':'رسید تسویه و برگشت‌های آن در مانده لحاظ شده‌اند.',amount:String(n)}))},
  {key:'status',title:'وضعیت اجرای قرارداد',section:'overview',rows:s.status==='running'?[]:[{id:'status',title:s.status==='paused'?'اجرا متوقف است':'پرونده قابل خاتمه نیست',detail:s.status==='paused'?'برای خاتمه، ابتدا شروع مجدد اجرا را با مدرک ثبت کنید.':'پرونده خاتمه‌یافته قابل تغییر یا بازگشایی نیست.'}]}
 ];
 const blockedCount=groups.reduce((n,g)=>n+g.rows.length,0);
 return {groups,blockedCount,ready:blockedCount===0,closed:s.status==='closed'};
}
