import { calculatePricing, pricingDocument, PricingError } from './pricing.js';

const nf = n => new Intl.NumberFormat('fa-IR', {maximumFractionDigits:6}).format(n);
const money = n => nf(n)+' ریال';
const requireShape = (condition, message) => { if(!condition)throw new PricingError(message); };
const fixedIds = ['design','deployment','training','configuration','support'];
const usageIds = ['cpu','ram','ssd','ipv4','backup','ingress'];

// Preserve the negotiated structure while allowing rates, quantities and dependencies to change.
export function titanQuote(source, input) {
  const pricing=calculatePricing(input),usage=source.id==='titan-04';
  const ids=usage?usageIds:fixedIds;
  requireShape(pricing.items.length===ids.length && ids.every(id=>pricing.items.some(i=>i.id===id)),
    'اقلام اصلی پیشنهاد متصل باید حفظ شوند؛ برای ساختار متفاوت یک مدل مستقل بسازید.');
  const item=id=>pricing.items.find(i=>i.id===id);
  if(usage) {
    // This rate bracket covers Iran inbound usage above the shared 250 GB allowance up to 10 TB.
    requireShape(item('ingress').quantity<=9990,'این نرخ ترافیک فقط تا ۱۰ ترابایت است؛ برای مصرف بیشتر استعلام جداگانه لازم است.');
    requireShape(Number.isSafeInteger(pricing.total*12),'مبلغ سالانه خارج از محدوده امن است.');
    return {pricing,usage:true,annual:pricing.total*12,priceSummary:'نمونه مصرف ماهانه '+money(pricing.total)+'؛ صورتحساب قطعی بر پایه مصرف مصوب'};
  }
  const support=item('support').amount,nonSupport=pricing.total-support;
  // Allocate rounded IRR once, then put the remainder in the last installment.
  const part=weight=>Number((BigInt(nonSupport)*BigInt(weight)+42n)/85n);
  const installments=[part(10),part(35),part(20)];
  installments.push(nonSupport-installments.reduce((a,b)=>a+b,0),support);
  const quarter=Math.floor(support/4),quarters=[quarter,quarter,quarter,support-3*quarter];
  return {pricing,usage:false,installments,quarters,costs:[item('design').amount+item('deployment').amount,item('training').amount,item('configuration').amount,support],
    priceSummary:money(pricing.total)+'، بدون مالیات بر ارزش افزوده'};
}

export function titanProposal(source, input) {
  const q=titanQuote(source,input),p=q.pricing,item=id=>p.items.find(i=>i.id===id);
  let body=source.document;
  if(q.usage) {
    const names={cpu:'پردازنده Basic',ram:'حافظه Basic',ssd:'دیسک SSD',ipv4:'نشانی IPv4 نخست',backup:'بکاپ',ingress:'ترافیک دریافت مازاد'};
    for(const [id,title] of Object.entries(names)) {
      const row=item(id);
      body=body.split('\n').map(line=>line.startsWith(title+' |')?line.split(' |').map((cell,i)=>i===2?' '+money(row.unitPrice):cell).join(' |'):line).join('\n');
    }
    body=body.replace(/^مثال غیرتعهدآور برای یک ماه کامل:.*$/m,
      'مثال غیرتعهدآور برای یک ماه کامل: '+p.items.map(i=>nf(i.quantity)+' × '+i.title).join('؛ ')+'. جمع نمونه '+money(p.total)+' در ماه و '+money(q.annual)+' برای دوازده ماه با مصرف و نرخ ثابت است. مقدار ترافیک مازاد پس از کسر سهمیه ۲۵۰ گیگابایت کل حساب وارد می‌شود. این مثال سفارش زودکس یا حداقل پرداخت نیست؛ مبلغ قطعی هر ماه از داده مصرف و سفارش مصوب به دست می‌آید.');
  } else {
    body=body.replace(/^مبلغ کل خدمات موضوع قرارداد .*$/m,
      'مبلغ کل پیشنهادی خدمات موضوع قرارداد '+money(p.total)+'، معادل '+nf(p.total/10)+' تومان، بدون مالیات بر ارزش افزوده است. این مبلغ از نرخ‌ها و اقلام نسخه جاری مدل قیمت‌گذاری محاسبه شده؛ تفکیک هزینه و اقساط در پیوست ت درج شده و واحد حاکم در پرداخت و تفسیر مبالغ، ریال است.');
    body=body.replace(/در مجموع [۰-۹٬]+ ساعت تدریس و کارگاه/g,'در مجموع '+nf(item('training').quantity)+' ساعت تدریس و کارگاه');
    body=body.replace(/مجموع تدریس و کارگاه: [۰-۹٬]+ ساعت/g,'مجموع تدریس و کارگاه: '+nf(item('training').quantity)+' ساعت');
    body=body.replace(/دوازده ماه (همراهی و پشتیبانی|از پذیرش نهایی)/g,(_,s)=>nf(item('support').quantity)+' ماه '+(s==='از پذیرش نهایی'?s:'همراهی و پشتیبانی'));
    body=body.replace(/^مبلغ کل [۰-۹٬]+ ریال، معادل .*$/m,
      'مبلغ کل پیشنهادی '+money(p.total)+'، معادل '+nf(p.total/10)+' تومان، بدون مالیات بر ارزش افزوده است. جمع پنج قسط و جمع تفکیک هزینه هرکدام برابر همین مبلغ است. نسخه/تاریخ: ................ .');
    body=body.split('\n').map(line=>{
      const match=line.match(/^([۱-۵])\. .* \|/);
      if(match){const i='۱۲۳۴۵'.indexOf(match[1]);return line.replace(/[۰-۹٬]+ ریال؛ [۰-۹]+٪؛/,
        money(q.installments[i])+'؛ سهم محاسبه‌شده؛').replace('چهار قسط مساوی فصلی؛ پس از تأیید گزارش هر فصل','چهار قسط طبق برنامه توافقی دوره پشتیبانی؛ پس از تأیید گزارش هر دوره');}
      if(line.startsWith('تفکیک بهای اقلام |'))return 'تفکیک بهای اقلام | طراحی و استقرار: '+money(q.costs[0])+'؛ دانش و آموزش: '+money(q.costs[1])+' | پیکربندی و ابزار اختصاصی: '+money(q.costs[2])+'؛ پشتیبانی: '+money(q.costs[3])+' | تفکیک همان مبلغ کل؛ بدون دریافت مجدد؛ مالیات جداگانه در صورت شمول';
      if(line.startsWith('سهم پشتیبانی در چهار قسط فصلی،'))return 'سهم پشتیبانی در چهار قسط با مبالغ '+q.quarters.map(money).join('، ')+' پرداخت می‌شود؛ موعدها در دوره '+nf(item('support').quantity)+' ماهه و پس از تأیید گزارش توافق می‌شوند. این اقساط زیرمجموعه ردیف پنجم‌اند و به مبلغ کل اضافه نمی‌شوند. این مبلغ حق انحصاری یا انتقال مالکیت محصولات پیشین ایجاد نمی‌کند؛ حقوق فناوری طبق ماده ۱۲ و پیوست پ تعیین می‌شود.';
      return line;
    }).join('\n');
  }
  body+='\n\n## پیوست محاسبات نسخه جاری\n\n'+pricingDocument(p)+'\n\n'+(q.usage?
    'مقادیر این مدل نمونه مصرف هستند؛ داده مصرف واقعی، سهمیه مشترک حساب و سفارش مصوب مبنای صورتحساب‌اند. نرخ‌ها از پیشنهاد پیشین وارد شده‌اند و استعلام تازه محسوب نمی‌شوند.':
    'نرخ‌های این مدل از تفکیک مبلغ پیشنهاد قبلی ساخته شده‌اند. تقسیم اولیه سهم طراحی و استقرار به دو قلم با ضرایب ۰٫۳ و ۰٫۷ صرفاً برای نمایش دمو است و نفرساعت یا تعهد جدید ایجاد نمی‌کند. چهار قسط نخست از مبلغ خدمات بدون پشتیبانی با نسبت ۱۰:۳۵:۲۰:۲۰ محاسبه می‌شوند؛ قسط پنجم برابر هزینه پشتیبانی است. گردکردن در قسط آخر تسویه می‌شود. مبلغ توافقی و تأیید طرفین همچنان لازم است.');
  return {...q,body};
}
