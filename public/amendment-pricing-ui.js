import {pricingDocument} from './pricing.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=v=>new Intl.NumberFormat('fa-IR').format(v);
const labels={proposal:'جمع آخرین پیشنهاد ثبت‌شده',contract_pricing:'جمع مدل زمان ایجاد قرارداد',contract_amount:'مبلغ مبنای قرارداد',unknown:'مبنای مالی ثبت نشده'};
export function amendmentFinancialHtml(financial){
 if(!financial)return '';
 const {basis,after,comparison,sourcePlan}=financial;
 const difference=comparison?comparison.delta===0?'بدون تغییر':`${comparison.delta>0?'افزایش':'کاهش'} ${nf(Math.abs(comparison.delta))} ریال`:'قابل محاسبه نیست؛ مبنا ثبت نشده';
 return `<section class="pricing-captured amendment-financial" data-amendment-financial aria-label="پیوست مالی الحاقیه"><h3>پیوست مالی پیشنهادی · ${esc(after.name)}</h3><p>نسخه ${nf(sourcePlan.revision)} مدل ذخیره‌شده؛ نرخ‌ها و فرمول‌های این پیوست ثابت می‌مانند.</p><dl class="pricing-impact-totals"><div><dt>${labels[basis.kind]}</dt><dd data-amendment-before>${basis.amount===null?'تعیین نشده':nf(basis.amount)+' ریال'}</dd></div><div><dt>جمع مدل پیشنهادی</dt><dd data-amendment-after>${nf(after.total)} ریال</dd></div><div><dt>تفاوت جمع</dt><dd data-amendment-delta>${difference}</dd></div></dl>${comparison&&basis.pricing?`<p>${nf(comparison.bases.length)} نرخ و ${nf(comparison.items.length)} آیتم تغییر کرده است.</p>`:''}<p class="field-hint">دوره، مالیات و دامنه را در نرخ‌ها و آیتم‌ها بازبینی کنید. این جمع به معنای مبلغ توافق‌شده یا اجرای تغییر نیست.</p><details><summary>نرخ‌ها و فرمول‌های پیشنهادی</summary><pre class="document-paper">${esc(pricingDocument(after))}</pre></details>${basis.pricing?`<details><summary>نرخ‌ها و فرمول‌های مبنا</summary><pre class="document-paper">${esc(pricingDocument(basis.pricing))}</pre></details>`:''}</section>`;
}
