// Suggestions only. A number in text never grants access or publishes a limit.
export const serviceLimitLabels={requestsPerSecond:'سقف TPS',burstCapacity:'ظرفیت burst',monthlyRequests:'سهمیه ماهانه'};
const normalize=s=>s.replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/٬|,(?=\d{3}(?:\D|$))/g,'').replace(/٫/g,'.');
const number='([0-9]+(?:\\.[0-9]+)?)';
const patterns=[
 ['requestsPerSecond',new RegExp('(?:\\bTPS\\b|تراکنش\\s*(?:در|بر)\\s*ثانیه|درخواست\\s*(?:در|بر)\\s*ثانیه)\\s*(?:[:=：]|حداکثر|برابر(?: با)?)?\\s*'+number,'ig')],
 ['requestsPerSecond',new RegExp(number+'\\s*(?:\\bTPS\\b|تراکنش\\s*(?:در|بر)\\s*ثانیه|درخواست\\s*(?:در|بر)\\s*ثانیه)','ig')],
 ['burstCapacity',new RegExp('(?:\\bburst(?: capacity)?\\b|ظرفیت\\s*برست)\\s*(?:[:=：]|برابر(?: با)?)?\\s*'+number,'ig')],
 ['monthlyRequests',new RegExp('(?:سهمیه\\s*ماهانه|\\bmonthly quota\\b)\\s*(?:[:=：]|برابر(?: با)?)?\\s*'+number,'ig')]
];
export function extractServiceLimits(document){
 if(typeof document!=='string'||document.length>500000)throw Error('متن معتبر با حداکثر ۵۰۰ هزار نویسه لازم است.');
 const candidates=[];document.split(/\r?\n/).forEach((original,index)=>{
  const line=normalize(original);const seen=new Set();
  for(const [parameter,pattern] of patterns){pattern.lastIndex=0;for(const match of line.matchAll(pattern)){
   const value=Number(match[1]),key=parameter+':'+value;if(seen.has(key))continue;seen.add(key);
   const before=line.slice(Math.max(0,match.index-65),match.index),after=line.slice(match.index+match[0].length,match.index+match[0].length+40);
   const price=/قیمت|تعرفه|ریال|تومان|هزینه|price|cost/i.test(before+after);
   const ambiguous=/حداقل|هدف|نمونه|تخمین|تقریبی|پیشنهاد|به ازای|هر\s*$|minimum|target|example/i.test(before)||/\s*(?:تا|الی|[-–])\s*\d/.test(after)||/\d\s*(?:تا|الی|[-–])\s*$/.test(before);
   const valid=Number.isFinite(value)&&(parameter==='monthlyRequests'?value>=0:value>0)&&(parameter==='requestsPerSecond'?value<=1000000:Number.isSafeInteger(value));
   const warnings=[...(price?['این عبارت ممکن است قیمت باشد، نه سقف مصرف.']:[]),...(ambiguous?['این عبارت هدف، بازه یا مقدار غیرقطعی دارد.']:[]),...(!valid?['مقدار با پروفایل محدودیت سازگار نیست.']:[])];
   candidates.push({parameter,label:serviceLimitLabels[parameter],value,line:index+1,quote:original.slice(0,2000),status:warnings.length?'ambiguous':'needs-review',warnings});
  }}
 });
 for(const parameter of Object.keys(serviceLimitLabels)){const group=candidates.filter(c=>c.parameter===parameter);if(new Set(group.map(c=>c.value)).size>1)for(const c of group){c.status='ambiguous';c.warnings.push('چند مقدار متفاوت در متن وجود دارد؛ بند و سرویس درست را انتخاب کنید.');}}
 return {candidates,missing:Object.keys(serviceLimitLabels).filter(p=>!candidates.some(c=>c.parameter===p)),automaticPublication:false};
}
