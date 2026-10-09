import { randomUUID } from 'node:crypto';
import { calculatePricing, pricingDocument, PricingError } from '../public/pricing.js';
import {renderContractDocument} from './contract-document.mjs';

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
  let previousRequiredIndex = -1;
  for (const s of original.filter(s => s.required)) {
    const index = result.findIndex(x => x.id === s.id);
    const found = result[index];
    requireValue(found && found.required && found.enabled, `مرحله الزامی «${s.name}» باید حفظ شود.`);
    requireValue(found.role === s.role, `نقش مرحله الزامی «${s.name}» باید حفظ شود.`);
    requireValue(index > previousRequiredIndex, 'ترتیب مراحل الزامی نسخه منتشرشده الگو باید حفظ شود.');
    previousRequiredIndex = index;
  }
  requireValue(result.some(s => s.enabled), 'حداقل یک مرحله فعال لازم است.');
  return result;
}
const deliveryLabels = { self_service:'سلف‌سرویس', automatic:'خودکار', managed:'مدیریت‌شده', project:'درخواستی / پروژه‌ای', on_request:'درخواستی' };
const placeholderNames = new Set(['title','party','customerName','managerName','amount','start','end','services','sla','paymentTerms','unit','contractNumber','owner','pricing']);
function templatePlaceholders(body) {
  const tokens = [];
  let offset = 0;
  while (offset < body.length) {
    const opening = body.indexOf('{{', offset), closing = body.indexOf('}}', offset);
    if (opening === -1 && closing === -1) break;
    requireValue(opening !== -1 && (closing === -1 || opening < closing), 'ساختار متغیر در متن معتبر نیست.');
    const end = body.indexOf('}}', opening + 2);
    requireValue(end !== -1 && body[opening - 1] !== '{' && body[end + 2] !== '}', 'ساختار متغیر در متن معتبر نیست.');
    const match = /^[^\S\r\n\u2028\u2029]*([a-zA-Z]+)[^\S\r\n\u2028\u2029]*$/.exec(body.slice(opening + 2, end));
    requireValue(match, 'نام متغیر باید در یک خط و با ساختار معتبر نوشته شود.');
    requireValue(placeholderNames.has(match[1]), 'متغیر ناشناخته در متن وجود دارد.');
    tokens.push({ start: opening, end: end + 2, name: match[1] });
    offset = end + 2;
  }
  return tokens;
}
function renderTemplateBody(body, variables) {
  let document = '', offset = 0;
  for (const token of templatePlaceholders(body)) {
    const value = Object.hasOwn(variables, token.name) ? variables[token.name] : null;
    document += body.slice(offset, token.start) + (value == null ? '—' : String(value));
    offset = token.end;
  }
  return document + body.slice(offset);
}
export function validateTemplate(input, previous = {}) {
  const body = text(input.body ?? previous.body, 'متن الگو', { max: 60000 });
  templatePlaceholders(body);
  return { ...previous, title: text(input.title ?? previous.title, 'نام الگو'), category: text(input.category ?? previous.category, 'دسته الگو', { optional: true }), description: text(input.description ?? previous.description, 'شرح الگو', { optional: true, max: 3000 }), body, stages: validateStages(input.stages ?? previous.stages), revenueModels: Array.isArray(input.revenueModels) ? input.revenueModels.filter(x => typeof x === 'string') : previous.revenueModels || [], serviceCodes: Array.isArray(input.serviceCodes) ? input.serviceCodes.filter(x => typeof x === 'string') : previous.serviceCodes || [] };
}
function date(value, label) {
  const s = text(value, label, { max: 10 });
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), `${label} باید تاریخ معتبر میلادی باشد.`);
  requireValue(new Date(s).toISOString().slice(0,10) === s, `${label} معتبر نیست.`);
  return s;
}
function availabilityText(sla) {
  const value = [sla.availability, sla.availabilityPct, sla.availabilityPercent, sla.availability_pct].find(value => value != null && String(value).trim() !== '');
  if (value == null) return '';
  const label = String(value).trim();
  return typeof value === 'number' || /^[0-9۰-۹٠-٩]+(?:[.٫][0-9۰-۹٠-٩]+)?$/.test(label) ? `${label}%` : label;
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
  let pricing = null;
  if (input.pricingPlan != null) {
    try { pricing = calculatePricing(input.pricingPlan); }
    catch (error) { if (error instanceof PricingError) throw new AppError(error.message, 400, 'pricing_validation'); throw error; }
    for (const item of pricing.items.filter(item => item.serviceCode)) {
      requireValue((input.services || []).some(service => service.code === item.serviceCode), 'خدمت مرتبط با آیتم قیمت‌گذاری در این قرارداد انتخاب نشده است.');
    }
  }
  const seen = new Set();
  const services = (input.services || []).map(choice => {
    const priced = pricing?.items.find(item => item.serviceCode === choice.code);
    if (priced) choice = { ...choice, quantity: priced.quantity, unitPrice: priced.unitPrice };
    requireValue(!seen.has(choice.code), 'یک سرویس دوبار انتخاب شده است.'); seen.add(choice.code);
    const source = catalog.services.find(s => s.code === choice.code);
    requireValue(source, 'کد سرویس در کاتالوگ وجود ندارد.');
    const slaTier = choice.slaTier || choice.tier;
    const sla = catalog.slaProfiles.find(s => (s.code || s.tier) === slaTier);
    requireValue(sla, `سطح خدمت «${source.name}» را انتخاب کنید.`);
    const revenueModel = choice.revenueModel || source.model;
    requireValue(catalog.revenueModels.some(m => (m.code || m.id) === revenueModel), 'مدل درآمدی نامعتبر است.');
    const delivery = text(choice.delivery, 'روش ارائه', { max: 30 });
    requireValue(Object.hasOwn(deliveryLabels, delivery), 'روش ارائه معتبر نیست.');
    return { code: source.code, name: source.name, centerId: source.centerId, centerName: source.centerName, model: revenueModel, revenueModel, quantity: number(choice.quantity, 'تعداد', { min: 0.000001, fallback: 1 }), unitPrice: number(choice.unitPrice, 'قیمت واحد', { required: true }), currency: 'IRR', delivery, slaTier, sla: clone(sla), sourceSnapshot: clone(source), source: clone(source.sourceUrl || source.source || catalog.source), sourceStatus: source.verificationStatus || catalog.verificationStatus, slaSelection: source.tier === slaTier ? 'source-profile-selected' : 'negotiated-selection', capturedAt: createdAt };
  });
  const start = date(input.start, 'تاریخ شروع'), end = date(input.end, 'تاریخ پایان');
  requireValue(end >= start, 'تاریخ پایان پیش از شروع است.');
  const terms = { title, party, amount: pricing ? pricing.total : number(input.amount, 'مبلغ قرارداد', { required: true }), currency: 'IRR', start, end, unit: text(input.unit || customer.unit, 'واحد', { optional: true }), owner: text(input.owner, 'مالک فرآیند', { max: 150 }), paymentTerms: text(input.paymentTerms, 'شرایط پرداخت', { max: 4000 }) };
  const serviceText = services.map(s => `${s.code} — ${s.name}؛ مدل: ${s.model}؛ روش ارائه: ${deliveryLabels[s.delivery]}؛ تعداد: ${s.quantity}؛ قیمت واحد: ${s.unitPrice} ریال`).join('\n') || 'طبق موضوع و حدود کار مندرج در قرارداد';
  const slaText = services.map(s => `${s.code}: ${s.slaTier}؛ ${availabilityText(s.sla)}؛ پاسخ ${s.sla.response || s.sla.firstResponse || ''}؛ رفع ${s.sla.resolution || s.sla.resolutionTarget || ''}؛ ${s.sla.coverage || ''}`).join('\n') || 'طبق تعهدات مندرج در متن قرارداد';
  const pricingText = pricing ? pricingDocument(pricing) : '';
  const variables = { ...terms, customerName: customer.name, managerName: manager?.name || 'تعیین نشده', services: serviceText, sla: slaText, contractNumber, pricing: pricingText };
  const body = text(input.body || template.body, 'متن سند', { max: 60000 });
  let document = renderTemplateBody(body, variables);
  if (pricing && !templatePlaceholders(body).some(token => token.name === 'pricing')) document += '\n\n' + pricingText;
  if (services.length) document += '\n\nپیوست خدمات و تعهدات سطح خدمت\n' + serviceText + '\n' + slaText + '\n\nشرایط نرخ‌نامه مرجع (مبالغ توافق‌شده قرارداد در بالا آمده است)\n' + services.map(s => [s.code, s.sourceSnapshot.unit || '', s.sourceSnapshot.price?.rawText || '', s.sourceSnapshot.sourceUrl || ''].filter(Boolean).join('\n')).join('\n\n');
  if (terms.paymentTerms) document += '\n\nشرایط پرداخت توافق‌شده\n' + terms.paymentTerms;
  const snapshot = { template: clone(template), customer: clone(customer), manager: clone(manager), services, stages, terms, createdAt, sourceStatus: catalog.verificationStatus, catalogTerms: { source: clone(catalog.source), observedAt: catalog.observedAt, pricingTerms: clone(catalog.pricingTerms || []), slaRules: clone(catalog.slaRules || []) }, document, ...(pricing ? { pricing } : {}) };
  return { ...terms, templateId: template.id, templateVersionId: template.templateVersionId, customerId: customer.id, managerId: manager?.id || null, services, stages, document, snapshot };
}
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function documentHtml(contract,options) {
  return renderContractDocument(contract,options);
}
