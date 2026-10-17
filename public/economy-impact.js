import {percentParts} from './economy-model.js';
export const economyImpactLabels={draft:'پیش‌نویس؛ مبنای تسویه نیست',cancelled:'پیش‌نویس لغوشده',scheduled:'امضاشده؛ منتظر تاریخ اثر',current:'مبنای قراردادی جاری',superseded:'با نسخه جدیدتر جایگزین شده',expired:'اعتبار نسخه پایان یافته',paused:'اجرای قرارداد متوقف است',closed:'اجرای قرارداد خاتمه یافته',inactive:'اجرای قرارداد آغاز نشده',unsigned:'نسخه امضاشده‌ای ثبت نشده است'};
export function compareEconomicTerms(previous,version){
 const before=new Map((previous?.terms.actors||[]).map(a=>[a.key,a])),after=new Map(version.terms.actors.map(a=>[a.key,a]));
 const actors=[...new Set([...after.keys(),...before.keys()])].map(key=>{
  const a=before.get(key),b=after.get(key),delta=a&&b?percentParts(b.percent)-percentParts(a.percent):null;
  const metadataChanged=!!a&&!!b&&['name','role','agreementReference'].some(k=>a[k]!==b[k]);
  return {key,before:a||null,after:b||null,delta,metadataChanged,status:!a?'added':!b?'removed':delta!==0||metadataChanged?'changed':'unchanged'};
 });
 const fields=['serviceKey','revenueBase','periodDays','anchor','holdDays','minimumPayout','disputePolicy','customerCredit.enabled','customerCredit.fundingSource','customerCredit.ceiling','customerCredit.periodDays','customerCredit.reference'];
 const value=(terms,key)=>{if(!terms)return null;if(key.startsWith('customerCredit.'))return key==='customerCredit.enabled'?!!terms.customerCredit?.enabled:terms.customerCredit?.enabled?terms.customerCredit[key.split('.')[1]]:null;return terms[key];};
 const terms=fields.map(key=>{const a=value(previous?.terms,key),b=value(version.terms,key);return {key,before:a,after:b,changed:a!==b};});
 return {actors,terms,serviceChanged:!!previous&&previous.terms.serviceKey!==version.terms.serviceKey};
}
// Describes contractual snapshots only. Historical settlement proposals keep their terms.
export function economyImpact(data,{now=new Date().toISOString()}={}){
 const all=[...(data.versions||[])].sort((a,b)=>a.version-b.version),signed=all.filter(v=>v.status==='signed');
 const latest=signed.filter(v=>v.effectiveAt<=now).at(-1),effective=latest&&latest.validFrom<=now&&now<latest.validTo?latest:null;
 const versions=new Map();let previous=null;
 for(const v of all){
  const next=v.status==='signed'?signed.find(n=>n.effectiveAt>v.effectiveAt):null;
  let status=v.status;
  if(v.status==='signed')status=v.effectiveAt>now?'scheduled':v.id!==latest?.id?'superseded':!effective?'expired':data.executionStatus==='running'?'current':data.executionStatus==='paused'?'paused':data.executionStatus==='closed'?'closed':'inactive';
  const end=v.status==='signed'?(next&&next.effectiveAt<v.validTo?next.effectiveAt:v.validTo):null;
  const anchor=Date.parse(v.terms.anchor),duration=v.terms.periodDays*86400000,span=end?Date.parse(end)-anchor:0;
  const remainder=span>0&&span%duration!==0?{from:new Date(anchor+Math.floor(span/duration)*duration).toISOString(),to:end}:null;
  versions.set(v.id,{status,previous,next,end,remainder,noCompletePeriod:!!end&&span<duration,comparison:compareEconomicTerms(previous,v)});
  if(v.status==='signed')previous=v;
 }
 return {asOf:now,current:data.executionStatus==='running'?effective:null,next:signed.find(v=>v.effectiveAt>now)||null,versions,status:latest?versions.get(latest.id).status:signed.length?'scheduled':'unsigned'};
}
