const fields=['serviceKey','title','productKey','environment','operationGroup','requestsPerSecond','burstCapacity','monthlyRequests'];
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function serviceLimitAmendmentContext(contract,versionId){
 const versions=contract.serviceLimits?.versions||[],base=versions.find(v=>v.id===versionId);
 const latest=base&&versions.filter(v=>v.status==='signed'&&v.terms.serviceKey===base.terms.serviceKey).sort((a,b)=>a.version-b.version).at(-1);
 if(!latest||latest.id!==versionId)throw Error('اصلاحیه باید از آخرین نسخه امضاشده همین سرویس آماده شود؛ ظرفیت را بازخوانی کنید.');
 if(versions.some(v=>v.status==='draft'&&v.terms.serviceKey===base.terms.serviceKey))throw Error('ابتدا پیش‌نویس باز همین سرویس را تعیین تکلیف کنید.');
 return {base:structuredClone(base),amendments:(contract.amendments||[]).filter(a=>['approved','signed'].includes(a.status)&&a.id!==base.terms.source.amendmentId),candidateVersion:versions.length+1};
}
export function serviceLimitAmendmentSeed(contract,versionId,amendmentId){
 const {base,amendments,candidateVersion}=serviceLimitAmendmentContext(contract,versionId);
 if(!amendments.some(a=>a.id===amendmentId))throw Error('الحاقیه تازه تأییدشده یا امضاشده لازم است؛ منبع نسخه قبلی قابل استفاده نیست.');
 // No prior dates, evidence, signature, receipt or central allocation revision is inherited.
 return {base,terms:structuredClone(Object.fromEntries(fields.map(key=>[key,base.terms[key]]))),sourceInput:{sourceKind:'amendment',amendmentId},candidateVersion};
}
export function serviceLimitAmendmentIssues(base,values){
 const errors=[],add=(field,message)=>errors.push({field,message});
 for(const field of ['validFrom','validTo','effectiveAt'])if(!iso(values[field]))add(field,'زمان معتبر برای اصلاحیه تازه لازم است.');
 if(!errors.length){
  if(values.validFrom>values.effectiveAt)add('validFrom','شروع اعتبار باید پیش از زمان اثر یا برابر آن باشد.');
  if(values.effectiveAt<=base.terms.effectiveAt)add('effectiveAt','زمان اثر اصلاحیه باید بعد از آخرین نسخه امضاشده همین سرویس باشد.');
  if(values.validTo<=values.effectiveAt)add('validTo','پایان اعتبار باید بعد از زمان اثر باشد.');
 }
 for(const field of ['serviceKey','productKey','environment','operationGroup'])if(values[field]!==base.terms[field])add(field,'هویت و محدوده تخصیص سرویس در اصلاح ظرفیت باید ثابت بماند.');
 const number=(key,valid,message)=>{const raw=values[key],n=typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;if(!valid(n))add(key,message);};
 number('requestsPerSecond',n=>Number.isFinite(n)&&n>0&&n<=1000000,'TPS باید مثبت و حداکثر یک میلیون باشد.');
 number('burstCapacity',n=>Number.isSafeInteger(n)&&n>0,'ظرفیت burst باید عدد صحیح مثبت و در محدوده امن باشد.');
 number('monthlyRequests',n=>Number.isSafeInteger(n)&&n>=0,'سهمیه ماهانه باید عدد صحیح نامنفی و در محدوده امن باشد؛ صفر یعنی منع مصرف.');
 return errors;
}
