// Shared by the browser and API. Monetary calculations use fixed-point integers.
const SCALE = 1000000n;
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
export class PricingError extends Error {}
const check = (condition, message) => { if (!condition) throw new PricingError(message); };
const label = (value, title, max = 200) => {
  const result = String(value ?? '').trim();
  check(result.length > 0 && result.length <= max, `${title} را به‌درستی وارد کنید.`);
  return result;
};
const identifier = value => {
  const result = String(value ?? '');
  check(/^[\w-]{1,80}$/.test(result), 'شناسه نرخ یا آیتم معتبر نیست.');
  return result;
};
function decimal(value, title, { integer = false, positive = false } = {}) {
  const raw = String(value ?? '').trim().replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬]/g, '').replace(/٫/g, '.');
  check(raw.length<=64 && /^\d+(?:\.\d{1,6})?$/.test(raw), `${title} باید عدد نامنفی با حداکثر شش رقم اعشار باشد.`);
  const [whole, fraction = ''] = raw.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  check(scaled <= LIMIT * SCALE && (!positive || scaled > 0n), `${title} خارج از محدوده مجاز است.`);
  check(!integer || scaled % SCALE === 0n, `${title} باید تعداد صحیح ریال باشد.`);
  return scaled;
}
const round = (value, divisor) => (value + divisor / 2n) / divisor;
function exactNumber(value, title) {
  const result = Number(`${value / SCALE}.${String(value % SCALE).padStart(6,'0')}`);
  check(decimal(result,title) === value, `${title} با این اندازه و دقت قابل ذخیره نیست؛ مقدار یا تعداد ارقام اعشار را کاهش دهید.`);
  return result;
}

export function calculatePricing(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'مدل قیمت‌گذاری معتبر نیست.');
  const name = label(input.name, 'نام مدل');
  check(input.currency == null || input.currency === 'IRR', 'واحد پول این مدل ریال است.');
  check(Array.isArray(input.bases) && input.bases.length > 0 && input.bases.length <= 50, 'یک تا ۵۰ نرخ مبنا تعریف کنید.');
  check(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 200, 'یک تا ۲۰۰ آیتم قیمت‌گذاری تعریف کنید.');
  const rates = new Map();
  const bases = input.bases.map(base => {
    check(base && typeof base==='object' && !Array.isArray(base),'نرخ مبنا معتبر نیست.');
    const id = identifier(base.id);
    check(!rates.has(id), 'شناسه نرخ مبنا تکراری است.');
    const amount = decimal(base.amount, 'نرخ مبنا', { integer: true }) / SCALE;
    rates.set(id, amount);
    const source = String(base.source ?? '').trim();
    check(source.length <= 1000, 'توضیح منبع نرخ بیش از حد طولانی است.');
    return { id, name: label(base.name, 'نام نرخ مبنا'), unit: label(base.unit, 'واحد نرخ', 100), amount: Number(amount), source };
  });
  const ids = new Set(), serviceCodes = new Set();
  let total = 0n;
  const items = input.items.map(item => {
    check(item && typeof item==='object' && !Array.isArray(item),'آیتم قیمت‌گذاری معتبر نیست.');
    const id = identifier(item.id);
    check(!ids.has(id), 'شناسه آیتم تکراری است.'); ids.add(id);
    const quantity = decimal(item.quantity, 'مقدار آیتم', { positive: true });
    check(Array.isArray(item.components) && item.components.length > 0 && item.components.length <= 50, 'برای هر آیتم حداقل یک نرخ مبنا انتخاب کنید.');
    const used = new Set();
    let unitPrice = 0n;
    const components = item.components.map(component => {
      check(component && typeof component==='object' && !Array.isArray(component),'وابستگی نرخ مبنا معتبر نیست.');
      const baseId = identifier(component.baseId);
      check(rates.has(baseId), 'آیتم به نرخ مبنای حذف‌شده یا نامعتبر اشاره می‌کند.');
      check(!used.has(baseId), 'هر نرخ مبنا را در یک آیتم فقط یک بار انتخاب کنید.'); used.add(baseId);
      const coefficient = decimal(component.coefficient, 'ضریب نرخ', { positive: true });
      unitPrice += rates.get(baseId) * coefficient;
      return { baseId, coefficient: exactNumber(coefficient,'ضریب نرخ') };
    });
    const amount = round(unitPrice * quantity, SCALE * SCALE);
    check(amount <= LIMIT && unitPrice <= LIMIT * SCALE, 'مبلغ آیتم خارج از محدوده امن محاسبه است.');
    total += amount;
    check(total <= LIMIT, 'جمع قرارداد خارج از محدوده امن محاسبه است.');
    const serviceCode = String(item.serviceCode ?? '').trim();
    check(serviceCode.length <= 80, 'کد خدمت معتبر نیست.');
    if (serviceCode) { check(!serviceCodes.has(serviceCode), 'برای هر خدمت یک آیتم قیمت‌گذاری مرتبط تعریف کنید.'); serviceCodes.add(serviceCode); }
    return { id, title: label(item.title, 'عنوان آیتم'), quantity: exactNumber(quantity,'مقدار آیتم'), serviceCode,
      components, unitPrice: exactNumber(unitPrice,'نرخ ترکیبی آیتم'), amount: Number(amount) };
  });
  return { version: 1, name, currency: 'IRR', bases, items, total: Number(total), rounding: 'nearest-IRR-per-item' };
}

export function pricingDocument(quote) {
  const nf = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);
  const bases = new Map(quote.bases.map(base => [base.id, base]));
  return ['پیوست قیمت‌گذاری پویا — ' + quote.name,
    'واحد پول: ریال؛ مبلغ هر آیتم به نزدیک‌ترین ریال گرد می‌شود.',
    'نرخ‌های مبنا:',
    ...quote.bases.map(base => `${base.name}: ${nf(base.amount)} ریال / ${base.unit}${base.source ? '؛ منبع: ' + base.source : ''}`),
    'آیتم‌های قرارداد:',
    ...quote.items.map((item, index) => `${nf(index + 1)}. ${item.title}${item.serviceCode ? ' [' + item.serviceCode + ']' : ''}: ${nf(item.quantity)} × (${item.components.map(c => nf(c.coefficient) + ' × ' + bases.get(c.baseId).name).join(' + ')}) = ${nf(item.amount)} ریال`),
    'جمع آیتم‌ها: ' + nf(quote.total) + ' ریال',
    'این محاسبه بر اساس نرخ‌های ثبت‌شده در این نسخه است؛ دوره، مالیات و تخفیف فقط در صورت تعریف آیتم مربوط در محاسبه لحاظ می‌شوند.'
  ].join('\n');
}
