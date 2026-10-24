// Read-only quantities in thousandths; historical invoice lines remain untouched.
const sum=rows=>rows.reduce((n,v)=>n+BigInt(v),0n);
const live=i=>!['rejected','cancelled'].includes(i.status);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const quantity=v=>{
 if(!/^\d{1,12}(\.\d{1,3})?$/.test(String(v??'')))return null;
 const [whole,fraction='']=String(v).split('.'),units=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));
 return units>0n?units:null;
};
export function executionDeliveryCapacity(s,itemId){
 const item=s.items.find(i=>i.id===itemId);if(!item)return null;
 const deliveries=s.deliveries.filter(d=>d.itemId===itemId),accepted=sum(deliveries.filter(d=>d.status==='accepted').map(d=>d.quantity)),pending=sum(deliveries.filter(d=>d.status==='submitted').map(d=>d.quantity));
 const rejected=sum(deliveries.filter(d=>d.status==='rejected').map(d=>d.quantity)),billed=sum(s.invoices.filter(live).flatMap(i=>i.lines||[]).filter(l=>l.itemId===itemId).map(l=>l.quantity));
 return {committed:String(item.quantity),accepted:String(accepted),pending:String(pending),rejected:String(rejected),billed:String(billed),remaining:String(BigInt(item.quantity)-accepted-pending),invoiceable:String(accepted-billed)};
}
export function executionDeliveryPreview(s,action,id,input={}){
 const errors=[],add=(field,message)=>errors.push({field,message}),delivery=action==='delivery'?null:s.deliveries.find(d=>d.id===id),item=s.items.find(i=>i.id===(action==='delivery'?id:delivery?.itemId));
 const result={action,errors,item:item?{...item}:null,delivery:delivery?structuredClone(delivery):null,before:item?executionDeliveryCapacity(s,item.id):null,after:null,quantity:null};
 if(!['delivery','accept','reject'].includes(action)){add('reference','نوع اقدام تحویل معتبر نیست.');return result;}
 if(s.status!=='running')add('reference','برای ثبت یا بررسی تحویل، اجرا باید در حال اجرا باشد.');
 if(!item||action!=='delivery'&&!delivery){add('reference','قلم یا تحویل در این اجرا یافت نشد.');return result;}
 if(action!=='delivery'&&delivery.status!=='submitted')add('reference','این تحویل قبلاً بررسی شده است؛ پرونده را بازخوانی کنید.');
 const q=action==='delivery'?quantity(input.quantity):BigInt(delivery.quantity);result.quantity=q===null?null:String(q);
 if(q===null)add('quantity','مقدار مثبت با حداکثر سه رقم اعشار لازم است.');
 if(action==='delivery'){
  if(q!==null&&q>BigInt(result.before.remaining))add('quantity','مقدار این تحویل از مانده تعهد قابل تحویل بیشتر است.');
  if(!date(input.deliveredAt))add('deliveredAt','تاریخ تحویل معتبر لازم است.');
 }
 if(errors.length)return result;
 const next=structuredClone(s);
 if(action==='delivery')next.deliveries.push({itemId:item.id,quantity:String(q),status:'submitted'});
 else next.deliveries.find(d=>d.id===id).status=action==='accept'?'accepted':'rejected';
 result.after=executionDeliveryCapacity(next,item.id);return result;
}
