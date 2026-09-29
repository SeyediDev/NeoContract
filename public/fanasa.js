/* Fanasa catalog extension for the NeoContract demo.
 * The snapshot is intentionally marked browser-observed-unverified in the JSON.
 * This file keeps the demo usable when the upstream site/API is not available.
 */
(() => {
  const originalRenderView = renderView;
  const originalBindView = bindView;
  const originalSaveFields = saveFields;
  const fanasa = {
    snapshot: null,
    selected: new Set(),
    filters: { search: '', center: 'all', sla: 'all', model: 'all', delivery: 'all' },
    customers: [
      { id: 'CUS-001', name: 'گروه صنعتی انتخاب', unit: 'ستاد مرکزی', industry: 'هلدینگ مادر', manager: 'm-001', status: 'فعال', services: 18 },
      { id: 'CUS-002', name: 'انتخاب الکترونیک آرمان', unit: 'شرکت لوازم خانگی', industry: 'تولید و محصول', manager: 'm-002', status: 'فعال', services: 12 },
      { id: 'CUS-003', name: 'انتخاب سرویس', unit: 'خدمات پس از فروش', industry: 'خدمات و پشتیبانی', manager: 'm-001', status: 'در حال onboarding', services: 7 },
      { id: 'CUS-004', name: 'زنجیره تأمین انتخاب', unit: 'زنجیره تأمین', industry: 'لجستیک و عملیات', manager: 'm-003', status: 'فعال', services: 9 }
    ],
    managers: [
      { id: 'm-001', name: 'مریم احمدی', role: 'Account Manager ارشد', phone: '۰۲۱-۴۲۱۴۰۰۰۰', email: 'maryam.ahmadi@entekhab.ir', customerIds: ['CUS-001', 'CUS-003'], color: 'blue' },
      { id: 'm-002', name: 'سارا محمدی', role: 'Account Manager', phone: '۰۲۱-۴۲۱۴۰۰۲۱', email: 'sara.mohammadi@entekhab.ir', customerIds: ['CUS-002'], color: 'violet' },
      { id: 'm-003', name: 'مهدی احمدی', role: 'Account Manager', phone: '۰۲۱-۴۲۱۴۰۰۳۶', email: 'mehdi.ahmadi@entekhab.ir', customerIds: ['CUS-004'], color: 'green' }
    ],
    wizardOriginal: null
  };

  viewNames.catalog = 'کاتالوگ سرویس';
  viewNames.customers = 'مشتریان هلدینگی';
  viewNames.managers = 'اکانت منیجرها';

  const modelLabels = {
    per_user: 'به‌ازای کاربر', usage: 'مصرفی', fixed: 'ثابت', hybrid: 'ترکیبی',
    project: 'پروژه‌ای', overhead: 'سربار', included: 'در بسته پایه'
  };
  const deliveryLabels = { self_service: 'سلف‌سرویس', automatic: 'خودکار', managed: 'مدیریت‌شده', project: 'درخواست/پروژه' };
  const tierLabels = { T1: 'حیاتی', T2: 'کسب‌وکاری', T3: 'پشتیبان' };

  const serviceDelivery = model => ({
    included: 'self_service', per_user: 'self_service', usage: 'self_service', fixed: 'automatic',
    hybrid: 'managed', overhead: 'managed', project: 'project'
  }[model] || 'self_service');

  function allServices() {
    if (!fanasa.snapshot?.centers) return [];
    const pricing = fanasa.snapshot.pricingModelByCode || {};
    const modelByCode = {};
    Object.keys(pricing).forEach(m => (pricing[m] || []).forEach(c => { modelByCode[c] = m; }));
    let index = 0;
    const tiers = ['T1', 'T2', 'T3'];
    return fanasa.snapshot.centers.flatMap(center => (center.services || []).map(([code, name]) => {
      // The source snapshot publishes tier totals rather than a per-code mapping.
      // A stable allocation keeps this demo deterministic until the provider API is connected.
      const tier = tiers[index++ < 36 ? 0 : index - 1 < 72 ? 1 : 2];
      const model = modelByCode[code] || 'usage';
      return { code, name, centerId: center.id, centerName: center.name, zone: center.zone, model, delivery: serviceDelivery(model), tier };
    }));
  }

  function service(code) { return allServices().find(s => s.code === code); }
  function selectedServices() { return [...fanasa.selected].map(service).filter(Boolean); }
  function selectOptions(items, selected, placeholder) {
    return `<option value="all">${placeholder}</option>${items.map(i => `<option value="${esc(i.value)}" ${selected === i.value ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}`;
  }
  function syncBadge() {
    const s = fanasa.snapshot;
    return `<div class="fanasa-sync-banner"><span class="fanasa-sync-dot"></span><div><strong>کاتالوگ فن‌آسا · snapshot مشاهده‌شده</strong><span>منبع: ${esc(s?.source || 'fanasa.net')} · آخرین مشاهده: ${esc(s?.observedAt || '—')}</span></div><span class="fanasa-unverified">نیازمند تأیید دستی</span></div>`;
  }
  function statsCards() {
    const s = fanasa.snapshot?.catalog || { centers: 14, services: 87 };
    const models = fanasa.snapshot?.pricingModelByCode || {};
    const modelCount = Object.values(models).reduce((n, x) => n + x.length, 0);
    return `<div class="fanasa-kpis"><div class="fanasa-stat"><span class="fanasa-stat-icon blue">⌘</span><div><strong>${fa.format(s.centers || 14)}</strong><span>مرکز قابلیت</span></div></div><div class="fanasa-stat"><span class="fanasa-stat-icon violet">◈</span><div><strong>${fa.format(s.services || modelCount || 87)}</strong><span>سرویس کاتالوگ</span></div></div><div class="fanasa-stat"><span class="fanasa-stat-icon green">✓</span><div><strong>${fa.format(fanasa.selected.size)}</strong><span>سرویس انتخاب‌شده</span></div></div><div class="fanasa-stat"><span class="fanasa-stat-icon orange">◷</span><div><strong>۳</strong><span>پروفایل SLA</span></div></div></div>`;
  }
  function slaCards() {
    const tiers = fanasa.snapshot?.slaTiers || {};
    return `<div class="fanasa-sla-grid">${['T1', 'T2', 'T3'].map((key, i) => { const t = tiers[key] || {}; return `<article class="fanasa-sla-card tier-${i + 1}"><div class="fanasa-sla-head"><span class="fanasa-tier-dot"></span><strong>${key} · ${esc(t.label || tierLabels[key])}</strong><span class="fanasa-count">${fa.format(t.count || 0)} سرویس</span></div><div class="fanasa-sla-meta"><span><b>${esc(t.availability || '—')}</b> دسترس‌پذیری</span><span><b>${esc(t.response || '—')}</b> پاسخ</span><span><b>${esc(t.resolutionTarget || '—')}</b> رفع</span><span><b>${esc(t.coverage || '—')}</b> پوشش</span></div></article>`; }).join('')}</div>`;
  }
  function filteredServices() {
    const f = fanasa.filters;
    const q = f.search.trim().toLowerCase();
    return allServices().filter(s => (!q || `${s.code} ${s.name} ${s.centerName} ${s.zone}`.toLowerCase().includes(q)) && (f.center === 'all' || s.centerId === f.center) && (f.sla === 'all' || s.tier === f.sla) && (f.model === 'all' || s.model === f.model) && (f.delivery === 'all' || s.delivery === f.delivery));
  }
  function catalogView() {
    const s = fanasa.snapshot || { centers: [] };
    const rows = filteredServices();
    const byCenter = new Map();
    rows.forEach(x => { if (!byCenter.has(x.centerId)) byCenter.set(x.centerId, []); byCenter.get(x.centerId).push(x); });
    const centerOptions = (s.centers || []).map(c => ({ value: c.id, label: c.name }));
    const modelOptions = Object.keys(modelLabels).map(k => ({ value: k, label: modelLabels[k] }));
    const deliveryOptions = Object.keys(deliveryLabels).map(k => ({ value: k, label: deliveryLabels[k] }));
    const tree = [...byCenter.entries()].map(([id, items]) => {
      const center = s.centers.find(c => c.id === id) || { name: id, zone: '' };
      const allSelected = items.length && items.every(x => fanasa.selected.has(x.code));
      return `<details class="fanasa-center" open><summary><span class="fanasa-center-chevron">⌄</span><span class="fanasa-center-avatar">${esc(center.name.slice(0, 1))}</span><span class="fanasa-center-title"><strong>${esc(center.name)}</strong><small>${esc(center.zone)} · ${fa.format(items.length)} سرویس در فیلتر</small></span><span class="fanasa-center-actions"><button type="button" class="btn btn-ghost btn-xs" data-fanasa-center="${esc(id)}" data-fanasa-selected="${allSelected ? 'true' : 'false'}">${allSelected ? 'حذف همه' : 'انتخاب همه'}</button><span class="fanasa-center-count">${fa.format(items.filter(x => fanasa.selected.has(x.code)).length)} / ${fa.format(items.length)}</span></span></summary><div class="fanasa-service-list">${items.map(serviceRow).join('')}</div></details>`;
    }).join('');
    return `<div class="page-heading"><div><div class="eyebrow">فن‌آسا · سرویس‌کاتالوگ</div><h1>کاتالوگ سرویس</h1><p>مرکز قابلیت، سرویس، مدل درآمدی و سطح خدمت را انتخاب کنید تا در قرارداد snapshot شود.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="fanasa-reset-selection">پاک‌کردن انتخاب‌ها</button><button class="btn btn-primary" data-action="new-contract" ${fanasa.selected.size ? '' : 'disabled'}>＋ ساخت قرارداد از انتخاب (${fa.format(fanasa.selected.size)})</button></div></div>${syncBadge()}${statsCards()}<section class="card fanasa-sla-section"><div class="card-header"><div><h2>پروفایل‌های SLA</h2><p>پروفایل انتخاب‌شده هنگام ایجاد قرارداد قابل تغییر است.</p></div><span class="status-chip status-active">۳ سطح استاندارد</span></div>${slaCards()}</section><section class="card fanasa-catalog-card"><div class="card-header"><div><h2>درخت سرویس‌ها</h2><p>${fa.format(rows.length)} سرویس از ${fa.format(s.catalog?.services || 87)} سرویس نمایش داده می‌شود.</p></div><span class="fanasa-selection-pill">${fa.format(fanasa.selected.size)} انتخاب</span></div><div class="fanasa-filter-row"><label class="filter-search fanasa-wide-search"><span>⌕</span><input id="fanasaSearch" value="${esc(fanasa.filters.search)}" placeholder="جست‌وجوی کد، نام سرویس یا مرکز..." /></label><select id="fanasaCenterFilter" class="select-control">${selectOptions(centerOptions, fanasa.filters.center, 'همه مراکز')}</select><select id="fanasaSlaFilter" class="select-control">${selectOptions([{ value: 'T1', label: 'SLA حیاتی (T1)' }, { value: 'T2', label: 'SLA کسب‌وکاری (T2)' }, { value: 'T3', label: 'SLA پشتیبان (T3)' }], fanasa.filters.sla, 'همه SLAها')}</select><select id="fanasaModelFilter" class="select-control">${selectOptions(modelOptions, fanasa.filters.model, 'همه مدل‌های درآمدی')}</select><select id="fanasaDeliveryFilter" class="select-control">${selectOptions(deliveryOptions, fanasa.filters.delivery, 'همه روش‌های ارائه')}</select></div><div class="fanasa-tree">${tree || '<div class="empty-state"><strong>سرویسی پیدا نشد</strong><span>فیلترها یا عبارت جست‌وجو را تغییر دهید.</span></div>'}</div></section><div class="fanasa-selection-tray ${fanasa.selected.size ? 'show' : ''}"><div><strong>${fa.format(fanasa.selected.size)} سرویس برای قرارداد آماده است</strong><span>${selectedServices().slice(0, 4).map(x => esc(x.name)).join('، ')}${fanasa.selected.size > 4 ? ' و ...' : ''}</span></div><button class="btn btn-primary btn-sm" data-action="new-contract">ادامه و تنظیم قرارداد ←</button></div></div>`;
  }
  function serviceRow(x) {
    return `<label class="fanasa-service-row ${fanasa.selected.has(x.code) ? 'selected' : ''}"><input type="checkbox" data-fanasa-service="${esc(x.code)}" ${fanasa.selected.has(x.code) ? 'checked' : ''} /><span class="fanasa-service-check">${fanasa.selected.has(x.code) ? '✓' : ''}</span><span class="fanasa-service-main"><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.zone)}</small></span><span class="fanasa-service-tags"><span class="fanasa-tag model">${esc(modelLabels[x.model] || x.model)}</span><span class="fanasa-tag sla">${esc(x.tier)} · ${esc(tierLabels[x.tier])}</span><span class="fanasa-tag delivery">${esc(deliveryLabels[x.delivery])}</span></span></label>`;
  }
  function customerManagerName(id) { return fanasa.managers.find(m => m.id === id)?.name || '—'; }
  function customersView() {
    const active = fanasa.customers.filter(c => c.status === 'فعال').length;
    return `<div class="page-heading"><div><div class="eyebrow">طرف‌های قرارداد · گروه انتخاب</div><h1>مشتریان هلدینگی</h1><p>مشتری، واحد بهره‌بردار و اکانت منیجر را پیش از ساخت قرارداد مشخص کنید.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="fanasa-export-customers">↓ خروجی مشتریان</button><button class="btn btn-primary" data-action="fanasa-new-customer">＋ مشتری جدید</button></div></div><div class="fanasa-customer-kpis"><div class="fanasa-mini-kpi"><strong>${fa.format(fanasa.customers.length)}</strong><span>مشتری ثبت‌شده</span></div><div class="fanasa-mini-kpi"><strong>${fa.format(active)}</strong><span>رابطه فعال</span></div><div class="fanasa-mini-kpi"><strong>${fa.format(fanasa.customers.reduce((n, c) => n + c.services, 0))}</strong><span>اتصال سرویس</span></div><div class="fanasa-mini-kpi"><strong>${fa.format(fanasa.managers.length)}</strong><span>اکانت منیجر</span></div></div><section class="card fanasa-customer-card"><div class="card-header"><div><h2>فهرست مشتریان هلدینگی</h2><p>هر مشتری می‌تواند چند واحد و چند قرارداد سرویس داشته باشد.</p></div><label class="filter-search fanasa-customer-search"><span>⌕</span><input id="fanasaCustomerSearch" placeholder="جست‌وجوی مشتری یا واحد..." /></label></div><div class="data-table-wrap"><table class="data-table fanasa-data-table"><thead><tr><th>مشتری / شناسه</th><th>واحد بهره‌بردار</th><th>حوزه فعالیت</th><th>اکانت منیجر</th><th>سرویس‌ها</th><th>وضعیت</th><th></th></tr></thead><tbody>${fanasa.customers.map(c => `<tr data-fanasa-customer-row><td><div class="contract-primary"><strong>${esc(c.name)}</strong><span>${esc(c.id)}</span></div></td><td>${esc(c.unit)}</td><td>${esc(c.industry)}</td><td><span class="fanasa-person"><span class="fanasa-avatar small">${esc(customerManagerName(c.manager).slice(0, 1))}</span>${esc(customerManagerName(c.manager))}</span></td><td><span class="fanasa-number-badge">${fa.format(c.services)}</span></td><td><span class="status-chip ${c.status === 'فعال' ? 'status-active' : 'status-finance'}">${esc(c.status)}</span></td><td><button class="table-action" data-action="fanasa-edit-customer" data-customer="${esc(c.id)}">✎</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function managersView() {
    return `<div class="page-heading"><div><div class="eyebrow">مدیریت رابطه · بدون دسترسی کاربری</div><h1>اکانت منیجرها</h1><p>اکانت منیجرها رکورد عملیاتی هستند و به مشتری‌های هلدینگی متصل می‌شوند.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="fanasa-new-manager">＋ اکانت منیجر جدید</button></div></div><div class="fanasa-manager-grid">${fanasa.managers.map(m => `<article class="card fanasa-manager-card"><div class="fanasa-manager-head"><span class="fanasa-avatar ${esc(m.color)}">${esc(m.name.slice(0, 1))}</span><div><h3>${esc(m.name)}</h3><p>${esc(m.role)}</p></div><button class="icon-btn" data-action="fanasa-edit-manager" data-manager="${esc(m.id)}">•••</button></div><div class="fanasa-manager-contact"><span>✉ ${esc(m.email)}</span><span>☎ ${esc(m.phone)}</span></div><div class="fanasa-manager-customers"><div class="fanasa-manager-label"><strong>مشتریان اختصاص‌یافته</strong><span>${fa.format(m.customerIds.length)}</span></div><div class="fanasa-customer-chips">${m.customerIds.map(id => { const c = fanasa.customers.find(x => x.id === id); return c ? `<span class="fanasa-customer-chip">${esc(c.name)}</span>` : ''; }).join('')}</div></div><button class="btn btn-secondary btn-sm fanasa-full-btn" data-action="fanasa-map-manager" data-manager="${esc(m.id)}">مدیریت اتصال مشتری ←</button></article>`).join('')}</div><section class="card fanasa-assignment-card"><div class="card-header"><div><h2>نمای تخصیص رابطه</h2><p>این جدول برای انتخاب اکانت منیجر در ویزارد قرارداد استفاده می‌شود.</p></div></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>مشتری</th><th>اکانت منیجر</th><th>تعداد سرویس</th><th>آخرین وضعیت</th></tr></thead><tbody>${fanasa.customers.map(c => `<tr><td><strong>${esc(c.name)}</strong><small class="table-sub">${esc(c.unit)}</small></td><td><span class="fanasa-person"><span class="fanasa-avatar small">${esc(customerManagerName(c.manager).slice(0, 1))}</span>${esc(customerManagerName(c.manager))}</span></td><td>${fa.format(c.services)}</td><td><span class="status-chip status-active">هم‌راستا</span></td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function fanasaWizardBody() {
    const w = state.wizard;
    const picked = (w.services || []).map(service).filter(Boolean);
    const tierFor = x => w.slaByService?.[x.code] || x.tier;
    if (w.step === 1) return `<h3 class="section-caption">الگوی قرارداد و سرویس‌های انتخابی</h3><p class="fanasa-wizard-help">از کاتالوگ سرویس انتخاب کنید؛ snapshot سرویس، SLA و مدل درآمدی همراه قرارداد ذخیره می‌شود.</p><div class="template-pick-grid">${templates.slice(0, 4).map(t => `<button class="template-pick ${w.template === t.id ? 'selected' : ''}" data-template-pick="${t.id}"><span class="pick-check">${w.template === t.id ? '✓' : ''}</span><strong>${t.icon} ${t.title}</strong><span>${t.version} · ${t.steps.length} مرحله فرآیند</span></button>`).join('')}</div><div class="fanasa-wizard-services"><div class="fanasa-wizard-block-head"><strong>سرویس‌های قرارداد</strong><button class="btn btn-ghost btn-xs" data-view="catalog">ویرایش کاتالوگ</button></div>${picked.length ? picked.map(x => `<div class="fanasa-wizard-service"><span class="fanasa-service-icon">◈</span><div><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.centerName)}</small></div><span class="fanasa-tag model">${esc(modelLabels[x.model])}</span><span class="fanasa-tag sla">${esc(x.tier)}</span></div>`).join('') : '<div class="fanasa-empty-inline">هنوز سرویسی انتخاب نشده؛ می‌توانید قرارداد را بدون سرویس شروع کنید.</div>'}</div><div class="summary-box"><h4>راهنمای انتخاب</h4><div class="summary-list"><div><span>تعداد سرویس</span><b>${fa.format(picked.length)}</b></div><div><span>مدل‌های درآمدی</span><b>${[...new Set(picked.map(x => modelLabels[x.model]))].join('، ') || '—'}</b></div><div><span>پروفایل SLA</span><b>${[...new Set(picked.map(x => x.tier))].join('، ') || 'T2'}</b></div></div></div>`;
    if (w.step === 2) return `<h3 class="section-caption">اطلاعات پایه قرارداد</h3><div class="form-grid"><div class="form-field full"><label>عنوان قرارداد <span class="required">*</span></label><input id="wTitle" value="${esc(w.title)}" placeholder="مثلاً: خدمات هوش مصنوعی گروه انتخاب" /></div><div class="form-field"><label>مشتری هلدینگی <span class="required">*</span></label><select id="wCustomer"><option value="">انتخاب مشتری...</option>${fanasa.customers.map(c => `<option value="${esc(c.id)}" ${w.customerId === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.unit)}</option>`).join('')}</select></div><div class="form-field"><label>اکانت منیجر</label><select id="wManager"><option value="">انتخاب اکانت منیجر...</option>${fanasa.managers.map(m => `<option value="${esc(m.id)}" ${w.managerId === m.id ? 'selected' : ''}>${esc(m.name)} · ${esc(m.role)}</option>`).join('')}</select></div><div class="form-field"><label>طرف قرارداد <span class="required">*</span></label><input id="wParty" value="${esc(w.party)}" placeholder="نام شرکت یا شخص" /></div><div class="form-field"><label>نوع قرارداد</label><select id="wType"><option ${w.type === 'خدمات فناوری اطلاعات' ? 'selected' : ''}>خدمات فناوری اطلاعات</option><option ${w.type === 'خرید کالا و خدمات' ? 'selected' : ''}>خرید کالا و خدمات</option><option>خدمات ابری و هوش مصنوعی</option><option>مشاوره</option></select></div><div class="form-field"><label>واحد مالک</label><select id="wUnit"><option>ستاد مرکزی</option><option>شرکت لوازم خانگی</option><option>انتخاب سرویس</option></select></div><div class="form-field"><label>مالک فرآیند</label><input id="wOwner" value="${esc(w.owner)}" /></div><div class="form-field"><label>مبلغ کل (ریال)</label><input id="wAmount" class="input-ltr" value="${esc(w.amount)}" placeholder="مثلاً ۴۸۵۰۰۰۰۰۰۰۰" /></div><div class="form-field"><label>تاریخ شروع</label><input id="wStart" class="input-ltr" value="${esc(w.start)}" placeholder="۱۴۰۵/۰۲/۲۰" /></div><div class="form-field"><label>تاریخ پایان</label><input id="wEnd" class="input-ltr" value="${esc(w.end)}" placeholder="۱۴۰۶/۰۲/۲۰" /></div></div>`;
    if (w.step === 3) return `<h3 class="section-caption">SLA و مدل درآمدی قرارداد</h3><p class="fanasa-wizard-help">برای هر سرویس، پروفایل پشتیبانی و مدل محاسبه را تأیید کنید.</p><div class="fanasa-wizard-service-table"><div class="fanasa-wizard-service-table-head"><span>سرویس</span><span>مدل درآمدی</span><span>پروفایل SLA</span><span>روش ارائه</span></div>${picked.length ? picked.map(x => `<div class="fanasa-wizard-service-table-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.centerName)}</small></div><span class="fanasa-tag model">${esc(modelLabels[x.model])}</span><select data-fanasa-sla-for="${esc(x.code)}"><option value="T1" ${tierFor(x) === 'T1' ? 'selected' : ''}>T1 · حیاتی</option><option value="T2" ${tierFor(x) === 'T2' ? 'selected' : ''}>T2 · کسب‌وکاری</option><option value="T3" ${tierFor(x) === 'T3' ? 'selected' : ''}>T3 · پشتیبان</option></select><span class="fanasa-tag delivery">${esc(deliveryLabels[x.delivery])}</span></div>`).join('') : '<div class="fanasa-empty-inline">برای تنظیم SLA ابتدا از کاتالوگ سرویس انتخاب کنید.</div>'}</div><div class="summary-box"><h4>قاعده‌های تجاری فن‌آسا</h4><div class="fanasa-rule-grid"><span>ارز پایه <b>ریال ایران</b></span><span>بازبینی قیمت <b>فصلی</b></span><span>تخفیف تعهد یک‌ساله <b>۲۰٪</b></span><span>اعتبار SLA <b>تا ۳۰٪ مبلغ سرویس</b></span></div></div>`;
    return `<h3 class="section-caption">بازبینی و ایجاد قرارداد</h3><div class="summary-box" style="margin-top:0"><h4>اطلاعات قرارداد</h4><div class="summary-list"><div><span>عنوان</span><b>${esc(w.title || 'بدون عنوان')}</b></div><div><span>مشتری</span><b>${esc(fanasa.customers.find(c => c.id === w.customerId)?.name || w.party || 'ثبت نشده')}</b></div><div><span>اکانت منیجر</span><b>${esc(fanasa.managers.find(m => m.id === w.managerId)?.name || 'تخصیص در ادامه')}</b></div><div><span>سرویس‌های انتخابی</span><b>${fa.format(picked.length)} سرویس</b></div><div><span>نوع</span><b>${esc(w.type)}</b></div><div><span>مبلغ</span><b class="number-mono">${esc(w.amount || '—')} ریال</b></div></div></div><div class="fanasa-review-services"><strong>snapshot سرویس قرارداد</strong>${picked.length ? picked.map(x => `<span class="fanasa-review-service"><b>${esc(x.code)}</b> ${esc(x.name)} <i>${esc(modelLabels[x.model])} · ${esc(tierFor(x))}</i></span>`).join('') : '<span class="fanasa-empty-inline">بدون سرویس</span>'}</div><div class="summary-box"><h4>پیش‌نمایش متن سند</h4><div class="fanasa-contract-preview">این قرارداد فی‌مابین <b>${esc(w.party || 'طرف قرارداد')}</b> و گروه انتخاب، با موضوع <b>${esc(w.title || 'موضوع قرارداد')}</b> منعقد می‌گردد. خدمات و سطح خدمت طبق snapshot کاتالوگ فن‌آسا در تاریخ ایجاد قرارداد پیوست می‌شود.</div></div><div class="fanasa-ready">✓ اطلاعات اصلی و snapshot سرویس‌ها آماده ثبت هستند</div>`;
  }

  function openFanasaWizard() {
    const initialSla = {}; [...fanasa.selected].forEach(code => { const x = service(code); if (x) initialSla[code] = x.tier; });
    state.wizard = { step: 1, template: 'it', title: '', party: '', type: 'خدمات فناوری اطلاعات', unit: 'ستاد مرکزی', owner: 'محمد رضایی', amount: '', start: '', end: '', customerId: '', managerId: '', services: [...fanasa.selected], slaByService: initialSla };
    state.modal = 'wizard';
    renderModal();
  }

  function saveFanasaFields() {
    originalSaveFields();
    const q = id => document.getElementById(id)?.value ?? '';
    if (state.wizard.step === 2) Object.assign(state.wizard, { customerId: q('wCustomer'), managerId: q('wManager') });
    if (state.wizard.step === 3) { state.wizard.slaByService = state.wizard.slaByService || {}; document.querySelectorAll('[data-fanasa-sla-for]').forEach(e => { state.wizard.slaByService[e.dataset.fanasaSlaFor] = e.value; }); }
  }

  renderView = v => v === 'catalog' ? catalogView() : v === 'customers' ? customersView() : v === 'managers' ? managersView() : originalRenderView(v);
  bindView = () => { originalBindView(); bindFanasaView(); };
  wizardBody = fanasaWizardBody;
  openWizard = openFanasaWizard;
  saveFields = saveFanasaFields;

  function bindFanasaView() {    document.querySelectorAll('[data-action="new-contract"]').forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        openFanasaWizard();
      };
    });    // Direct bindings keep nested summary controls reliable for mouse and keyboard.
    document.querySelectorAll('[data-fanasa-center]').forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const id = button.dataset.fanasaCenter;
        const remove = button.dataset.fanasaSelected === 'true';
        filteredServices().filter(x => x.centerId === id).forEach(x => remove ? fanasa.selected.delete(x.code) : fanasa.selected.add(x.code));
        setView('catalog');
      };
    });
    const search = document.getElementById('fanasaSearch'); if (search) search.oninput = e => { fanasa.filters.search = e.target.value; setView('catalog'); const el = document.getElementById('fanasaSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
    [['fanasaCenterFilter', 'center'], ['fanasaSlaFilter', 'sla'], ['fanasaModelFilter', 'model'], ['fanasaDeliveryFilter', 'delivery']].forEach(([id, key]) => { const el = document.getElementById(id); if (el) el.onchange = e => { fanasa.filters[key] = e.target.value; setView('catalog'); }; });
    const cs = document.getElementById('fanasaCustomerSearch'); if (cs) cs.oninput = e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('[data-fanasa-customer-row]').forEach(row => { row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  }

  document.addEventListener('change', e => {
    const input = e.target.closest('[data-fanasa-service]');
    if (input) { if (input.checked) fanasa.selected.add(input.dataset.fanasaService); else fanasa.selected.delete(input.dataset.fanasaService); setView('catalog'); }
  });
  document.addEventListener('click', e => {
    const center = e.target.closest('[data-fanasa-center]');
    if (center) { const id = center.dataset.fanasaCenter; filteredServices().filter(x => x.centerId === id).forEach(x => center.dataset.fanasaSelected === 'true' ? fanasa.selected.delete(x.code) : fanasa.selected.add(x.code)); setView('catalog'); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'fanasa-create-from-selection') { openFanasaWizard(); return; }
    if (action === 'fanasa-reset-selection') { fanasa.selected.clear(); setView('catalog'); return; }
    if (action === 'fanasa-export-customers') { toast('خروجی مشتریان هلدینگی در نسخه دمو آماده دانلود است.'); return; }
    if (action === 'fanasa-new-customer' || action === 'fanasa-new-manager' || action === 'fanasa-edit-customer' || action === 'fanasa-edit-manager' || action === 'fanasa-map-manager') { openEntryDialog(action, e.target.closest('[data-customer]')?.dataset.customer || e.target.closest('[data-manager]')?.dataset.manager); }
  });

  function openEntryDialog(action, id) {
    const isCustomer = action.includes('customer');
    const existing = isCustomer ? fanasa.customers.find(c => c.id === id) : fanasa.managers.find(m => m.id === id);
    const title = action.startsWith('fanasa-edit') ? (isCustomer ? 'ویرایش مشتری' : 'ویرایش اکانت منیجر') : isCustomer ? 'مشتری جدید' : 'اکانت منیجر جدید';
    const body = isCustomer ? `<div class="form-grid"><div class="form-field full"><label>نام مشتری</label><input id="fanasaEntryName" value="${esc(existing?.name || '')}" placeholder="نام شرکت یا واحد هلدینگ" /></div><div class="form-field"><label>واحد بهره‌بردار</label><input id="fanasaEntryUnit" value="${esc(existing?.unit || '')}" /></div><div class="form-field"><label>اکانت منیجر</label><select id="fanasaEntryManager">${fanasa.managers.map(m => `<option value="${esc(m.id)}" ${existing?.manager === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div></div>` : `<div class="form-grid"><div class="form-field full"><label>نام اکانت منیجر</label><input id="fanasaEntryName" value="${esc(existing?.name || '')}" placeholder="نام و نام خانوادگی" /></div><div class="form-field"><label>نقش</label><input id="fanasaEntryRole" value="${esc(existing?.role || 'Account Manager')}" /></div><div class="form-field"><label>ایمیل</label><input id="fanasaEntryEmail" value="${esc(existing?.email || '')}" /></div></div>`;
    document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" id="fanasaEntryBackdrop"><section class="modal fanasa-entry-modal"><div class="modal-header"><div><h2>${title}</h2><p>اطلاعات عملیاتی دمو؛ مدیریت دسترسی در این مرحله فعال نیست.</p></div><button class="icon-btn" data-action="fanasa-close-entry">×</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn btn-secondary" data-action="fanasa-close-entry">انصراف</button><button class="btn btn-primary" data-action="fanasa-save-entry" data-entry-type="${isCustomer ? 'customer' : 'manager'}" data-entry-id="${esc(id || '')}">ذخیره</button></div></section></div>`;
  }
  document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'fanasa-close-entry') { document.getElementById('modalRoot').innerHTML = ''; return; }
    if (action !== 'fanasa-save-entry') return;
    const type = e.target.closest('[data-action]').dataset.entryType; const id = e.target.closest('[data-action]').dataset.entryId; const q = x => document.getElementById(x)?.value.trim() || '';
    if (type === 'customer') { const c = id ? fanasa.customers.find(x => x.id === id) : { id: `CUS-${String(fanasa.customers.length + 1).padStart(3, '0')}`, services: 0, industry: 'سایر', status: 'در حال onboarding' }; if (c) { c.name = q('fanasaEntryName') || 'مشتری جدید'; c.unit = q('fanasaEntryUnit') || 'واحد جدید'; c.manager = q('fanasaEntryManager') || fanasa.managers[0]?.id; if (!id) fanasa.customers.push(c); } } else { const m = id ? fanasa.managers.find(x => x.id === id) : { id: `m-${String(fanasa.managers.length + 1).padStart(3, '0')}`, customerIds: [], color: 'blue' }; if (m) { m.name = q('fanasaEntryName') || 'اکانت منیجر جدید'; m.role = q('fanasaEntryRole') || 'Account Manager'; m.email = q('fanasaEntryEmail'); if (!id) fanasa.managers.push(m); } }
    document.getElementById('modalRoot').innerHTML = ''; toast('اطلاعات با موفقیت ذخیره شد.'); setView(state.view);
  });

  // Load the local snapshot first; the product remains functional if a static server is offline.
  fetch('/fanasa-catalog-observed.json').then(r => r.ok ? r.json() : Promise.reject(new Error('snapshot unavailable'))).then(json => { fanasa.snapshot = json; if (state.view === 'catalog') setView('catalog'); }).catch(() => { fanasa.snapshot = { catalog: { centers: 14, services: 87 }, centers: [], pricingModelByCode: {}, slaTiers: {} }; });
  setView(state.view);
})();
