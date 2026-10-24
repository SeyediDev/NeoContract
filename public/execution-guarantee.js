const sum=rows=>rows.reduce((n,v)=>n+BigInt(v),0n);
const live=i=>!['rejected','cancelled'].includes(i.status);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
// Mirrors the existing release rule: effective advance receipts less live
// reserved recovery. This is neither a bank balance nor a new legal approval.
export function executionGuaranteeAdvance(s){
 const invoices=s.invoices.filter(live),ids=new Set(invoices.filter(i=>i.kind==='advance').map(i=>i.id)),reversed=new Set(s.reversals.map(r=>r.paymentId));
 const paid=sum(s.payments.filter(p=>ids.has(p.invoiceId)&&!reversed.has(p.id)).map(p=>p.amount)),reserved=sum(invoices.map(i=>i.advanceRecovery||0));
 return {paid:String(paid),recoveryReserved:String(reserved),outstanding:String(paid-reserved)};
}
export function executionGuaranteePreview(s,action,id,input={}){
 const errors=[],add=(field,message)=>errors.push({field,message}),g=s.guarantees.find(g=>g.id===id),advance=executionGuaranteeAdvance(s);
 const r={action,errors,guarantee:g?structuredClone(g):null,advance,before:g?{status:g.status,expiryDate:g.expiryDate,amount:String(g.amount)}:null,after:null};
 if(!['guarantee-release','guarantee-extend'].includes(action)){add('reference','نوع اقدام تضمین معتبر نیست.');return r;}
 if(!['running','paused'].includes(s.status))add('reference','تضمین فقط در اجرای جاری یا متوقف قابل رسیدگی است.');
 if(!g){add('reference','تضمین در این اجرا یافت نشد.');return r;}
 if(g.status!=='held')add('reference','تضمین قبلاً آزاد شده است؛ پرونده را بازخوانی کنید.');
 if(action==='guarantee-release'&&g.kind==='advance'&&BigInt(advance.outstanding)!==0n)add('reference','پیش‌پرداخت تسویه نشده است؛ مانده پس از رسیدهای مؤثر و بازیافت رزروشده باید صفر باشد.');
 if(action==='guarantee-extend'){
  if(!date(input.expiryDate))add('expiryDate','تاریخ میلادی معتبر برای انقضای جدید لازم است.');
  else if(input.expiryDate<=g.expiryDate)add('expiryDate','انقضای جدید باید پس از انقضای فعلی باشد.');
 }
 if(!errors.length)r.after={status:action==='guarantee-release'?'released':'held',expiryDate:action==='guarantee-extend'?input.expiryDate:g.expiryDate,amount:String(g.amount)};
 return r;
}
