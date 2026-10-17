const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function economicAmendmentContext(contract,versionId){
 const versions=contract.economics?.versions||[],latest=versions.filter(v=>v.status==='signed').sort((a,b)=>a.version-b.version).at(-1);
 if(!latest||latest.id!==versionId)throw Error('اصلاحیه باید از آخرین نسخه امضاشده آماده شود؛ اقتصاد قرارداد را بازخوانی کنید.');
 if(versions.some(v=>v.status==='draft'))throw Error('ابتدا پیش‌نویس باز اقتصاد قرارداد را تعیین تکلیف کنید.');
 const amendments=(contract.amendments||[]).filter(a=>['approved','signed'].includes(a.status)&&a.id!==latest.source.id);
 return {base:structuredClone(latest),amendments};
}
export function economicAmendmentSeed(contract,versionId,amendmentId){
 const {base,amendments}=economicAmendmentContext(contract,versionId);
 if(!amendments.some(a=>a.id===amendmentId))throw Error('الحاقیه تازه تأییدشده یا امضاشده لازم است؛ منبع نسخه قبلی قابل استفاده نیست.');
 // Only commercial terms are inherited. Dates, source evidence and signatures are entered afresh.
 const {serviceKey,actors,revenueBase,periodDays,holdDays,minimumPayout,disputePolicy,customerCredit}=base.terms;
 return {base,terms:structuredClone({serviceKey,actors,revenueBase,periodDays,holdDays,minimumPayout,disputePolicy,customerCredit}),sourceKind:'amendment',amendmentId};
}
export function economicAmendmentIssues(base,values){
 const errors=[],add=(field,message)=>errors.push({field,message});
 for(const field of ['validFrom','validTo','effectiveAt','anchor'])if(!iso(values[field]))add(field,'زمان معتبر برای اصلاحیه تازه لازم است.');
 if(errors.length)return errors;
 if(values.validFrom>values.effectiveAt)add('validFrom','شروع اعتبار باید پیش از زمان اثر یا برابر آن باشد.');
 if(values.effectiveAt<=base.effectiveAt)add('effectiveAt','زمان اثر اصلاحیه باید بعد از آخرین نسخه امضاشده باشد.');
 if(values.validTo<=values.effectiveAt)add('validTo','پایان اعتبار باید بعد از زمان اثر باشد.');
 if(values.anchor<values.effectiveAt||values.anchor>=values.validTo)add('anchor','مبدأ تسویه باید از زمان اثر تا پیش از پایان اعتبار باشد.');
 return errors;
}
