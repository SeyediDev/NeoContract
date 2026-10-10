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
const normalize=s=>s.replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/٬|,(?=\d{3}(?:\D|$))/g,'').replace(/٫/g,'.');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function extractContractParameters(document,definitions){
 const candidates=[];
 document.split(/\r?\n/).forEach((quote,i)=>{for(const d of definitions.filter(d=>!d.archived)){
  const names=[d.label,...d.aliases].map(escape).sort((a,b)=>b.length-a.length);
  const match=normalize(quote).match(new RegExp('(?:'+names.join('|')+')\\s*[:=：]\\s*([^؛;]+)','i'));if(!match)continue;
  const raw=match[1].trim();let value=null;
  if(['number','integer'].includes(d.type)){const n=raw.match(/^([0-9]+(?:\.[0-9]+)?)(?:\s|%|$)/);if(n)value=Number(n[1]);}
  else if(d.type==='boolean'){if(/^(بله|فعال|true|yes)$/i.test(raw))value=true;else if(/^(خیر|غیرفعال|false|no)$/i.test(raw))value=false;}
  else if(d.type==='list')value=raw.split(/[,،]/).map(s=>s.trim()).filter(Boolean);
  else value=raw;
  const ambiguous=value===null||/حداقل|هدف|نمونه|تقریبی|example|target/i.test(quote)||['number','integer'].includes(d.type)&&/\d\s*(?:تا|الی|[-–])\s*\d/.test(raw);
  candidates.push({key:d.key,label:d.label,definitionRevision:d.revision,value,quote:quote.slice(0,4000),line:i+1,status:ambiguous?'ambiguous':'needs-review'});
 }});
 for(const c of candidates)if(new Set(candidates.filter(x=>x.key===c.key).map(x=>JSON.stringify(x.value))).size>1)c.status='ambiguous';
 return {candidates,automaticPublication:false};
}
