# ظرفیت سرویس و اصلاح TPS — ۱۰ اکتبر ۲۰۲۶

## اولویت معماری

بخش ۶ معماری Fanasa Platform Control Center و اولویت FPC-003 مبناست:
سند تجاری در NeoContract، projection و policy نزد مرکز، enforcement در Gateway.
نسخه قیمت یا سند جای configRevision مستقل تخصیص را نمی‌گیرد.

## قابلیت و مرز اتصال

تب ظرفیت سرویس، TPS/burst/quota را با بند و hash منبع استخراج می‌کند؛ قیمت،
حداقل، هدف، بازه و چند مقدار مبهم‌اند. بازبینی صریح و تأیید meter درخواست لازم
است. مدرک امضا با تاریخ معتبر، execution فعال و بازه قرارداد ثبت می‌شود؛
اصلاح نرخ، الحاقیه تازه تأییدشده، نسخه تازه و تاریخ اثر بعدی لازم دارد.
متن، مبلغ، نسخه signed و وضعیت حقوقی کل الحاقیه تغییر نمی‌کنند.

migration ۸ سه جدول ظرفیت، فرمان و outbox را می‌سازد. امضا/audit/outbox تراکنشی
و idempotent هستند؛ SQL تاریخچه و payload را حفظ می‌کند. backup شامل هر سه است.
adapter فقط binding مرکزی مصوب را به projection-event 2.0.0 تبدیل می‌کند؛
allocation/scope ثابت و configRevision مستقل‌اند. HTTP 200 بدون receipt نسخه،
تخصیص، scope و hash حدود تأیید اعمال نیست.

dispatcher اپراتوری غیرفعال است. receiver پایدار، producer محدود، UUIDها و
binding مصوب، lifecycle توقف/ادامه/خاتمه، expiry/invalidation و enforcement
زنده باید در مرکز پذیرفته شوند. APISIX/receiver زنده در این بازدید VPS تأیید
نشد. هیچ grant یا TPS فرضی برای پنج پیشنهاد واقعی ساخته نشده است.

## پذیرش محلی

- شش آزمون capacity/migration/backup موفق؛ منع تاریخ امضای آینده، تلاش مجدد،
  rollback، immutability، تاریخ اثر و receipt شامل‌اند.
- شش آزمون مجوز گردش/SSO موفق؛ مشاهده‌گر و بازبین مالی نمی‌توانند از API ظرفیت
  بنویسند، نقش جعلی بدنه بی‌اثر است و بازبین حقوقی با هویت معتبر امضا ثبت می‌کند.
- سه سناریوی مرورگر دسکتاپ ۱۴۴۰، موبایل ۳۹۰ و مشاهده‌گر موفق؛ مسیر مثبت امضا
  pending ایجاد می‌کند، بدون مبنای امضا رویدادی ساخته نمی‌شود و overflow نداریم.
- compatibility با projector/evaluator واقعی مالک policy: TPS از ۵ به ۱۲،
  configRevision مستقل ۴۱/۴۲، تاریخ اثر آینده و scope/allocation ثابت: موفق.
- Lua واقعی PEP/limiter با transport stub و fakeredis و سه replica: مصرف قبلی ۴،
  توکن باقی ۶ و quota باقی ۱۹۹۶ پس از اصلاحیه حفظ شد؛ نسخه قدیمی رد شد.
  این آزمون native APISIX یا Redis زنده نیست.

## حفاظت انتشار

پشتیبان custom معتبر `/opt/neocontract-backups/capacity-20261010t133404z.dump`
با ۵۹۱۷۲۱ بایت و تصویر بازگشت
`neocontract-app:before-capacity-20261010t133404z` آماده‌اند. fingerprint هشت جدول
تجاری/اجرایی در state خصوصی ثبت شده است. نتیجه CI نسخه دقیق، پذیرش PostgreSQL
جداگانه و انتشار پس از انجام در همین گزارش ثبت می‌شود.

[راهنمای اپراتور و محدودیت‌ها](SERVICE-CAPACITY.md)
