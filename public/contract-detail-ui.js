const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('fa-IR').format(value);
const normalize = text => String(text).replace(/[A-Z]/g,c=>c.toLowerCase()).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

// Only explicit headings are navigation targets; the saved document is never rewritten.
export function documentSections(text) {
  const sections = [];
  let fence = null;
  for (const line of String(text).matchAll(/[^\r\n]+|\r\n|[\r\n]/g)) {
    if (/^[\r\n]/.test(line[0])) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line[0]);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
    const markdown = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line[0]);
    const numbered = /^ {0,3}((?:ماده|بند|پیوست|ضمیمه)[ \t]+[0-9۰-۹٠-٩]+(?:[ \t]*[ـ:：.\-–—)][ \t]*[^\r\n]+)?)\s*$/.exec(line[0]);
    const title = markdown ? markdown[2].replace(/[ \t]+#+[ \t]*$/, '').trim() : numbered?.[1].trim();
    if (title) sections.push({ start: line.index, title, level: markdown ? markdown[1].length : 2 });
  }
  return sections;
}

function outlineHtml(sections) {
  if (!sections.length) return '';
  return '<div class="document-outline"><label for="contractDocumentSection">فهرست بخش‌ها <span>'+number(sections.length)+'</span></label><select id="contractDocumentSection" data-document-section-select aria-controls="contractDocumentText"><option value="">یک بخش را انتخاب کنید…</option>'+sections.map((section,i)=>'<option value="'+i+'">'+escape(section.title)+'</option>').join('')+'</select><button type="button" class="btn btn-secondary" data-document-section-go disabled>رفتن به بخش</button><span class="sr-only" data-document-section-status role="status" aria-live="polite"></span></div>';
}

// Text nodes preserve CRLF and literal HTML. Anchors may live inside a search mark,
// so one logical match always remains one mark even across section boundaries.
function renderDocument(paper, text, sections, matches) {
  const doc = paper.ownerDocument, fragment = doc.createDocumentFragment();
  let sectionIndex = 0;
  const append = (target, start, end) => {
    let cursor = start;
    while (sectionIndex < sections.length && sections[sectionIndex].start < end) {
      const at = sections[sectionIndex].start;
      target.append(doc.createTextNode(text.slice(cursor, at)));
      const anchor = doc.createElement('span');
      anchor.dataset.documentSection = String(sectionIndex++);
      anchor.className = 'document-section-anchor';
      anchor.setAttribute('aria-hidden', 'true');
      target.append(anchor); cursor = at;
    }
    target.append(doc.createTextNode(text.slice(cursor, end)));
  };
  let cursor = 0;
  for (const match of matches) {
    append(fragment, cursor, match.start);
    const mark = doc.createElement('mark');
    append(mark, match.start, match.end); fragment.append(mark); cursor = match.end;
  }
  append(fragment, cursor, text.length);
  paper.replaceChildren(fragment);
}

// Literal search with offsets preserved by one-character substitutions. Never interpret a query as markup or a regex.
export function documentMatches(text, query, limit = 300) {
  const needle = normalize(query.trim()), source = normalize(text), matches = [];
  if (!needle) return { matches, truncated: false };
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const at = source.indexOf(needle, offset);
    if (at < 0) break;
    if (matches.length === limit) return { matches, truncated: true };
    matches.push({ start: at, end: at + needle.length });
    offset = at + needle.length;
  }
  return { matches, truncated: false };
}

export function missingContractTerms(contract) {
  const terms = contract.snapshot?.terms || {}, services = contract.snapshot?.services || contract.services || [];
  const rows = [];
  const absent = value => value === null || value === undefined || String(value).trim() === '';
  if (absent(contract.party || terms.party)) rows.push('نام حقوقی طرف قرارداد');
  if (absent(contract.amount ?? terms.amount)) rows.push('مبلغ توافقی');
  if (absent(contract.start || terms.start)) rows.push('تاریخ شروع');
  if (absent(contract.end || terms.end)) rows.push('تاریخ پایان');
  if (absent(contract.paymentTerms || terms.paymentTerms)) rows.push('شرایط پرداخت');
  if (services.some(s => absent(s.slaTier || s.tier || s.sla?.code))) rows.push('سطح خدمت اقلام');
  if (services.some(s => absent(s.delivery))) rows.push('روش تحویل اقلام');
  return rows;
}

export function readinessHtml(contract) {
  const flags = contract.snapshot?.intake?.confirmationFlags || [], missing = missingContractTerms(contract);
  if (!flags.length && !missing.length) return '';
  return '<details class="contract-readiness" data-contract-readiness><summary><span class="readiness-icon" aria-hidden="true">!</span><span><strong>اطلاعات و تأییدهای مورد نیاز</strong><small>'+number(missing.length)+' مقدار ثبت‌نشده · '+number(flags.length)+' مورد بررسی از سند اولیه</small></span><span class="readiness-disclosure">جزئیات</span></summary><div class="readiness-body">'+(missing.length?'<h3>اطلاعات ثبت‌نشده در این نسخه</h3><ul class="missing-terms">'+missing.map(label=>'<li>'+escape(label)+'</li>').join('')+'</ul>':'<p>فیلدهای اصلی ثبت شده‌اند؛ ثبت مقدار به معنی تأیید طرفین نیست.</p>')+(flags.length?'<h3>موارد بررسی ثبت‌شده در سند اولیه</h3><ul>'+flags.map(flag=>'<li>'+escape(flag)+'</li>').join('')+'</ul><p>این فهرست از نسخه اولیه است؛ نتیجه بررسی هر مورد را در سند و تاریخچه همین پرونده پیگیری کنید.</p>':'')+'<p>مبلغ پیشنهادی جای مبلغ توافقی را نمی‌گیرد. تغییر مفاد ثبت‌شده از مسیر الحاقیه و بررسی طرفین انجام می‌شود.</p><button type="button" class="btn btn-secondary" data-action="review-contract-document">مرور سند و الحاقیه‌ها ←</button></div></details>';
}

export function documentReaderHtml(contract, actions) {
  const text = contract.document || contract.snapshot?.document || '';
  const proposed = Boolean(contract.proposalRevision);
  const sections = documentSections(text);
  return '<section class="contract-document-reader" aria-label="متن قرارداد"><div class="document-reader-heading"><div><h3>متن قرارداد</h3><p>'+(proposed?'نسخه پیشنهادی '+number(contract.proposalRevision.revisionNumber||2)+' برای مذاکره؛ سند اولیه محفوظ است.':'متن ثبت‌شده همین پرونده')+'</p></div><span class="tag '+(proposed?'amber':'blue')+'">'+(proposed?'پیشنهادی':escape(contract.status==='active'?'قرارداد فعال':'برای بازبینی'))+'</span></div><div class="document-reader-tools"><div class="document-actions">'+actions+'</div><div class="document-search-tools"><label class="document-search"><span>جست‌وجو در متن</span><input type="search" data-document-search maxlength="100" placeholder="عبارت، مبلغ یا شماره بند…" aria-label="جست‌وجو در متن قرارداد" aria-controls="contractDocumentText"></label><div class="document-search-navigation"><button type="button" class="icon-btn" data-document-previous aria-label="نتیجه قبلی" disabled>↑</button><button type="button" class="icon-btn" data-document-next aria-label="نتیجه بعدی" disabled>↓</button><span data-document-search-status role="status" aria-live="polite">متن قابل جست‌وجو است</span></div></div>'+outlineHtml(sections)+'</div><pre class="document-paper" id="contractDocumentText" tabindex="0" aria-label="متن ثبت‌شده قرارداد">'+escape(text||'سندی برای این پرونده ثبت نشده است.')+'</pre></section>';
}

export function mountContractDetail(modalRoot, contract) {
  const modal = modalRoot.querySelector('.modal'), body = modal?.querySelector('.modal-body');
  if (!body) return;
  modal.classList.add('contract-detail-modal');
  const overview = body.querySelector('.detail-overview'), tabs = body.querySelector('.detail-tabs');
  if (overview) modal.insertBefore(overview, body);
  if (tabs) {
    modal.insertBefore(tabs, body);
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','بخش‌های پرونده قرارداد');
    tabs.querySelectorAll('[data-tab]').forEach(tab=>{
      const active = tab.classList.contains('active');
      tab.id = 'contract-tab-'+tab.dataset.tab;
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(active));
      tab.setAttribute('aria-controls','contractDetailPanel');tab.tabIndex = active?0:-1;
      if(active)body.setAttribute('aria-labelledby',tab.id);
    });
    const selected=tabs.querySelector('.active');
    if(selected){const box=selected.getBoundingClientRect(),frame=tabs.getBoundingClientRect();if(box.left<frame.left)tabs.scrollLeft+=box.left-frame.left;else if(box.right>frame.right)tabs.scrollLeft+=box.right-frame.right;}
    tabs.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!event.target.matches('[data-tab]'))return;
      event.preventDefault();
      const buttons=[...tabs.querySelectorAll('[data-tab]')],index=buttons.indexOf(event.target);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?1:-1)+buttons.length)%buttons.length;
      buttons[next].focus({preventScroll:true});buttons[next].click();
    });
  }
  body.id='contractDetailPanel';body.setAttribute('role','tabpanel');body.tabIndex=0;
  const input=body.querySelector('[data-document-search]'),paper=body.querySelector('#contractDocumentText');
  if(!input||!paper)return;
  const text=contract.document||contract.snapshot?.document||'',status=body.querySelector('[data-document-search-status]');
  const previous=body.querySelector('[data-document-previous]'),next=body.querySelector('[data-document-next]');
  const sections=documentSections(text),sectionSelect=body.querySelector('[data-document-section-select]'),sectionGo=body.querySelector('[data-document-section-go]');
  renderDocument(paper,text||'سندی برای این پرونده ثبت نشده است.',sections,[]);
  const reveal=element=>{
    const box=element.getBoundingClientRect(),frame=body.getBoundingClientRect(),toolbar=body.querySelector('.document-reader-tools');
    const toolbarHeight=toolbar&&getComputedStyle(toolbar).position==='sticky'?toolbar.offsetHeight:0;
    const offset=Math.min(body.clientHeight-24,Math.max(body.clientHeight/2,toolbarHeight+24));
    body.scrollTop+=box.top-frame.top-offset;
  };
  if(sectionSelect&&sectionGo){
    sectionSelect.addEventListener('change',()=>{sectionGo.disabled=sectionSelect.value==='';});
    sectionGo.addEventListener('click',()=>{
      const index=Number(sectionSelect.value),section=sections[index];
      if(sectionSelect.value===''||!section)return;
      const anchor=paper.querySelector('[data-document-section="'+index+'"]');
      if(anchor){paper.focus({preventScroll:true});reveal(anchor);body.querySelector('[data-document-section-status]').textContent='بخش '+section.title;}
    });
  }
  let matches=[],active=-1,truncated=false;
  const select=delta=>{
    if(!matches.length)return;
    active=(active+delta+matches.length)%matches.length;
    paper.querySelectorAll('mark').forEach((mark,i)=>mark.classList.toggle('current-match',i===active));
    status.textContent=number(active+1)+' از '+number(matches.length)+(truncated?' نتیجه نمایش‌داده‌شده':' نتیجه');
    const selected=paper.querySelectorAll('mark')[active];
    if(selected)reveal(selected);
  };
  input.addEventListener('input',()=>{
    ({matches,truncated}=documentMatches(text,input.value));active=-1;
    renderDocument(paper,text||'سندی برای این پرونده ثبت نشده است.',sections,matches);
    previous.disabled=next.disabled=matches.length===0;
    status.textContent=input.value.trim()?(matches.length?number(matches.length)+(truncated?' نتیجه نخست؛ جست‌وجو را دقیق‌تر کنید':' نتیجه'):'عبارت در متن پیدا نشد'):'متن قابل جست‌وجو است';
  });
  previous.addEventListener('click',()=>select(active===-1?0:-1));next.addEventListener('click',()=>select(1));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();select(event.shiftKey?(active===-1?0:-1):1);}});
}
