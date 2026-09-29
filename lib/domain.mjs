import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, code = 'validation') { super(message); this.status = status; this.code = code; }
}
export function requireValue(condition, message, status = 400) { if (!condition) throw new AppError(message, status); }
export const clone = value => structuredClone(value);
export function text(value, label, { optional = false, max = 500 } = {}) {
  const result = String(value ?? '').trim();
  requireValue(optional || result.length > 0, `${label} را وارد کنید.`);
  requireValue(result.length <= max, `${label} بیش از حد طولانی است.`);
  return result;
}
export function number(value, label, { min = 0, max = 1e16, fallback = 0, required = false } = {}) {
  const normalized = typeof value === 'string' ? value.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬]/g,'') : value;
  requireValue(!required || typeof normalized === 'number' || (typeof normalized === 'string' && normalized.trim().length > 0), `${label} را وارد کنید.`);
  const result = normalized === '' || normalized == null ? fallback : Number(normalized);
  requireValue(Number.isFinite(result) && result >= min && result <= max, `${label} معتبر نیست.`);
  return result;
}
export function validateStages(stages, original = []) {
  requireValue(Array.isArray(stages) && stages.length > 0 && stages.length <= 30, 'بین یک تا ۳۰ مرحله فرآیند تعریف کنید.');
  const ids = new Set();
  const result = stages.map(s => {
    const id = String(s.id || randomUUID());
    requireValue(!ids.has(id), 'شناسه مرحله تکراری است.'); ids.add(id);
    const item = { id, name: text(s.name, 'نام مرحله', { max: 150 }), role: text(s.role, 'نقش مرحله', { max: 120 }), slaDays: number(s.slaDays, 'مهلت مرحله', { min: 0, max: 365, fallback: 2 }), required: Boolean(s.required), enabled: s.enabled !== false };
    requireValue(Number.isInteger(item.slaDays), 'مهلت مرحله باید تعداد روز صحیح باشد.');
    requireValue(!item.required || item.enabled, 'مرحله الزامی را نمی‌توان غیرفعال کرد.');
    return item;
  });
  for (const s of original.filter(s => s.required)) {
    const found = result.find(x => x.id === s.id);
    requireValue(found && found.required && found.enabled, `مرحله الزامی «${s.name}» باید حفظ شود.`);
    requireValue(found.role === s.role, `نقش مرحله الزامی «${s.name}» باید حفظ شود.`);
  }
  requireValue(result.some(s => s.enabled), 'حداقل یک مرحله فعال لازم است.');
  return result;
}
export function validateTemplate(input, previous = {}) {
  const body = text(input.body ?? previous.body, 'متن الگو', { max: 60000 });
  const variables = [...body.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map(x => x[1]);
  const allowed = ['title','party','customerName','managerName','amount','start','end','services','sla','paymentTerms','unit','contractNumber','owner'];
  requireValue(variables.every(v => allowed.includes(v)), 'متغیر ناشناخته در متن الگو وجود دارد.');
  return { ...previous, title: text(input.title ?? previous.title, 'نام الگو'), category: text(input.category ?? previous.category, 'دسته الگو', { optional: true }), description: text(input.description ?? previous.description, 'شرح الگو', { optional: true, max: 3000 }), body, stages: validateStages(input.stages ?? previous.stages), revenueModels: Array.isArray(input.revenueModels) ? input.revenueModels.filter(x => typeof x === 'string') : previous.revenueModels || [], serviceCodes: Array.isArray(input.serviceCodes) ? input.serviceCodes.filter(x => typeof x === 'string') : previous.serviceCodes || [] };
}
function date(value, label) {
  const s = text(value, label, { max: 10 });
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), `${label} باید تاریخ معتبر میلادی باشد.`);
  requireValue(new Date(s).toISOString().slice(0,10) === s, `${label} معتبر نیست.`);
  return s;
}
export function prepareContract(input, { templates, customers, managers, catalog }, { createdAt = new Date().toISOString(), contractNumber = 'پس از ثبت' } = {}) {
  const template = templates.find(x => x.id === input.templateId && (!input.templateVersionId || x.templateVersionId === input.templateVersionId));
  requireValue(template && template.status === 'published', 'یک نسخه منتشرشده الگو را انتخاب کنید.');
  const customer = customers.find(x => x.id === input.customerId && x.status !== 'inactive');
  requireValue(customer, 'مشتری معتبر انتخاب کنید.');
  const managerId = input.managerId || customer.managerId;
  const manager = managerId ? managers.find(x => x.id === managerId && x.status !== 'inactive') : null;
  requireValue(!managerId || manager, 'مدیر حساب معتبر انتخاب کنید.');
  const title = text(input.title, 'عنوان قرارداد');
  const party = text(input.party || customer.name, 'طرف قرارداد');
  const stages = validateStages(input.stages || template.stages, template.stages);
  requireValue(Array.isArray(input.services || []) && (input.services || []).length <= 200, 'فهرست سرویس معتبر نیست.');
  const seen = new Set();
  const services = (input.services || []).map(choice => {
    requireValue(!seen.has(choice.code), 'یک سرویس دوبار انتخاب شده است.'); seen.add(choice.code);
    const source = catalog.services.find(s => s.code === choice.code);
    requireValue(source, 'کد سرویس در کاتالوگ وجود ندارد.');
    const slaTier = choice.slaTier || choice.tier;
    const sla = catalog.slaProfiles.find(s => (s.code || s.tier) === slaTier);
    requireValue(sla, `سطح خدمت «${source.name}» را انتخاب کنید.`);
    const revenueModel = choice.revenueModel || source.model;
    requireValue(catalog.revenueModels.some(m => (m.code || m.id) === revenueModel), 'مدل درآمدی نامعتبر است.');
    const delivery = text(choice.delivery, 'روش ارائه', { max: 30 });
    requireValue(['self_service','automatic','managed','project','on_request'].includes(delivery), 'روش ارائه معتبر نیست.');
    return { code: source.code, name: source.name, centerId: source.centerId, centerName: source.centerName, model: revenueModel, revenueModel, quantity: number(choice.quantity, 'تعداد', { min: 0.0001, fallback: 1 }), unitPrice: number(choice.unitPrice, 'قیمت واحد', { required: true }), currency: 'IRR', delivery, slaTier, sla: clone(sla), sourceSnapshot: clone(source), source: clone(source.sourceUrl || source.source || catalog.source), sourceStatus: source.verificationStatus || catalog.verificationStatus, slaSelection: source.tier === slaTier ? 'source-profile-selected' : 'negotiated-selection', capturedAt: createdAt };
  });
  const start = date(input.start, 'تاریخ شروع'), end = date(input.end, 'تاریخ پایان');
  requireValue(end >= start, 'تاریخ پایان پیش از شروع است.');
  const terms = { title, party, amount: number(input.amount, 'مبلغ قرارداد', { required: true }), currency: 'IRR', start, end, unit: text(input.unit || customer.unit, 'واحد', { optional: true }), owner: text(input.owner, 'مالک فرآیند', { max: 150 }), paymentTerms: text(input.paymentTerms, 'شرایط پرداخت', { max: 4000 }) };
  const serviceText = services.map(s => `${s.code} — ${s.name}؛ مدل: ${s.model}؛ تعداد: ${s.quantity}؛ قیمت واحد: ${s.unitPrice} ریال`).join('\n') || 'طبق موضوع و حدود کار مندرج در قرارداد';
  const slaText = services.map(s => `${s.code}: ${s.slaTier}؛ ${s.sla.availability || s.sla.availabilityPct || s.sla.availability_pct || ''}؛ پاسخ ${s.sla.response || s.sla.firstResponse || ''}؛ رفع ${s.sla.resolution || s.sla.resolutionTarget || ''}؛ ${s.sla.coverage || ''}`).join('\n') || 'طبق تعهدات مندرج در متن قرارداد';
  const variables = { ...terms, customerName: customer.name, managerName: manager?.name || 'تعیین نشده', services: serviceText, sla: slaText, contractNumber };
  const body = text(input.body || template.body, 'متن سند', { max: 60000 });
  let document = body.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k) => variables[k] == null ? '—' : String(variables[k]));
  requireValue(!/\{\{.*?\}\}/.test(document), 'متغیر حل‌نشده در متن سند باقی مانده است.');
  if (services.length) document += '\n\nپیوست خدمات و تعهدات سطح خدمت\n' + serviceText + '\n' + slaText + '\n\nشرایط نرخ‌نامه مرجع (مبالغ توافق‌شده قرارداد در بالا آمده است)\n' + services.map(s => [s.code, s.sourceSnapshot.unit || '', s.sourceSnapshot.price?.rawText || '', s.sourceSnapshot.sourceUrl || ''].filter(Boolean).join('\n')).join('\n\n');
  if (terms.paymentTerms) document += '\n\nشرایط پرداخت توافق‌شده\n' + terms.paymentTerms;
  const snapshot = { template: clone(template), customer: clone(customer), manager: clone(manager), services, stages, terms, createdAt, sourceStatus: catalog.verificationStatus, catalogTerms: { source: clone(catalog.source), observedAt: catalog.observedAt, pricingTerms: clone(catalog.pricingTerms || []), slaRules: clone(catalog.slaRules || []) }, document };
  return { ...terms, templateId: template.id, templateVersionId: template.templateVersionId, customerId: customer.id, managerId: manager?.id || null, services, stages, document, snapshot };
}
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function documentHtml(contract) {
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>${escapeHtml(contract.title)}</title><style>body{font:16px/2 Tahoma,Arial;max-width:850px;margin:40px auto;padding:24px;color:#17223a}h1{font-size:24px}pre{font:inherit;white-space:pre-wrap}small{color:#64748b}@media print{body{margin:0}}</style><h1>${escapeHtml(contract.title)}</h1><small>${escapeHtml(contract.number || '')} · نسخه ثبت‌شده قرارداد</small><pre>${escapeHtml(contract.document)}</pre></html>`;
}
