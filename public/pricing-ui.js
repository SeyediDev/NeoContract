import { calculatePricing, pricingDocument } from './pricing.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = v => new Intl.NumberFormat('fa-IR', { maximumFractionDigits:6 }).format(v);
const copy = value => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();
const fresh = () => { const baseId=id(); return {name:'مدل قیمت‌گذاری جدید',currency:'IRR',bases:[{id:baseId,name:'نرخ پایه',unit:'واحد',amount:0,source:''}],items:[{id:id(),title:'آیتم قرارداد',quantity:1,serviceCode:'',components:[{baseId,coefficient:1}]}]}; };
const button = (action, text, attrs='') => `<button type="button" class="btn btn-secondary" data-p-action="${action}" ${attrs}>${text}</button>`;
const field = (label, value, path, attrs='') => `<label class="form-field"><span>${label}</span><input data-p-field="${path}" value="${esc(value)}" ${attrs}></label>`;

export function createPricingUI(hooks) {
  const drafts = new Map();
  let busy=false;
  const tenant = () => hooks.state.tenantId;
  const key = (tenantId=tenant()) => 'neocontract-pricing-draft:'+tenantId;
  function draft() {
    if(!drafts.has(tenant())) {
      let saved; try {saved=JSON.parse(sessionStorage.getItem(key())||'null');} catch {}
      drafts.set(tenant(),saved||{model:fresh(),id:null,revision:null,dirty:false,history:[]});
    }
    return drafts.get(tenant());
  }
  function persist(tenantId=tenant()){const d=drafts.get(tenantId)||draft();try{sessionStorage.setItem(key(tenantId),JSON.stringify(d));}catch{d.storageFailed=true;} }
  const model = scope => scope==='wizard'?hooks.state.wizard?.pricingPlan:draft().model;
  const editable = () => hooks.state.accessMode==='local-demo'||hooks.state.data?.access?.identity?.roles?.some(r=>['contract_admin','platform_admin'].includes(r));
  function quote(scope){return calculatePricing(model(scope));}
  function touch(scope){if(scope==='wizard'){syncWizard();hooks.saveWizardDraft();}else{draft().dirty=true;persist();}}
  function totals(scope){try{const q=quote(scope);return `<span>جمع آیتم‌ها</span><strong data-p-total>${nf(q.total)} ریال</strong><small>مقدار آیتم × مجموع (ضریب × نرخ مبنا)</small>`;}catch(error){return `<span class="pricing-error" role="alert">${esc(error.message)}</span>`;}}
  function editor(scope) {
    const m=model(scope);
    const services=scope==='wizard'?hooks.state.wizard.services:hooks.state.data.catalog.services;
    return `<section class="pricing-editor" data-pricing-scope="${scope}" aria-label="مدل قیمت‌گذاری">
      ${field('نام مدل',m.name,'name','maxlength="200" required')}
      <div class="section-title-row"><h3>نرخ‌های مبنا</h3>${button('base-add','＋ نرخ مبنا')}</div>
      <p class="field-hint">هر نرخ را با واحد روشن و مبلغ ریالی وارد کنید. تغییر آن، همه آیتم‌های وابسته را محاسبه می‌کند.</p>
      <div class="pricing-bases">${m.bases.map((b,i)=>`<article class="pricing-base" data-p-base="${i}">
        ${field('نام نرخ',b.name,`bases.${i}.name`,'required maxlength="200"')}${field('واحد نرخ',b.unit,`bases.${i}.unit`,'required maxlength="100" placeholder="مثلاً گیگابایت‌ماه"')}
        ${field('قیمت واحد (ریال)',b.amount,`bases.${i}.amount`,'required inputmode="numeric" dir="ltr"')}
        ${field('منبع / توضیح نرخ',b.source,`bases.${i}.source`,'maxlength="1000" placeholder="نرخ‌نامه مرجع و تاریخ استعلام"')}
        ${button('base-remove','حذف',`data-index="${i}" aria-label="حذف نرخ ${esc(b.name)}"`)}
      </article>`).join('')}</div>
      <div class="section-title-row"><h3>آیتم‌های قرارداد</h3>${button('item-add','＋ آیتم')}</div>
      <div class="pricing-items">${m.items.map((item,i)=>`<article class="pricing-item" data-p-item="${i}">
        <div class="pricing-item-heading"><span class="tag blue">${nf(i+1)}</span>${field('عنوان آیتم',item.title,`items.${i}.title`,'required maxlength="200"')}${field('مقدار آیتم',item.quantity,`items.${i}.quantity`,'required inputmode="decimal" dir="ltr"')}${button('item-remove','حذف آیتم',`data-index="${i}"`)}</div>
        <label class="form-field"><span>خدمت مرتبط (اختیاری)</span><select data-p-field="items.${i}.serviceCode"><option value="">آیتم مستقل قرارداد</option>${services.map(s=>`<option value="${esc(s.code)}" ${item.serviceCode===s.code?'selected':''}>${esc(s.code+' · '+s.name)}</option>`).join('')}${item.serviceCode&&!services.some(s=>s.code===item.serviceCode)?`<option selected value="${esc(item.serviceCode)}">${esc(item.serviceCode)} — این خدمت را به قرارداد اضافه کنید</option>`:''}</select></label>
        <div class="pricing-components">${item.components.map((c,j)=>`<div class="pricing-component"><label class="form-field"><span>نرخ مبنا</span><select required data-p-field="items.${i}.components.${j}.baseId">${m.bases.map(b=>`<option value="${esc(b.id)}" ${b.id===c.baseId?'selected':''}>${esc(b.name+' / '+b.unit)}</option>`).join('')}</select></label>${field('ضریب',c.coefficient,`items.${i}.components.${j}.coefficient`,'required inputmode="decimal" dir="ltr"')}${button('component-remove','حذف نرخ از آیتم',`data-index="${i}" data-component="${j}"`)}</div>`).join('')}</div>
        <div class="pricing-item-footer">${button('component-add','＋ افزودن نرخ به آیتم',`data-index="${i}"`)}<output data-p-line="${i}" aria-label="مبلغ آیتم ${nf(i+1)}"></output></div>
      </article>`).join('')}</div>
      <div class="pricing-total" data-p-totals aria-live="polite">${totals(scope)}</div>
      <p class="field-hint">ریال؛ دقت مقدار و ضریب تا شش رقم اعشار. مبلغ هر آیتم به نزدیک‌ترین ریال گرد می‌شود. دوره، مالیات و تخفیف فقط با تعریف آیتم محاسبه می‌شوند.</p>
    </section>`;
  }
  function view(){const d=draft();const plans=hooks.state.data.pricingPlans||[];return hooks.header('قیمت‌گذاری پویا','نرخ‌ها را یک‌بار تعریف کنید؛ مبالغ بندهای وابسته با تغییر نرخ‌ها محاسبه می‌شوند.')+
    `<div class="pricing-workspace"><aside class="card pricing-library"><h2>مدل‌های ذخیره‌شده</h2>${button('new','＋ مدل جدید')}${plans.length?plans.map(p=>`<button type="button" class="pricing-plan ${d.id===p.id?'active':''}" data-p-action="load" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><span>نسخه ${nf(p.revision)} · ${nf(p.total)} ریال</span></button>`).join(''):'<p class="muted-copy">اولین مدل را بسازید و برای قراردادها استفاده کنید.</p>'}<p class="field-hint">نرخ‌های بازار را از استعلام معتبر وارد کنید.</p></aside>
    <section class="card pricing-main"><div class="pricing-toolbar" data-pricing-scope="plan"><div><strong>${d.id?'نسخه '+nf(d.revision):'مدل جدید'}</strong><span data-p-dirty>${d.dirty?' · تغییرات ذخیره نشده':''}</span></div><output data-p-top-total aria-label="جمع زنده مدل" aria-live="polite"></output>${editable()?button('save',busy?'در حال ذخیره…':'ذخیره نسخه',busy?'disabled':''): '<span class="tag muted">محاسبه آزمایشی؛ ذخیره نیازمند نقش مدیر قرارداد است.</span>'}</div>
      <form id="pricingForm">${editor('plan')}</form><div data-p-history>${historyHtml(d)}</div>
      <div class="notice-note">هر قرارداد، نرخ‌ها و فرمول‌های زمان ثبت را نگه می‌دارد. ویرایش مدل، قرارداد ثبت‌شده را تغییر نمی‌دهد.</div></section></div>`;
  }
  function historyHtml(d){return d.id?`<details class="pricing-history"><summary>تاریخچه نسخه‌ها</summary>${d.history.length?d.history.map(v=>`<div><strong>نسخه ${nf(v.revision)} · ${nf(v.model.total)} ریال</strong><small>${esc(v.actor)} · ${new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium'}).format(new Date(v.createdAt))}</small></div>`).join(''):'<p>نسخه‌ها پس از بارگذاری مدل نمایش داده می‌شوند.</p>'}</details>`:'';}
  function wizardSection(full=false){const w=hooks.state.wizard;const plans=hooks.state.data.pricingPlans||[];return `<section class="pricing-wizard" data-pricing-scope="wizard"><div class="section-title-row"><h3>روش قیمت‌گذاری</h3><span class="tag blue">${w.pricingPlan?'پویا':'مبلغ توافقی'}</span></div><label class="form-field"><span>مدل قیمت‌گذاری قرارداد</span><select data-p-select><option value="manual" ${!w.pricingPlan?'selected':''}>ورود مبلغ توافقی</option><option value="new" ${w.pricingPlan&&!w.pricingPlanId?'selected':''}>مدل اختصاصی این قرارداد</option>${plans.map(p=>`<option value="${esc(p.id)}" ${w.pricingPlanId===p.id?'selected':''}>${esc(p.name)} · نسخه ${nf(p.revision)}</option>`).join('')}</select></label>${w.pricingPlan?'<p class="field-hint">مبلغ قرارداد فقط از آیتم‌های این مدل به دست می‌آید. برای محاسبه هزینه هر خدمت، آن را به یک آیتم مرتبط کنید. ویرایش‌های این فرم در همین قرارداد ثبت می‌شوند.</p>':''}${w.pricingPlan?(full?editor('wizard'):`<div class="pricing-total" data-p-totals aria-live="polite">${totals('wizard')}</div><p class="field-hint">نرخ‌ها و آیتم‌ها در مرحله «خدمات و شرایط» قابل ویرایش‌اند.</p>`):'<p class="field-hint">برای محاسبه مبلغ از نرخ‌های مبنا، یک مدل انتخاب کنید.</p>'}</section>`;}
  function syncWizard(){const w=hooks.state.wizard;if(!w?.pricingPlan)return;try{const q=quote('wizard');w.amount=String(q.total);for(const item of q.items){const term=w.services.find(s=>s.code===item.serviceCode);if(term){term.quantity=item.quantity;term.unitPrice=item.unitPrice;}}}catch{w.amount='';}}
  function payload(){const w=hooks.state.wizard;if(!w.pricingPlan)return {};const q=quote('wizard');for(const item of q.items)if(item.serviceCode&&!w.services.some(s=>s.code===item.serviceCode))throw new Error('خدمت '+item.serviceCode+' را به قرارداد اضافه کنید یا ارتباط آن را از آیتم قیمت‌گذاری بردارید.');return {pricingPlan:q,...(w.pricingPlanId?{pricingPlanId:w.pricingPlanId,pricingPlanRevision:w.pricingPlanRevision}:{})};}
  function summary(q){if(!q)return '';return `<section class="pricing-captured"><h3>قیمت‌گذاری ثبت‌شده · ${esc(q.name)}</h3><p>${nf(q.total)} ریال${q.sourcePlan?' · مبنای نسخه '+nf(q.sourcePlan.revision):''}</p><details><summary>نرخ‌ها و فرمول آیتم‌ها</summary><pre>${esc(pricingDocument(q))}</pre></details></section>`;}
  function updateOutputs(scope){if(scope==='wizard'&&!hooks.state.wizard)return;const container=document.querySelector(`[data-pricing-scope="${scope}"]${scope==='plan'?'.pricing-editor':''}`);if(!container)return;let q;try{q=quote(scope);}catch{}container.querySelectorAll('[data-p-totals]').forEach(el=>{el.innerHTML=totals(scope);});container.querySelectorAll('[data-p-line]').forEach(el=>{const item=q?.items[Number(el.dataset.pLine)];el.textContent=item?`${nf(item.unitPrice)} × ${nf(item.quantity)} = ${nf(item.amount)} ریال`:'محاسبه نیازمند تکمیل اطلاعات است';});if(scope==='plan'){const top=document.querySelector('[data-p-top-total]');if(top)top.textContent=q?nf(q.total)+' ریال':'نیازمند تکمیل';const dirty=document.querySelector('[data-p-dirty]');if(dirty)dirty.textContent=draft().dirty?' · تغییرات ذخیره نشده':'';}else{syncWizard();const amount=document.querySelector('#wizardForm [name="amount"]');if(amount)amount.value=hooks.state.wizard.amount;hooks.updateFinancialSummary();}}
  function mounted(){for(const scope of ['plan','wizard'])updateOutputs(scope);if(busy)document.querySelectorAll('#pricingForm input,#pricingForm select,#pricingForm button,.pricing-library button').forEach(el=>el.disabled=true);}
  function rerender(scope){if(scope==='wizard')hooks.renderWizard();else hooks.renderView();mounted();}
  function inputEvent(event){const el=event.target;if(!el.matches('[data-p-field]'))return;const scope=el.closest('[data-pricing-scope]').dataset.pricingScope;const parts=el.dataset.pField.split('.');let target=model(scope);for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=el.value;touch(scope);updateOutputs(scope);}
  document.addEventListener('input',inputEvent);
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.matches('select[data-p-field]')){inputEvent(event);return;}
    if(!el.matches('[data-p-select]'))return;
    hooks.collectWizard();const w=hooks.state.wizard;
    if(el.value==='manual'){delete w.pricingPlan;delete w.pricingPlanId;delete w.pricingPlanRevision;}
    else{const p=(hooks.state.data.pricingPlans||[]).find(p=>p.id===el.value);w.pricingPlan=p?copy(p.model):fresh();w.pricingPlanId=p?.id;w.pricingPlanRevision=p?.revision;}
    touch('wizard');rerender('wizard');
  });
  document.addEventListener('submit',event=>{if(event.target.id==='pricingForm')event.preventDefault();});
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-p-action]');if(!b||b.disabled||busy)return;event.preventDefault();
    const scope=b.closest('[data-pricing-scope]')?.dataset.pricingScope||'plan';
    if(scope==='wizard')hooks.collectWizard();
    const m=model(scope),i=Number(b.dataset.index),j=Number(b.dataset.component),a=b.dataset.pAction;
    const activeTenant=tenant();
    try{
      if(a==='new'||a==='load'){
        const work=async()=>{try{let p;if(a==='load')p=await hooks.api('/pricing-plans/'+encodeURIComponent(b.dataset.id));if(tenant()!==activeTenant)return;drafts.set(activeTenant,p?{model:copy(p.model),id:p.id,revision:p.revision,dirty:false,history:[]}:{model:fresh(),id:null,revision:null,dirty:false,history:[]});persist();rerender('plan');if(p){const h=await hooks.api('/pricing-plans/'+p.id+'/history');if(tenant()===activeTenant&&draft().id===p.id){draft().history=h;const panel=document.querySelector('[data-p-history]');if(panel)panel.innerHTML=historyHtml(draft());persist();}}}catch(e){hooks.toast(e.message,'warning');}};
        if(draft().dirty)hooks.confirmDiscard(()=>void work(),'جایگزینی مدل در حال ویرایش','تغییرات ذخیره‌نشده این مدل کنار گذاشته می‌شوند.');else await work();return;
      }
      if(a==='save'){
        if(!editable())throw new Error('ذخیره مدل نیازمند نقش مدیر قرارداد است.');
        const d=draft(),q=quote('plan');busy=true;rerender('plan');
        const saved=await hooks.api('/pricing-plans'+(d.id?'/'+d.id:''),{model:q,revision:d.revision},d.id?'PUT':'POST');
        drafts.set(activeTenant,{...d,model:copy(saved.model),id:saved.id,revision:saved.revision,dirty:false,history:[]});persist(activeTenant);
        if(tenant()!==activeTenant)return;
        hooks.state.data.pricingPlans=[saved,...(hooks.state.data.pricingPlans||[]).filter(p=>p.id!==saved.id)];
        draft().history=await hooks.api('/pricing-plans/'+saved.id+'/history');persist();hooks.toast('نسخه قیمت‌گذاری ذخیره شد.');return;
      }
      if(a==='base-add'){if(m.bases.length>=50)throw new Error('حداکثر ۵۰ نرخ مبنا مجاز است.');m.bases.push({id:id(),name:'نرخ جدید',unit:'واحد',amount:0,source:''});}
      if(a==='base-remove'){if(m.items.some(item=>item.components.some(c=>c.baseId===m.bases[i].id)))throw new Error('این نرخ در آیتم‌ها استفاده شده است؛ ابتدا وابستگی آن را حذف یا تغییر دهید.');m.bases.splice(i,1);}
      if(a==='item-add'){if(m.items.length>=200)throw new Error('حداکثر ۲۰۰ آیتم مجاز است.');if(!m.bases.length)throw new Error('ابتدا نرخ مبنا تعریف کنید.');m.items.push({id:id(),title:'آیتم جدید',quantity:1,serviceCode:'',components:[{baseId:m.bases[0].id,coefficient:1}]});}
      if(a==='item-remove')m.items.splice(i,1);
      if(a==='component-add'){const base=m.bases.find(b=>!m.items[i].components.some(c=>c.baseId===b.id));if(!base)throw new Error('نرخ دیگری برای افزودن نیست؛ یک نرخ مبنای جدید تعریف کنید.');m.items[i].components.push({baseId:base.id,coefficient:1});}
      if(a==='component-remove')m.items[i].components.splice(j,1);
      touch(scope);rerender(scope);
    }catch(error){hooks.toast(error.message,'warning');}
    finally{if(a==='save'){busy=false;if(hooks.state.view==='pricing')rerender('plan');}}
  });
  window.addEventListener('beforeunload',event=>{if(busy||(draft().storageFailed&&draft().dirty)){event.preventDefault();event.returnValue='';}});
  return {view,wizardSection,payload,syncWizard,summary,mounted};
}
