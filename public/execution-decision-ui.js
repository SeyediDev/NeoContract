import {executionQuantityText} from './execution-finance.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('fa-IR');
const money=v=>nf.format(BigInt(v))+' ریال';
const statuses={submitted:'در انتظار بررسی',approved:'تأیید مالی',disputed:'اختلاف مالی باز',rejected:'ردشده',cancelled:'باطل‌شده'};
const actions={'invoice-approve':'تأیید مالی','invoice-reject':'رد صورت‌وضعیت','invoice-dispute':'ثبت اختلاف مالی','invoice-resolve':'رفع اختلاف مالی','invoice-cancel':'ابطال صورت‌وضعیت'};
const kinds={advance:'پیش‌پرداخت',progress:'پیشرفت',final:'نهایی',retention:'آزادسازی سپرده'};
const status=v=>statuses[v]||v||'—';
const day=value=>{const date=new Date(value);return value&&!Number.isNaN(+date)?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(date):'—';};

export function renderExecutionDecisionHistory(invoice){
 return invoice.decisions?.length?`<details class="execution-decision-history"><summary>سوابق تصمیم مالی · ${nf.format(invoice.decisions.length)}</summary><ol>${invoice.decisions.map(d=>`<li><p>${esc(actions[d.action]||d.action)} · ${esc(day(d.at))}</p><p>مرجع تصمیم: ${esc(d.reference)} · ${esc(d.comment)}</p></li>`).join('')}</ol></details>`:'';
}

export function renderExecutionDecisionPreview(r){
 const i=r.invoice;
 if(!i)return `<h4>بازبینی تصمیم مالی</h4><p>${esc(r.errors.join(' '))}</p>`;
 const permission=v=>v===undefined?'—':v?'پس از کنترل نقش، مدرک و نسخه ممکن است':'در دسترس نیست';
 const rows=[['وضعیت سند',status(r.before?.status),status(r.after?.status)],['ثبت رسید مثبت تا مانده سند',permission(r.before?.paymentAvailable),permission(r.after?.paymentAvailable)]];
 const comparison=`<div class="execution-change-table" tabindex="0" role="region" aria-label="مقایسه تصمیم مالی"><table><caption>اثر تصمیم بر همین صورت‌وضعیت</caption><thead><tr><th scope="col">موضوع</th><th scope="col">پیش از تصمیم</th><th scope="col">پس از تصمیم</th></tr></thead><tbody>${rows.map(([label,before,after])=>`<tr><th scope="row">${esc(label)}</th><td data-label="پیش از تصمیم">${esc(before)}</td><td data-label="پس از تصمیم">${esc(after)}</td></tr>`).join('')}</tbody></table></div>`;
 const amounts=[['ناخالص',i.gross],['مالیات افزوده',i.tax],['سپرده حسن انجام',i.retention],['مالیات تکلیفی',i.withholding],['کسور بیمه',i.insurance],['جریمه توافق‌شده',i.penalty],['بازیافت پیش‌پرداخت',i.advanceRecovery],['خالص سند',i.net],['رسیدهای مؤثر',r.financial?.paid],['رسیدهای برگشتی',r.financial?.reversed],['مانده سند',r.financial?.remaining]];
 return `<h4>بازبینی ${esc(actions[r.action])}</h4><p><strong>شماره صورت‌وضعیت: ${esc(i.number)}</strong> · ${esc(kinds[i.kind]||i.kind)} · سررسید: ${esc(day(i.dueDate+'T12:00:00Z'))}</p><p>جهت مالی: ${r.direction==='receivable'?'دریافت از مشتری':r.direction==='payable'?'پرداخت به طرف قرارداد':'نامشخص'}</p><p>مرجع اصلی سند: ${esc(i.reference)}</p><p>مبنای مالیات و کسورات: ${esc(i.basis||'مبنایی ثبت نشده است.')}</p>${comparison}<dl class="execution-finance-preview">${amounts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${value==null?'—':esc(money(value))}</dd></div>`).join('')}</dl>${i.lines.length?`<details class="execution-decision-history"><summary>ردیف‌های ثبت‌شده سند · ${nf.format(i.lines.length)}</summary><ul>${i.lines.map(l=>`<li>${esc(l.title)} · مقدار ${esc(executionQuantityText(l.quantity))} × ${esc(money(l.unitPrice))} = ${esc(money(l.amount))}</li>`).join('')}</ul></details>`:''}${renderExecutionDecisionHistory(i)}${r.errors.length?`<ul class="execution-finance-errors">${r.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:''}<p>${r.action==='invoice-reject'?'رد سند، رزرو مقدار اقلام و مبالغ این صورت‌وضعیت را از ظرفیت جاری خارج می‌کند؛ سند و شماره آن محفوظ‌اند و جایگزین، شماره تازه و بررسی مستقل لازم دارد.':r.action==='invoice-dispute'?'اختلاف مالی، ثبت رسید و تسویه کسورات تازه برای همین سند را متوقف می‌کند؛ رسیدها و مجوزهای قبلی خودکار برگشت یا باطل نمی‌شوند.':r.action==='invoice-resolve'?'رفع اختلاف، همین سند را به تأیید مالی برمی‌گرداند؛ پرداخت خودکار انجام نمی‌شود و فقط مانده قابل ثبت، با نقش و مدرک مستقل قابل پیگیری است.':'تأیید مالی، سند را برای مراحل مالی بعدی آماده می‌کند؛ دریافت یا پرداخت وجه ایجاد نمی‌کند.'} مبلغ، نرخ و ردیف‌های تاریخی سند تغییر نمی‌کنند. این تصمیم، رسیدگی به ریسک عمومی قرارداد، امضای مشتری یا تأیید بانک نیست. مرجع و شرح تصمیم مستقل از مرجع اصلی وارد می‌شوند؛ کنترل نهایی نقش، نسخه و شرایط با سرور است.</p>`;
}
