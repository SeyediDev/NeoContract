import {demoServices,demoCalls,filterCalls,summarizeCalls,demoEnd} from './client-preview-model.js';
const nf=n=>new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1}).format(n);
const time=n=>new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit'}).format(n);
const date=n=>new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',month:'short',day:'numeric'}).format(n);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=key=>demoServices.find(s=>s.key===key).name;
const form=document.querySelector('#cp-filters'),dialog=document.querySelector('#cp-detail');
const size=8;let page=0,rows=[],timer;
function filters(){return Object.fromEntries(new FormData(form));}
function render(){
 rows=filterCalls(filters());const report=summarizeCalls(rows,filters());
 document.querySelector('#cp-match').textContent=`${nf(rows.length)} فراخوانی مطابق فیلتر`;
 document.querySelector('#cp-kpis').innerHTML=[['فراخوانی',nf(report.total),'در بازه و فیلتر انتخاب‌شده'],['نرخ خطا',report.errorRate===null?'—':nf(report.errorRate*100)+'٪',`${nf(report.errors)} پاسخ ۴xx / ۵xx`],['میانگین زمان پاسخ',report.average===null?'—':nf(report.average),'میلی‌ثانیه'],['صدک ۹۵ زمان پاسخ',report.p95===null?'—':nf(report.p95),'میلی‌ثانیه · داده نمونه']].map(([label,value,hint])=>`<article class="cp-kpi"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
 const points=report.timeline,max=Math.max(1,...points.map(p=>p.calls)),w=640,h=188,pad=18;
 // Hourly counts at bucket midpoints, chronological left-to-right.
 const x=i=>pad+(i+.5)*(w-2*pad)/points.length,y=n=>h-pad-n/max*(h-2*pad);
 const line=key=>points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
 document.querySelector('#cp-trend').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="روند ساعتی فراخوانی و خطا؛ جدول داده در ادامه"><defs><linearGradient id="cp-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--fanasa-lapis)" stop-opacity=".18"/><stop offset="100%" stop-color="var(--fanasa-lapis)" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(n=>`<line x1="${pad}" x2="${w-pad}" y1="${y(n*max)}" y2="${y(n*max)}" stroke="var(--line)" stroke-dasharray="4 6"/>`).join('')}<path d="${line('calls')} L${x(points.length-1)},${h-pad} L${x(0)},${h-pad} Z" fill="url(#cp-fill)"/><path d="${line('calls')}" fill="none" stroke="var(--primary)" stroke-width="3"/><path d="${line('errors')}" fill="none" stroke="var(--danger)" stroke-width="2"/>${points.length===1?`<circle cx="${x(0)}" cy="${y(points[0].calls)}" r="4" fill="var(--primary)"/><circle cx="${x(0)}" cy="${y(points[0].errors)}" r="3" fill="var(--danger)"/>`:''}</svg><div class="cp-axis"><span>${time(points[0].at)}</span><span>${time(demoEnd)}</span></div><details><summary>نمایش جدول داده نمودار</summary><div class="cp-table-wrap"><table><thead><tr><th>شروع ساعت · تهران</th><th>فراخوانی</th><th>خطا</th></tr></thead><tbody>${points.map(p=>`<tr><td>${date(p.at)} · ${time(p.at)}</td><td>${nf(p.calls)}</td><td>${nf(p.errors)}</td></tr>`).join('')}</tbody></table></div></details>`;
 document.querySelector('#cp-status').innerHTML=Object.entries(report.statusCounts).map(([code,count])=>`<div class="cp-status-row"><button type="button" class="cp-code ${Number(code)>=400?'cp-error':''}" data-status="${code}" aria-label="فیلتر پاسخ ${code}" dir="ltr">${code}</button><meter value="${count}" min="0" max="${Math.max(1,report.total)}" aria-label="تعداد پاسخ ${code}"></meter><span>${nf(count)} <small>(${nf(count/report.total*100)}٪)</small></span></div>`).join('')||'<p class="cp-empty">در این فیلتر پاسخی وجود ندارد.</p>';
 const peak=Math.max(1,...report.buckets.map(b=>b.count));
 document.querySelector('#cp-latency').innerHTML=`<div class="cp-buckets">${report.buckets.map(b=>`<div class="cp-bucket"><b>${nf(b.count)}</b><div class="cp-bar-track" aria-hidden="true"><div class="cp-bar" style="height:${b.count/peak*100}%"></div></div><span dir="ltr">${b.label}</span><small>میلی‌ثانیه</small></div>`).join('')}</div>`;
 renderTable();
}
function renderTable(){
 const chunk=rows.slice(page*size,(page+1)*size);
 document.querySelector('#cp-table').innerHTML=chunk.length?`<div class="cp-table-wrap"><table><thead><tr><th>زمان</th><th>سرویس و مسیر</th><th>پاسخ</th><th>زمان پاسخ</th><th>بررسی</th></tr></thead><tbody>${chunk.map(c=>`<tr><td>${time(c.at)}<small>${date(c.at)}</small></td><td><b>${name(c.service)}</b><span class="cp-path" dir="ltr">${c.method} ${c.path}</span></td><td><span class="cp-status-tag ${c.status>=400?'cp-error':''}" dir="ltr">${c.status}</span></td><td>${nf(c.duration)} ms</td><td><button type="button" class="cp-button" data-detail="${c.id}">ورودی و خروجی</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="cp-empty"><strong>فراخوانی مطابق فیلتر پیدا نشد</strong><p>بازه، سرویس یا عبارت جست‌وجو را تغییر دهید.</p></div>';
 document.querySelector('#cp-page-label').textContent=rows.length?`${nf(page*size+1)}–${nf(Math.min((page+1)*size,rows.length))} از ${nf(rows.length)}`:'۰ فراخوانی';
 document.querySelector('#cp-prev').disabled=page===0;document.querySelector('#cp-next').disabled=(page+1)*size>=rows.length;
}
function refresh(){clearTimeout(timer);page=0;render();}
form.addEventListener('submit',e=>{e.preventDefault();refresh();});
form.addEventListener('input',e=>{if(e.target.name==='q'){clearTimeout(timer);timer=setTimeout(refresh,120);}});
form.addEventListener('change',e=>{if(e.target.name!=='q')refresh();});
// Native controls reset after the reset event default action has completed.
form.addEventListener('reset',()=>{clearTimeout(timer);timer=setTimeout(refresh,0);});
document.querySelector('#cp-prev').addEventListener('click',()=>{page--;renderTable();});
document.querySelector('#cp-next').addEventListener('click',()=>{page++;renderTable();});
document.querySelector('#cp-status').addEventListener('click',e=>{const b=e.target.closest('[data-status]');if(b){form.elements.status.value=b.dataset.status;refresh();}});
document.querySelector('#cp-table').addEventListener('click',e=>{
 const b=e.target.closest('[data-detail]');if(!b)return;const c=demoCalls.find(c=>c.id===b.dataset.detail);
 document.querySelector('#cp-detail-body').innerHTML=`<p class="cp-detail-path" dir="ltr">${c.method} ${c.path}</p><div class="cp-dialog-meta">${[['شناسه درخواست',c.requestId],['زمان · تهران',`${date(c.at)} · ${time(c.at)}`],['پاسخ API',c.status],['زمان پاسخ',`${nf(c.duration)} ms`]].map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p class="cp-hint">محتوای نمونه فاقد اطلاعات مشتری است. مقدار authorization پوشانده شده است.</p><h3>ورودی</h3><pre dir="ltr">${esc(JSON.stringify(c.input,null,2))}</pre><h3>خروجی</h3><pre dir="ltr">${esc(JSON.stringify(c.output,null,2))}</pre>`;
 dialog.showModal();
});
document.querySelector('#cp-close').addEventListener('click',()=>dialog.close());
render();
