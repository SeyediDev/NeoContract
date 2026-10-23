// Contract metadata only: targets describe intended use and never confer authority.
export const parameterTargets={gateway:'کنترل مصرف API',access:'دسترسی و امکانات',product:'محدودیت داخل محصول',operations:'SLA و عملیات',finance:'مالی و قیمت',commercial:'شرط تجاری'};
export const parameterTypes={number:'عدد',integer:'عدد صحیح',boolean:'بله / خیر',text:'متن',list:'فهرست',enum:'گزینه',date:'تاریخ'};
const builtin=(key,label,type,unit,target,min=null,max=null,aliases=[])=>({key,label,type,unit,target,min,max,aliases:[label,key,...aliases],options:[],revision:1,builtin:true,archived:false});
export const builtInParameters=[
 builtin('concurrent-requests','حداکثر درخواست هم‌زمان','integer','درخواست در حال اجرا','gateway',0,null,['concurrency']),
 builtin('daily-requests','سهمیه روزانه','integer','درخواست پذیرفته‌شده / روز','gateway',0),
 builtin('active-users','حداکثر کاربران فعال','integer','عضویت فعال','access',0,1000000,['seats']),
 builtin('allowed-features','امکانات مجاز','list','کلید قابلیت','access'),
 builtin('eligible-roles','نقش‌های مجاز قراردادی','list','کلید نقش','access'),
 builtin('allowed-zones','مناطق مجاز استقرار','list','کلید منطقه','access'),
 builtin('storage-gb','ظرفیت ذخیره‌سازی','number','GB','product',0),
 builtin('cpu-cores','تعداد هسته پردازشی','number','vCPU','product',0),
 builtin('memory-gb','حافظه','number','GB','product',0),
 builtin('egress-gb','ترافیک خروجی ماهانه','number','GB / ماه','product',0),
 builtin('monthly-budget','سقف بودجه ماهانه','number','IRR / ماه','finance',0),
 builtin('unit-price','قیمت واحد','number','IRR / واحد','finance',0),
 builtin('availability-percent','دسترس‌پذیری SLA','number','درصد','operations',0,100,['availability']),
 builtin('response-time-ms','زمان پاسخ سرویس','integer','میلی‌ثانیه','operations',0),
 builtin('support-response-minutes','زمان پاسخ پشتیبانی','integer','دقیقه','operations',0),
 builtin('rpo-minutes','نقطه بازیابی RPO','integer','دقیقه','operations',0,null,['RPO']),
 builtin('rto-minutes','زمان بازیابی RTO','integer','دقیقه','operations',0,null,['RTO']),
 builtin('data-retention-days','مدت نگهداری داده','integer','روز','operations',0),
 builtin('payment-period-days','مهلت پرداخت','integer','روز','finance',0),
 builtin('retention-percent','درصد سپرده','number','درصد','finance',0,100),
 builtin('penalty-cap-percent','سقف جریمه','number','درصد','finance',0,100),
 builtin('auto-renew','تمدید خودکار','boolean','بله / خیر','commercial'),
 builtin('renewal-period-days','دوره تمدید','integer','روز','commercial',1),
 builtin('termination-notice-days','مهلت اعلام خاتمه','integer','روز','commercial',0),
 builtin('data-region','محل نگهداری داده','text','منطقه','commercial'),
 builtin('special-condition','شرط اختصاصی','text','متن','commercial')
];
const normalize=s=>s.replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/٫/g,'.');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function extractedNumber(raw,definition){
 raw=normalize(raw);
 // Validate the whole numeric token before removing grouping separators.
 const token=raw.match(/^([+-]?(?:\d{1,3}(?:[,٬]\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s|%|٪|$)/);
 if(!token)return null;
 const suffix=raw.slice(token[0].length).trim(),unit=normalize(definition.unit||'');
 // An alternative, formula, condition, or another amount needs human interpretation.
 if(suffix!==unit&&(/[0-9=<>≤≥+*/−–—-]|(?:^|\s)(?:یا|تا|الی|اگر|مشروط|حداقل|حداکثر|بین|or|to|if|and)(?:\s|$)/i.test(suffix)))return null;
 const value=Number(token[1].replace(/[,٬]/g,''));
 if(!Number.isFinite(value)||(value===0&&/[1-9]/.test(token[1].split(/[eE]/)[0]))||(Number.isInteger(value)&&!Number.isSafeInteger(value))||definition.type==='integer'&&!Number.isSafeInteger(value)||(definition.min!=null&&value<definition.min)||(definition.max!=null&&value>definition.max))return null;
 return value;
}
export function extractContractParameters(document,definitions){
 const candidates=[];
 document.split(/\r?\n/).forEach((quote,i)=>{for(const d of definitions.filter(d=>!d.archived)){
  const names=[...new Set([d.label,...d.aliases])].map(escape).sort((a,b)=>b.length-a.length);
  const matches=quote.matchAll(new RegExp('(?<![\\p{L}\\p{N}_‌.\\-])(?:'+names.join('|')+')\\s*[:=：]\\s*([^؛;]+)','giu'));
  for(const match of matches){
  const raw=match[1].trim();let value=null;
  if(['number','integer'].includes(d.type))value=extractedNumber(raw,d);
  else if(d.type==='boolean'){if(/^(بله|فعال|true|yes)$/i.test(raw))value=true;else if(/^(خیر|غیرفعال|false|no)$/i.test(raw))value=false;}
  else if(d.type==='list')value=raw.split(/[,،]/).map(s=>s.trim()).filter(Boolean);
  else if(d.type==='date')value=normalize(raw);
  else value=raw;
  const ambiguous=value===null||/حداقل|هدف|نمونه|تقریبی|example|target/i.test(quote);
  candidates.push({key:d.key,label:d.label,definitionRevision:d.revision,value:ambiguous?null:value,quote:quote.slice(0,4000),line:i+1,status:ambiguous?'ambiguous':'needs-review'});
 }}});
 for(const c of candidates){const related=candidates.filter(x=>x.key===c.key);if(related.some(x=>x.status==='ambiguous')||new Set(related.map(x=>JSON.stringify(x.value))).size>1)c.status='ambiguous';}
 return {candidates,automaticPublication:false};
}
