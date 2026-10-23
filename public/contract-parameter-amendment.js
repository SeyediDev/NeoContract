import {compareParameterValues} from './contract-parameter-impact.js';
import {parameterTypes} from './contract-parameter-model.js';
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const civil=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function parameterAmendmentContext(contract,id){
 const versions=contract.parameters?.versions||[],base=versions.filter(v=>v.status==='signed').sort((a,b)=>a.version-b.version).at(-1);
 if(!base||base.id!==id)throw Error('اصلاحیه باید از آخرین نسخه امضاشده پارامترها آماده شود؛ پرونده را بازخوانی کنید.');
 if(versions.some(v=>v.status==='draft'))throw Error('ابتدا پیش‌نویس باز پارامترها را تعیین تکلیف کنید.');
 return {base:structuredClone(base),version:versions.length+1,amendments:(contract.amendments||[]).filter(a=>['approved','signed'].includes(a.status)&&a.id!==base.source.id)};
}
export function parameterAmendmentSeed(contract,id,amendmentId){
 const context=parameterAmendmentContext(contract,id);
 if(!context.amendments.some(a=>a.id===amendmentId))throw Error('الحاقیه تازه تأییدشده یا امضاشده لازم است؛ منبع نسخه پایه قابل استفاده نیست.');
 return {base:context.base,version:context.version,sourceInput:{sourceKind:'amendment',amendmentId}};
}
export function parameterInputValue(def,raw,{emptyList=false}={}){
 const require=(ok,message)=>{if(!ok)throw Error(message);};
 require(def&&!def.archived&&Object.hasOwn(parameterTypes,def.type),'تعریف فعال پارامتر لازم است.');
 if(def.type==='list'&&emptyList)return [];
 require(typeof raw==='string'&&raw.trim()!=='','مقدار مستند را وارد کنید.');
 if(['number','integer'].includes(def.type)){
  const n=Number(raw);require(Number.isFinite(n)&&(def.type!=='integer'||Number.isSafeInteger(n))&&(def.min==null||n>=def.min)&&(def.max==null||n<=def.max),'مقدار با نوع یا حدود پارامتر سازگار نیست.');return n;
 }
 if(def.type==='boolean'){require(['true','false'].includes(raw),'بله یا خیر را انتخاب کنید.');return raw==='true';}
 if(def.type==='enum'){require(def.options.includes(raw),'گزینه معتبر از تعریف جاری لازم است.');return raw;}
 if(def.type==='date'){require(civil(raw),'روز معتبر لازم است.');return raw;}
 if(def.type==='list'){
  const values=raw.split(/[,،]/).map(v=>v.trim()).filter(Boolean);
  require(values.length>0&&values.length<=64&&values.every(v=>v.length<=200)&&new Set(values).size===values.length,'فهرست معتبر و بدون تکرار لازم است؛ فهرست خالی را صریح انتخاب کنید.');return values;
 }
 require(raw.length<=2000,'متن حداکثر ۲۰۰۰ نویسه مجاز است.');return raw;
}
export function parameterAmendmentPreview({base,version,definitions,entries,dates,sourceDocument}){
 const issues=[],add=(field,message,row)=>issues.push({field,message,...(row===undefined?{}:{row})});
 for(const field of ['validFrom','validTo','effectiveAt'])if(!iso(dates[field]))add(field,'زمان معتبر تازه برای اصلاحیه لازم است.');
 if(!issues.length){
  if(dates.validFrom>dates.effectiveAt)add('validFrom','شروع اعتبار باید پیش از زمان اثر یا برابر آن باشد.');
  if(dates.effectiveAt<=base.effectiveAt)add('effectiveAt','زمان اثر باید بعد از آخرین نسخه امضاشده پارامترها باشد.');
  if(dates.validTo<=dates.effectiveAt)add('validTo','پایان اعتبار غیرشامل باید بعد از زمان اثر باشد.');
 }
 if(!entries.length||entries.length>64)add('values','یک تا ۶۴ ردیف تغییر مستند لازم است.');
 const values=new Map(base.values.map(v=>[v.key,structuredClone(v)])),changed=[],seen=new Set();
 entries.forEach((entry,row)=>{
  const def=definitions.find(d=>d.key===entry.key&&!d.archived);
  if(!def){add('parameterKey','پارامتر فعال را انتخاب کنید.',row);return;}
  if(seen.has(entry.key)){add('parameterKey','هر پارامتر فقط یک ردیف تغییر دارد.',row);return;}seen.add(entry.key);
  let value;try{value=parameterInputValue(def,entry.raw,{emptyList:entry.emptyList===true});}catch(error){add('parameterValue',error.message,row);return;}
  const quote=typeof entry.quote==='string'?entry.quote.trim():'';
  if(!quote||quote.length>4000||!sourceDocument.includes(quote)){add('parameterQuote','بند دقیق و موجود در منبع تازه لازم است.',row);return;}
  changed.push({key:def.key,value,definitionRevision:def.revision,clauseQuote:quote});
  values.set(def.key,{key:def.key,value:structuredClone(value),definition:structuredClone(def),source:{clauseQuote:quote}});
 });
 if(values.size>64)add('values','حداکثر ۶۴ پارامتر در نسخه نهایی مجاز است.');
 if(issues.length)return {issues};
 const candidate={version,status:'draft',...dates,values:[...values.values()]};
 return {issues,changed,candidate,comparison:{previous:base,status:'draft',changes:compareParameterValues(base,candidate)}};
}
