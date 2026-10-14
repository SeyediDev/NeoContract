import {executionFollowups,followupCategories,followupUrgencies} from './execution-followups.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=v=>new Intl.NumberFormat('fa-IR').format(v);
const normalize=v=>String(v??'').toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const rank={overdue:0,today:1,upcoming:2,undated:3,future:4};
export const workbenchSections={overview:'نمای اجرا',items:'اقلام و تحویل',finance:'مراحل و گردش مالی',obligations:'تعهدات و تضمین‌ها',issues:'ریسک و تغییرات'};
const statuses={running:'در حال اجرا',paused:'متوقف'};
const emptyFilters=()=>({urgency:'all',category:'all',direction:'all',contract:'all',query:'',page:1});

export function executionWorkbench(contracts,filters={},options={}) {
 const allRows=[];
 for(const c of contracts){
  const s=c.execution;if(!s||s.status==='closed'||!s.summary)continue;
  const f=executionFollowups(s,s.summary,options);
  for(const row of f.rows)allRows.push({...row,contractId:c.id,contractTitle:c.title,contractNumber:c.number,customer:c.customerName||c.party||'',direction:s.basis.direction,executionStatus:s.status});
 }
 allRows.sort((a,b)=>rank[a.urgency]-rank[b.urgency]||(a.dueDate||'').localeCompare(b.dueDate||'')||Number(b.review)-Number(a.review)||a.contractId.localeCompare(b.contractId)||a.key.localeCompare(b.key));
 const query=normalize(filters.query).trim();
 const rows=allRows.filter(r=>(!filters.urgency||filters.urgency==='all'||filters.urgency==='near'&&['today','upcoming'].includes(r.urgency)||filters.urgency==='review'&&r.review||filters.urgency===r.urgency)
  &&(!filters.category||filters.category==='all'||filters.category===r.category)
  &&(!filters.direction||filters.direction==='all'||filters.direction===r.direction)
  &&(!filters.contract||filters.contract==='all'||filters.contract===r.contractId)
  &&(!query||normalize([r.contractTitle,r.contractNumber,r.customer,r.title,r.owner,r.detail].join(' ')).includes(query)));
 // Only approved balances and disputed balances contribute, each exactly once.
 // A guarantee, deduction or retention row is never added to the invoice balance.
 const totals={receivable:0n,payable:0n,disputedReceivable:0n,disputedPayable:0n};
 for(const r of rows){
  if(!['invoice-payment','invoice-dispute'].includes(r.kind)||!Number.isSafeInteger(r.amount)||r.amount<0)continue;
  const key=r.kind==='invoice-payment'?r.direction:r.direction==='receivable'?'disputedReceivable':'disputedPayable';
  if(key in totals)totals[key]+=BigInt(r.amount);
 }
 const pageSize=25,pages=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(pages,Math.max(1,Math.floor(Number(filters.page)||1)));
 return {allRows,rows,visible:rows.slice((page-1)*pageSize,page*pageSize),page,pages,pageSize,totals:Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,value.toString()])),counts:{total:allRows.length,matched:rows.length,overdue:allRows.filter(r=>r.urgency==='overdue').length,near:allRows.filter(r=>['today','upcoming'].includes(r.urgency)).length,review:allRows.filter(r=>r.review).length}};
}

export function createExecutionWorkbench({state,openExecution,onError,refreshData}) {
 const scopes=new Map();
 const filters=()=>{const key=state.tenantId;if(!scopes.has(key))scopes.set(key,emptyFilters());return scopes.get(key);};
 const date=v=>v?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(new Date(v+'T12:00:00Z')):'بدون موعد';
 const money=v=>nf(BigInt(v))+' ریال';
 const select=(key,label,values,current)=>`<label><span>${label}</span><select data-workbench-filter="${key}">${values.map(([value,title])=>`<option value="${esc(value)}" ${current===value?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
 function html(){
  const f=filters(),contracts=state.data?.contracts||[],model=executionWorkbench(contracts,f);
  const active=contracts.filter(c=>c.execution&&c.execution.status!=='closed');
  return `<section class="card execution-workbench" id="executionWorkbench" aria-label="میزکار پیگیری اجرای قراردادها"><div class="card-header"><div><h2>پیگیری اجرای قراردادها</h2><p>سررسیدها و موارد باز در همین فضای کاری؛ آخرین داده دریافت‌شده. امور مالی، تحویل و تعهدات را از پرونده مرتبط پیش ببرید.</p></div><div class="page-actions"><span class="tag blue">${nf(model.counts.total)} مورد باز</span><button type="button" class="btn btn-secondary" data-workbench-refresh ${f.refreshing?'disabled':''}>${f.refreshing?'در حال دریافت…':'به‌روزرسانی پیگیری‌ها'}</button></div></div>${f.refreshError?`<p class="inline-error" role="alert">دریافت تازه انجام نشد؛ داده قبلی نمایش داده می‌شود. ${esc(f.refreshError)}</p>`:''}<div class="workbench-financials" aria-label="مانده مالی در فیلتر جاری">${[['receivable','مانده قابل دریافت'],['payable','مانده قابل پرداخت'],['disputedReceivable','دریافت در اختلاف'],['disputedPayable','پرداخت در اختلاف']].map(([key,label])=>`<div><span>${label}</span><strong data-workbench-total="${key}">${money(model.totals[key])}</strong></div>`).join('')}</div><p class="muted-copy">مبالغ مربوط به فیلتر جاری‌اند. صورت‌وضعیت تأییدشده و اختلاف مالی جدا هستند؛ سپرده، تضمین و کسورات دوباره به مانده صورت‌وضعیت افزوده نمی‌شوند.</p><div class="workbench-filters">${select('urgency','موعد / بررسی',[['all',`همه (${nf(model.counts.total)})`],['overdue',`موعد گذشته (${nf(model.counts.overdue)})`],['near',`امروز تا ۱۴ روز (${nf(model.counts.near)})`],['review',`منتظر بررسی (${nf(model.counts.review)})`],['undated','بدون موعد']],f.urgency)}${select('category','موضوع',[['all','همه موضوع‌ها'],...Object.entries(followupCategories)],f.category)}${select('direction','جهت مالی قرارداد',[['all','هر دو جهت'],['receivable','دریافت از مشتری'],['payable','پرداخت به طرف قرارداد']],f.direction)}${select('contract','قرارداد',[['all','همه قراردادهای اجرا'],...active.map(c=>[c.id,c.title+' · '+c.number])],f.contract)}<label class="workbench-search"><span>جست‌وجوی پیگیری‌ها</span><input type="search" maxlength="160" data-workbench-filter="query" value="${esc(f.query)}" placeholder="قرارداد، طرف، مسئول، قلم یا مرجع…"></label><button type="button" class="btn btn-secondary" data-workbench-reset>پاک‌کردن فیلترها</button></div><p class="workbench-result" role="status" aria-live="polite">${nf(model.counts.matched)} مورد در نتیجه · صفحه ${nf(model.page)} از ${nf(model.pages)}</p><div class="workbench-records">${model.visible.length?model.visible.map(r=>`<article class="workbench-record" data-workbench-contract="${esc(r.contractId)}" data-workbench-key="${esc(r.key)}"><div><div class="workbench-record-meta"><span class="tag ${r.urgency==='overdue'?'amber':'blue'}">${esc(followupUrgencies[r.urgency])}${r.daysLate?' · '+nf(r.daysLate)+' روز':''}</span><span>${esc(followupCategories[r.category])}</span><span>${esc(statuses[r.executionStatus])}</span></div><h3>${esc(r.title)}</h3><p class="workbench-contract-title">${esc(r.contractTitle)} · <bdi>${esc(r.contractNumber)}</bdi></p><p>${esc(r.customer)} · ${r.direction==='receivable'?'دریافت از مشتری':'پرداخت به طرف قرارداد'}</p><p>مسئول: ${esc(r.owner)} · موعد: ${esc(date(r.dueDate))}</p><p>${esc(r.detail)}${r.amount!==null?' · '+money(String(r.amount)):''}</p>${r.blockedReason?`<p class="notice-note">${esc(r.blockedReason)}</p>`:''}</div><button type="button" class="btn btn-secondary" data-workbench-open="${esc(r.contractId)}" data-workbench-section="${esc(r.section)}">بازکردن ${esc(workbenchSections[r.section])}</button></article>`).join(''):`<div class="empty-state"><strong>${model.counts.total?'موردی با این فیلتر پیدا نشد':'پیگیری بازی ثبت نشده است'}</strong><span>${model.counts.total?'فیلتر یا عبارت جست‌وجو را تغییر دهید.':'پس از ثبت مبنای امضاشده، اقلام و تعهدات در پرونده اجرا تعریف می‌شوند.'}</span></div>`}</div><div class="workbench-pagination"><button type="button" class="btn btn-secondary" data-workbench-page="${model.page-1}" data-workbench-navigation="previous" ${model.page===1?'disabled':''}>صفحه قبل</button><button type="button" class="btn btn-secondary" data-workbench-page="${model.page+1}" data-workbench-navigation="next" ${model.page===model.pages?'disabled':''}>صفحه بعد</button></div></section>`;
 }
 function update(control){
  const panel=document.querySelector('#executionWorkbench');if(!panel)return;
  const name=control?.dataset.workbenchFilter,position=name==='query'?control.selectionStart:null;
  panel.outerHTML=html();
  const selector=name?`[data-workbench-filter="${name}"]`:control?.dataset.workbenchNavigation?`[data-workbench-navigation="${control.dataset.workbenchNavigation}"]`:control?.hasAttribute('data-workbench-refresh')?'[data-workbench-refresh]':'[data-workbench-reset]';
  const next=document.querySelector(selector);
  next?.focus({preventScroll:true});if(name==='query'&&position!==null)next?.setSelectionRange(position,position);
 }
 document.addEventListener('change',e=>{const el=e.target.closest('[data-workbench-filter]');if(!el||state.view!=='execution'||el.dataset.workbenchFilter==='query')return;const f=filters();f[el.dataset.workbenchFilter]=el.value;f.page=1;update(el);});
 const queryChanged=e=>{const el=e.target.closest('[data-workbench-filter="query"]');if(!el||state.view!=='execution'||e.isComposing)return;const f=filters();f.query=el.value;f.page=1;update(el);};
 document.addEventListener('input',queryChanged);document.addEventListener('compositionend',queryChanged);
 document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-workbench-reset],[data-workbench-page],[data-workbench-open],[data-workbench-refresh]');if(!el||el.disabled||state.view!=='execution')return;
  if(el.hasAttribute('data-workbench-refresh')){
   const f=filters(),tenant=state.tenantId;if(f.refreshing)return;f.refreshing=true;f.refreshError='';update(el);
   try{await refreshData();if(state.tenantId===tenant&&state.error)throw new Error(state.error);}
   catch(error){f.refreshError=error.message;}
   finally{f.refreshing=false;if(state.tenantId===tenant&&state.view==='execution')update(el);}
   return;
  }
  if(el.hasAttribute('data-workbench-open')){try{await openExecution(el.dataset.workbenchOpen,el.dataset.workbenchSection);}catch(error){onError(error.message);}return;}
  const f=filters();if(el.hasAttribute('data-workbench-reset'))Object.assign(f,emptyFilters());else f.page=Number(el.dataset.workbenchPage);update(el);
 });
 return {html};
}
