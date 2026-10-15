const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function serviceLimitJourney(version,row){
 const signed=version?.status==='signed',accepted=['pending','acknowledged'].includes(row?.receipt?.phase),observed=row?.status==='acknowledged'&&row?.receipt?.phase==='acknowledged',superseded=row?.receipt?.phase==='superseded';
 const steps=[
  {title:'مدرک امضا',description:signed?'مبنای تغییر ثبت شده':'نیازمند مدرک طرفین',state:signed?'done':'current'},
  {title:'ثبت تغییر',description:row?'نسخه و رویداد محفوظ‌اند':'پس از ثبت امضا',state:row?'done':signed?'current':'waiting'},
  {title:'پذیرش مرکز',description:superseded?'نسخه جدیدتری در مرکز است':accepted?'پذیرش این رویداد ثبت شده':'در انتظار پذیرش نسخه',state:superseded?'blocked':accepted?'done':row?'current':'waiting'},
  {title:'مشاهده مقصد',description:observed?'مشاهده این نسخه ثبت شده':'در انتظار رسید Gateway',state:observed?'done':accepted?'current':'waiting'}
 ];
 return {steps,complete:steps.filter(s=>s.state==='done').length};
}
export function renderServiceLimitJourney(version,row){
 const {steps,complete}=serviceLimitJourney(version,row),number=v=>new Intl.NumberFormat('fa-IR').format(v);
 return `<section class="delivery-journey" aria-label="مسیر اتصال قرارداد"><div class="delivery-journey-heading"><strong>از قرارداد تا اجرای سرویس</strong><span>${number(complete)} از ${number(steps.length)} مرحله</span></div><progress value="${complete}" max="4" aria-label="مراحل تأییدشده اتصال"></progress><ol>${steps.map((s,i)=>`<li class="journey-${s.state}" ${s.state==='current'?'aria-current="step"':''}><span class="journey-number" aria-hidden="true">${s.state==='done'?'✓':number(i+1)}</span><div><strong>${esc(s.title)}</strong><small>${esc(s.description)}</small></div></li>`).join('')}</ol></section>`;
}
