// Contractual applicability only. No target policy or financial entry is applied here.
export const parameterImpactLabels={draft:'پیش‌نویس؛ بدون اثر اجرایی',cancelled:'پیش‌نویس لغوشده',scheduled:'امضاشده؛ منتظر تاریخ اثر',current:'نسخه مؤثر قراردادی',superseded:'با نسخه جدیدتر جایگزین شده',expired:'اعتبار نسخه پایان یافته',paused:'اجرای قرارداد متوقف است',closed:'اجرای قرارداد خاتمه یافته',inactive:'اجرای قرارداد آغاز نشده',unsigned:'نسخه امضاشده‌ای ثبت نشده است'};
export function compareParameterValues(previous,version){
 const before=new Map((previous?.values||[]).map(p=>[p.key,p])),after=new Map(version.values.map(p=>[p.key,p]));
 return [...new Set([...after.keys(),...before.keys()])].map(key=>{
  const a=before.get(key),b=after.get(key);
  const definitionChanged=!!a&&!!b&&['label','type','unit','target','revision'].some(k=>a.definition[k]!==b.definition[k]);
  const valueChanged=!!a&&!!b&&JSON.stringify(a.value)!==JSON.stringify(b.value);
  const direction=!a?'added':!b?'removed':definitionChanged?'definition':!valueChanged?'unchanged':typeof a.value==='number'&&typeof b.value==='number'?(b.value>a.value?'increased':'decreased'):'changed';
  return {key,before:a||null,after:b||null,definitionChanged,valueChanged,direction};
 });
}
export function contractParameterImpact(data,{now=new Date().toISOString()}={}){
 const all=[...(data.versions||[])].sort((a,b)=>a.version-b.version),signed=all.filter(v=>v.status==='signed');
 const latest=signed.filter(v=>v.effectiveAt<=now).at(-1);
 const effective=latest&&latest.validFrom<=now&&now<latest.validTo?latest:null;
 const versions=new Map();let previous=null;
 for(const v of all){
  let status=v.status;
  if(v.status==='signed')status=v.effectiveAt>now?'scheduled':v.id!==latest?.id?'superseded':!effective?'expired':data.executionStatus==='running'?'current':data.executionStatus==='paused'?'paused':data.executionStatus==='closed'?'closed':'inactive';
  versions.set(v.id,{status,previous,changes:compareParameterValues(previous,v)});
  if(v.status==='signed')previous=v;
 }
 const next=signed.find(v=>v.effectiveAt>now)||null;
 return {asOf:now,current:data.executionStatus==='running'?effective:null,next,versions,status:latest?versions.get(latest.id).status:next?'scheduled':'unsigned'};
}
