import {executionPreparation} from './execution-preparation.js';
const maximum=BigInt(Number.MAX_SAFE_INTEGER);
const sum=rows=>rows.reduce((n,v)=>n+BigInt(v),0n);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const money=v=>/^\d{1,16}$/.test(String(v??''))&&BigInt(v)<=maximum?BigInt(v):null;
const quantity=v=>{
 if(!/^\d{1,12}(\.\d{1,3})?$/.test(String(v??'')))return null;
 const [a,b='']=String(v).split('.'),n=BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));
 return n>0n?n:null;
};
// A read-only preview of the existing command; authorization and revision stay on the server.
export function executionChangePreview(s,input){
 const errors=[],add=(field,message)=>errors.push({field,message}),before=executionPreparation(s),next=structuredClone(s);
 const amount=money(input.effectiveAmount),stage=s.milestones.find(m=>m.id===input.milestoneId),item=s.items.find(i=>i.id===input.itemId);
 const stageIds=new Set([stage?.id,item?.milestoneId]);
 const result={errors,before,after:null,item:null,stages:before.stages.filter(m=>stageIds.has(m.id)).map(m=>({id:m.id,title:m.title,before:m,after:null})),amount:{before:String(s.effectiveAmount),after:amount===null?null:String(amount)},endDate:{before:s.endDate,after:date(input.endDate)?input.endDate:null}};
 if(s.status!=='running')add('reference','برای تغییر توافق‌شده، اجرا باید در حال اجرا باشد.');
 if(amount===null)add('effectiveAmount','مبلغ صحیح و نامنفی ریالی در محدوده امن لازم است.');else next.effectiveAmount=Number(amount);
 if(!date(input.endDate))add('endDate','تاریخ پایان معتبر لازم است.');else if(input.endDate<s.basis.startDate)add('endDate','پایان جدید نمی‌تواند پیش از شروع مبنای امضا باشد.');else next.endDate=input.endDate;
 if(input.milestoneId){
  const gross=money(input.gross);
  if(!stage)add('milestoneId','مرحله مالی منتخب در این اجرا یافت نشد.');
  if(gross===null||gross===0n)add('gross','سقف مثبت و صحیح ریالی در محدوده امن لازم است.');
  else if(stage)next.milestones.find(m=>m.id===stage.id).gross=Number(gross);
 }
 if(input.itemId){
  if(!item)add('itemId','قلم منتخب در این اجرا یافت نشد.');
  else{
   const live=s.invoices.filter(i=>!['cancelled','rejected'].includes(i.status));
   const billed=sum(live.flatMap(i=>i.lines||[]).filter(l=>l.itemId===item.id).map(l=>l.quantity));
   const delivered=sum(s.deliveries.filter(d=>d.itemId===item.id&&d.status!=='rejected').map(d=>d.quantity));
   const q=quantity(input.quantity),rate=input.unitPrice===''||input.unitPrice===undefined?BigInt(item.unitPrice):money(input.unitPrice);
   result.item={id:item.id,title:item.title,unit:item.unit,billed:String(billed),delivered:String(delivered),before:{quantity:String(item.quantity),unitPrice:String(item.unitPrice),dueDate:item.dueDate},after:q!==null&&rate!==null?{quantity:String(q),unitPrice:String(rate),dueDate:date(input.dueDate)?input.dueDate:null,unbilled:String(q-billed)}:null};
   if(q===null)add('quantity','مقدار مثبت با حداکثر سه رقم اعشار لازم است.');
   else if(q<delivered||q<billed)add('quantity','مقدار جدید نمی‌تواند کمتر از تحویل غیرردشده یا کارکرد صورت‌وضعیت‌شده باشد.');
   if(rate===null)add('unitPrice','نرخ صحیح و نامنفی ریالی لازم است؛ خالی یعنی حفظ نرخ جاری.');
   if(!date(input.dueDate))add('dueDate','موعد جدید معتبر برای قلم منتخب لازم است.');
   if(q!==null&&rate!==null&&q>=billed){
    if(((q-billed)*rate+500n)/1000n>maximum)add('unitPrice','ارزش کارکرد آینده خارج از محدوده امن است.');
    Object.assign(next.items.find(i=>i.id===item.id),{quantity:Number(q),unitPrice:Number(rate),dueDate:input.dueDate});
   }
  }
 }
 const allocated=sum(next.milestones.map(m=>m.gross));
 if(allocated>maximum)add(stage?'gross':'effectiveAmount','جمع سقف مراحل خارج از محدوده امن است.');
 if(amount!==null&&amount<allocated)add('effectiveAmount','مبلغ جدید کمتر از مجموع سقف مراحل است.');
 if(errors.length)return result;
 result.after=executionPreparation(next);
 for(const m of result.after.stages){
  if(BigInt(m.committed)>maximum)add(item?.milestoneId===m.id?'unitPrice':'gross','ارزش اقلام و کارکرد ثبت‌شده خارج از محدوده امن است.');
  if(BigInt(m.remaining)<0n)add(stage?.id===m.id?'gross':item?.milestoneId===m.id?'unitPrice':'effectiveAmount','ارزش اقلام و کارکرد ثبت‌شده از سقف جدید مرحله بیشتر است.');
 }
 result.stages=result.after.stages.filter(m=>stageIds.has(m.id)).map(m=>({id:m.id,title:m.title,before:before.stages.find(b=>b.id===m.id),after:m}));
 return result;
}
