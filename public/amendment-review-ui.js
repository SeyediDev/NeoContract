import {canReviewAmendment} from './permissions.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const amendmentDecisionLabels={submit:'ارسال برای بررسی',approve:'تأیید مرحله',reject:'رد الحاقیه',cancel:'لغو الحاقیه'};
export function amendmentReviewHtml(a,roles,date){
 const stage=a.workflow?.stage,decisions=a.workflow?.decisions||[];
 const actions=Object.keys(amendmentDecisionLabels).filter(k=>canReviewAmendment(roles,a,k));
 return '<section aria-label="بررسی داخلی الحاقیه" data-amendment-review><p class="notice-note">تأیید داخلی، امضای طرفین یا اعمال مفاد و مبلغ قرارداد نیست.</p>'+(stage?'<p>مرحله جاری: <strong>'+ (stage==='legal'?'بررسی حقوقی':'بررسی مالی')+'</strong></p>':'')+'<div class="document-actions">'+actions.map(k=>'<button type="button" class="btn btn-secondary" data-action="amendment-decision" data-id="'+esc(a.id)+'" data-decision="'+k+'">'+amendmentDecisionLabels[k]+'</button>').join('')+'</div>'+(decisions.length?'<h4>سابقه تصمیم‌ها</h4><ol class="amendment-decisions">'+decisions.map(d=>'<li><strong>'+esc(amendmentDecisionLabels[d.action]||d.action)+'</strong> · '+esc(d.stage==='legal'?'حقوقی':d.stage==='finance'?'مالی':'ثبت درخواست')+'<p>'+esc(d.actor?.name||d.actor?.email||'در سابقه ثبت نشده')+' · '+date(d.at)+'</p>'+(d.comment?'<p class="amendment-comment">'+esc(d.comment)+'</p>':'')+'</li>').join('')+'</ol>':'')+'</section>';
}
