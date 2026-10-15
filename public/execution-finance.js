const limit=BigInt(Number.MAX_SAFE_INTEGER);
const live=invoice=>!['cancelled','rejected'].includes(invoice.status);
const sum=values=>values.reduce((total,value)=>total+BigInt(value),0n);
export const executionDeductionFields=['retention','withholding','insurance','penalty','advanceRecovery'];
const amount=value=>/^\d+$/.test(String(value))&&BigInt(value)<=limit?BigInt(value):null;
const quantity=value=>{
 if(!/^\d{1,12}(\.\d{1,3})?$/.test(String(value)))return null;
 const [whole,fraction='']=String(value).split('.');
 const result=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));
 return result>0n?result:null;
};
export const executionQuantityText=units=>{
 const value=BigInt(units),fraction=String(value%1000n).padStart(3,'0').replace(/0+$/,'');
 return String(value/1000n)+(fraction?'.'+fraction:'');
};
export function executionInvoiceCapacity(s){
 const invoices=s.invoices.filter(live),accepted=new Map(),billed=new Map();
 for(const delivery of s.deliveries)if(delivery.status==='accepted')accepted.set(delivery.itemId,(accepted.get(delivery.itemId)||0n)+BigInt(delivery.quantity));
 for(const invoice of invoices)for(const line of invoice.lines||[])billed.set(line.itemId,(billed.get(line.itemId)||0n)+BigInt(line.quantity));
 const advances=invoices.filter(invoice=>invoice.kind==='advance'),advanceIds=new Set(advances.map(invoice=>invoice.id)),reversed=new Set(s.reversals.map(row=>row.paymentId));
 const advancePaid=sum(s.payments.filter(payment=>advanceIds.has(payment.invoiceId)&&!reversed.has(payment.id)).map(payment=>payment.amount));
 const stages=s.milestones.map(stage=>({id:stage.id,title:stage.title,remaining:String(BigInt(stage.gross)-sum(invoices.filter(invoice=>invoice.milestoneId===stage.id).map(invoice=>invoice.gross))),lines:s.items.filter(item=>item.milestoneId===stage.id).map(item=>({...item,availableUnits:String((accepted.get(item.id)||0n)-(billed.get(item.id)||0n))}))}));
 return {stages,advanceAvailable:String(BigInt(s.basis.advanceLimit)-sum(advances.map(invoice=>invoice.gross))),advanceRecoverable:String(advancePaid-sum(invoices.map(invoice=>invoice.advanceRecovery))),contractRemaining:String(BigInt(s.effectiveAmount)-sum(invoices.filter(invoice=>['progress','final'].includes(invoice.kind)).map(invoice=>invoice.gross))),finalReady:s.items.length>0&&s.items.every(item=>(accepted.get(item.id)||0n)===BigInt(item.quantity))};
}
export function executionInvoicePreview(s,input){
 const capacity=executionInvoiceCapacity(s),errors=[],error=(field,message)=>errors.push({field,message});
 const stage=capacity.stages.find(stage=>stage.id===input.milestoneId);
 let gross=0n,validGross=true;
 if(!['progress','advance','final'].includes(input.kind))error('kind','نوع صورت‌وضعیت معتبر نیست.');
 if(input.kind==='advance'){
  gross=amount(input.gross);validGross=gross!==null;
  if(!validGross)error('gross','مبلغ صحیح و نامنفی ریالی لازم است.');
  else if(gross<=0n)error('gross','مبلغ پیش‌پرداخت باید مثبت باشد.');
  else if(gross>BigInt(capacity.advanceAvailable))error('gross','مبلغ از سقف باقی‌مانده پیش‌پرداخت بیشتر است.');
 }else{
  if(!stage)error('milestoneId','مرحله مالی را انتخاب کنید.');
  const lines=input.lines||[],seen=new Set();
  if(!lines.length||lines.length>100)error('kind','بین یک تا صد ردیف تحویل تأییدشده انتخاب کنید.');
  for(const line of lines){
   const field='line-'+line.itemId,item=stage?.lines.find(item=>item.id===line.itemId),units=quantity(line.quantity);
   if(!item||seen.has(line.itemId)){error('kind','ردیف تکراری یا مربوط به مرحله دیگری است.');validGross=false;continue;}seen.add(line.itemId);
   if(units===null){error(field,'مقدار مثبت با حداکثر سه رقم اعشار لازم است.');validGross=false;continue;}
   if(units>BigInt(item.availableUnits))error(field,'مقدار از تحویل تأییدشده قابل صورت‌وضعیت بیشتر است.');
   const value=(units*BigInt(item.unitPrice)+500n)/1000n;gross+=value;
   if(value>limit)error(field,'مبلغ ردیف خارج از محدوده امن ریالی است.');
  }
  if(gross>limit)error('kind','جمع ناخالص خارج از محدوده امن ریالی است.');
  if(stage&&gross>BigInt(stage.remaining))error('milestoneId','ناخالص از سقف باقی‌مانده مرحله بیشتر است.');
  if(gross>BigInt(capacity.contractRemaining))error('kind','ناخالص از مبلغ باقی‌مانده قرارداد بیشتر است.');
  if(input.kind==='final'&&!capacity.finalReady)error('kind','پذیرش کامل همه اقلام برای صورت‌وضعیت نهایی لازم است.');
 }
 const values={};for(const field of ['tax',...executionDeductionFields]){values[field]=amount(input[field]);if(values[field]===null)error(field,'مبلغ صحیح و نامنفی ریالی لازم است.');}
 const validAmounts=Object.values(values).every(value=>value!==null),deductions=validAmounts?sum(executionDeductionFields.map(field=>values[field])):null;
 const basisRequired=validAmounts&&(deductions>0n||values.tax>0n);
 if(basisRequired&&!String(input.basis||'').trim())error('basis','مرجع و مبنای مالیات و کسورات را وارد کنید.');
 if(validAmounts){
  if(input.kind==='advance')for(const field of ['tax',...executionDeductionFields])if(values[field]>0n)error(field,'پیش‌پرداخت بدون مالیات و کسورات ثبت می‌شود.');
  if(values.advanceRecovery>BigInt(capacity.advanceRecoverable))error('advanceRecovery','بازیافت از پیش‌پرداخت دریافت/پرداخت‌شده باقیمانده بیشتر است.');
  if(validGross&&deductions>gross)error(executionDeductionFields.find(field=>values[field]>0n)||'retention','جمع کسورات از مبلغ ناخالص بیشتر است.');
 }
 const net=validGross&&validAmounts?gross+values.tax-deductions:null;
 if(net!==null&&net>limit)error('tax','خالص صورت‌وضعیت خارج از محدوده امن ریالی است.');
 if(input.number&&s.invoices.some(invoice=>invoice.number===String(input.number).trim()))error('number','شماره صورت‌وضعیت قبلاً استفاده شده است.');
 return {capacity,stageRemaining:stage?.remaining??null,gross:validGross?String(gross):null,tax:values.tax===null?null:String(values.tax),deductions:deductions===null?null:String(deductions),net:net===null?null:String(net),basisRequired,errors};
}
export function executionDeductionRemaining(s,invoiceId){
 const invoice=s.invoices.find(invoice=>invoice.id===invoiceId);if(!invoice)return null;
 const reversed=new Set(s.deductionReversals.map(row=>row.settlementId));
 return Object.fromEntries(['withholding','insurance'].map(kind=>[kind,String(BigInt(invoice[kind])-sum(s.deductionSettlements.filter(row=>row.invoiceId===invoiceId&&row.kind===kind&&!reversed.has(row.id)).map(row=>row.amount)))]));
}
export function executionPaymentCapacity(s,invoiceId){
 const invoice=s.invoices.find(row=>row.id===invoiceId);if(!invoice)return null;
 const reversed=new Set(s.reversals.map(row=>row.paymentId)),receipts=s.payments.filter(row=>row.invoiceId===invoiceId);
 const paid=sum(receipts.filter(row=>!reversed.has(row.id)).map(row=>row.amount));
 return {number:invoice.number,net:String(invoice.net),paid:String(paid),reversed:String(sum(receipts.filter(row=>reversed.has(row.id)).map(row=>row.amount))),remaining:String(BigInt(invoice.net)-paid),approved:invoice.status==='approved'};
}
export function executionRetentionCapacity(s){
 const invoices=s.invoices.filter(live),sources=invoices.filter(row=>row.retention>0).map(row=>({id:row.id,number:row.number,status:row.status,retention:String(row.retention),remaining:executionPaymentCapacity(s,row.id).remaining}));
 const held=sum(sources.filter(row=>['approved','disputed'].includes(row.status)).map(row=>row.retention));
 const reserved=sum(invoices.filter(row=>row.kind==='retention').map(row=>row.net));
 return {held:String(held),reserved:String(reserved),remaining:String(held-reserved),sources,blockers:sources.filter(row=>row.status!=='approved'||BigInt(row.remaining)!==0n)};
}
export function executionReceiptPreview(s,action,input,invoiceId){
 const errors=[],error=(field,message)=>errors.push({field,message}),value=amount(input.amount);
 const capacity=action==='payment'?executionPaymentCapacity(s,invoiceId):executionRetentionCapacity(s);
 if(s.status==='closed')error('amount','پرونده اجرا خاتمه یافته است.');
 if(action==='payment'){
  if(!capacity)error('amount','صورت‌وضعیت یافت نشد.');
  else if(!capacity.approved)error('amount','تأیید مالی و رفع اختلاف صورت‌وضعیت لازم است.');
  if(String(input.reference||'').trim()&&s.payments.some(row=>row.reference===String(input.reference).trim()))error('reference','مرجع رسید قبلاً استفاده شده است؛ مرجع رسید برگشتی نیز قابل استفاده مجدد نیست.');
 }else if(capacity.blockers.length)error('amount','تسویه همه صورت‌وضعیت‌های دارای سپرده و رفع اختلاف آن‌ها لازم است.');
 if(value===null||value<=0n)error('amount','مبلغ صحیح و مثبت در محدوده امن ریالی لازم است.');
 else if(capacity&&value>BigInt(capacity.remaining))error('amount',action==='payment'?'مبلغ از مانده صورت‌وضعیت بیشتر است.':'مبلغ از سپرده آزاد‌نشده بیشتر است.');
 return {capacity,amount:value===null?null:String(value),after:capacity&&value!==null?String(BigInt(capacity.remaining)-value):null,errors};
}
export function executionReversalPreview(s,action,id){
 const payment=action==='payment-reverse',errors=[],effects=[];
 const receipt=(payment?s.payments:s.deductionSettlements).find(row=>row.id===id);
 if(!receipt)return {errors:['رسید یافت نشد.'],effects};
 const invoice=s.invoices.find(row=>row.id===receipt.invoiceId);
 if(!invoice)return {errors:['صورت‌وضعیت رسید یافت نشد.'],effects};
 const reversed=(payment?s.reversals:s.deductionReversals).some(row=>(payment?row.paymentId:row.settlementId)===id);
 if(reversed)errors.push('رسید قبلاً برگشت خورده است.');
 if(s.status==='closed')errors.push('پرونده اجرا خاتمه یافته است.');
 const delta=reversed?0n:BigInt(receipt.amount),result={amount:String(receipt.amount),reference:receipt.reference,invoiceId:invoice.id,number:invoice.number,kind:payment?'payment':receipt.kind,errors,effects};
 if(payment){
  const c=executionPaymentCapacity(s,invoice.id);
  Object.assign(result,{paidBefore:c.paid,paidAfter:String(BigInt(c.paid)-delta),remainingBefore:c.remaining,remainingAfter:String(BigInt(c.remaining)+delta)});
  if(invoice.kind==='advance'){
   const before=executionInvoiceCapacity(s).advanceRecoverable;
   Object.assign(result,{advanceBefore:before,advanceAfter:String(BigInt(before)-delta)});
   if(!reversed&&BigInt(before)<delta)errors.push('این پیش‌پرداخت در بازیافت رزرو شده است؛ ابتدا صورت‌وضعیت مرتبط را مطابق مدارک اصلاح کنید.');
  }
  if(invoice.retention>0)effects.push('برگشت این رسید، مانده صورت‌وضعیت دارای سپرده را باز می‌کند و مانع صدور مجوز آزادسازی تازه می‌شود؛ مجوزهای قبلی خودکار باطل نمی‌شوند.');
  if(invoice.kind==='retention')effects.push('مانده دریافت/پرداخت مجوز سپرده دوباره باز می‌شود؛ خود مجوز باقی می‌ماند و مبلغ سپرده آزاد‌نشده تغییر نمی‌کند.');
 }else{
  const before=executionDeductionRemaining(s,invoice.id)[receipt.kind];
  Object.assign(result,{remainingBefore:before,remainingAfter:String(BigInt(before)+delta)});
  effects.push('مانده '+(receipt.kind==='insurance'?'بیمه':'مالیات تکلیفی')+' دوباره باز می‌شود؛ مانده خالص صورت‌وضعیت تغییر نمی‌کند.');
 }
 return result;
}
