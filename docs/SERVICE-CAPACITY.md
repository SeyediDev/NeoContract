# ظرفیت سرویس و تغییر TPS با اصلاحیه

این بخش اولویت FPC-003 معماری مرکزی را از سمت مالک قرارداد پیش می‌برد.
مرجع طراحی: `Neo/docs/fanasa-platform-control-center/ARCHITECTURE.md`، بخش ۶، و
`GROWTH-AND-DEVELOPMENT-PLAN.md`. Gateway مصرف را کنترل می‌کند؛ مالک سند تجاری،
نرخ و lifecycle همچنان NeoContract است. رجیستری و policy نزد مرکز باقی می‌مانند.

## مسیر کاربر

در جزئیات قرارداد، «ظرفیت سرویس» را باز کنید. متن قرارداد جاری یا الحاقیه را
انتخاب و استخراج کنید. TPS، burst و سهمیه ماهانه پیشنهادهای مستقل‌اند؛ بند منبع
و مقدارها باید بازبینی شوند. وجود چند عدد، بازه، هدف یا عبارت قیمت به‌عنوان
ابهام نمایش داده می‌شود. عدد قیمتِ هر TPS سقف مصرف نیست. نبود عدد به مصرف نامحدود
تبدیل نمی‌شود. parser محدود به متن ذخیره‌شده است؛ OCR یا فهم عمومی اسناد ندارد.

شناسه ثابت قلم سرویس، کلید محصول مرکزی، محیط و گروه عملیات تعیین می‌شود؛ این
اطلاعات خرید، ثبت محصول یا grant دسترسی نیستند. نگاشت به شناسه‌های مرکزی باید
از مرجع ثبت مرکزی تأیید شود. مدل این مرحله `api.request.admitted / request` است:
TPS شمار درخواست‌های پذیرفته‌شده در ثانیه، burst ظرفیت مستقل token bucket، و quota
شمار درخواست پذیرفته‌شده در ماه تقویمی UTC. «تراکنش مالی» با این meter برابر فرض
نمی‌شود؛ کاربر نگاشت معنایی بند را صریحاً تأیید می‌کند. concurrency و رزرو بودجه
در این پروفایل پشتیبانی نمی‌شوند و پارامتر ناشناخته رد می‌شود.

تاریخ و ساعت فرم به وقت تهران وارد می‌شوند و مستقل از timezone مرورگر به UTC
تبدیل می‌شوند. پایان بازه غیرشامل است؛ تاریخ امضای مدرک حداکثر امروز تهران و
حداکثر روز اثر است.

پیش‌نویس هیچ رویداد اجرایی ایجاد نمی‌کند. برای ثبت مبنای امضاشده محدودیت، پرونده
اجرای قرارداد باید فعال و مدرک امضا، امضاکنندگان و تاریخ امضا ثبت شده باشد.
تأیید داخلی الحاقیه جای امضای طرفین نیست. مدرک امضای محدودیت مستقل ثبت می‌شود؛
وضعیت قانونی کل الحاقیه، متن و پیوست مالی آن با این اقدام بازنویسی نمی‌شود.

برای تغییر نسخه امضاشده، الحاقیه تازه با بازبینی تأییدشده لازم است. نسخه قبلی
ثابت می‌ماند؛ زمان اثر جدید باید پس از نسخه قبلی باشد. نرخ و حدود آینده قبل از
زمان اثر ارسال نمی‌شوند. نسخه مؤثر بر اساس زمان انتخاب می‌شود؛ نسخه منقضی‌شده
به نسخه قبلی fallback نمی‌کند. در توقف/خاتمه اجرای قرارداد، نسخه قابل مصرف محلی
نمایش داده نمی‌شود و dispatcher تغییر Active ارسال نمی‌کند.

## ذخیره‌سازی و مرز ارسال

migration ۸، `contract_service_limits`، فرمان‌های append-only و
`service_limit_outbox` را ایجاد می‌کند. ثبت نسخه، مدرک امضا، رویداد خروجی و audit
در یک تراکنش‌اند. tenant/contract، optimistic revision و idempotency بررسی می‌شوند.
نسخه‌های امضاشده و payload رویداد در SQL نیز ثابت‌اند. JSON backup این سه جدول
را پوشش می‌دهد. پیش‌نویس با مدیر قرارداد/سامانه یا مدیر حساب، و ثبت امضا با مدیر
قرارداد/سامانه یا بازبین حقوقی مجاز است. مشاهده‌گر فقط می‌خواند.

رویداد تجاری `contract.service-limits.signed / 1.0.0` به outbox می‌رود؛ schema آن
با ContractAccessProjection یکی نیست. envelope شامل eventId، producer، occurredAt،
correlationId، aggregateVersion، localTenantId، contractId، versionId، نسخه قلم،
terms، signature و مرجع مبنای اجرای امضاشده است. terms شامل کلید سرویس/محصول،
محیط/گروه، TPS/burst/quota، بازه و زمان اثر، meter/unit و بند/اثر انگشت منبع است.

مالک policy، schema اجرایی projection/limits نسخه `2.0.0` و پروفایل
`fanasa.contract-policy/2` است. schemaها و validator محدود همان مالک در
`lib/contract-policy-schema/` با provenance ثبت شده‌اند. evaluator یا registry
در NeoContract کپی نشده است. adapter از **نگاشت مورد اعتماد مرکز**، owner/consumer،
offer/subscription، allocation، scope، role eligibility، policy و pricing reference
را حفظ می‌کند؛ از متن یا درخواست مرورگر نقش ادمین، تخصیص یا UUID مرکزی تولید نمی‌کند.

`configRevision` برای هر event باید مستقلاً از مالک تخصیص تأمین شود؛ از نسخه سند،
قیمت، policy یا aggregate محاسبه نمی‌شود. scope و allocation ثابت‌اند. سقف سخت
مرکزی فقط وقتی صریحاً تنظیم شده با min حدود هم‌واحد اعمال می‌شود. داده ناشناخته
یا نگاشت ناقص مانع ارسال است. تغییر حدود به Redis فرمان reset/provision نمی‌دهد؛
حفظ شمارنده‌ها وظیفه limiter موجود و ledger تخصیص مرکزی است.

## اجرای اتصال توسط اپراتور

پس از پذیرش receiver، هویت producer محدود، نگاشت معتبر و چرخه مرکزی
pause/resume/close، expiry و invalidation:

```powershell
node scripts/dispatch-service-limits.mjs --apply
```

تنظیمات محیط: `NEOCONTRACT_DATABASE_URL`، `NEOCONTRACT_SERVICE_LIMIT_ENDPOINT`،
`NEOCONTRACT_SERVICE_LIMIT_TOKEN` و `NEOCONTRACT_SERVICE_LIMIT_BINDINGS_FILE`.
گیت اپراتوری `NEOCONTRACT_SERVICE_LIMIT_LIFECYCLE_READY=true` پس از پذیرش چرخه
مرکزی لازم است؛ پیش‌فرض غیرفعال است. این پرچم خودِ چرخه را پیاده‌سازی نمی‌کند.
token در UI، سند یا رویداد قرار نمی‌گیرد. endpoint باید HTTPS یا loopback آزمایشی
باشد؛ TLS خاموش نمی‌شود، redirect و retry پنهان نداریم. فایل نگاشت آرایه‌ای از
`localTenantId/contractId/serviceKey/registryReference/projection/allocationRevisions`
و optional `hardCeilings` است. `allocationRevisions[eventId]` مقدار مصوب مستقل است.
این فایل خروجی هماهنگی مرکزی است؛ نگاشت فرضی، رجیستری موازی یا ورودی مرورگر نیست.

receiver باید producer را احراز و دامنه مجوزش را بررسی کند، inbox/receipt durable
و انتشار monotonic داشته باشد. پس از اعمال و مشاهده واقعی Gateway، رسید زیر را
برگرداند. HTTP 200 بدون این رسید، «اعمال‌شده» نیست:

```json
{
  "eventId": "nc-...", "aggregateVersion": 2, "phase": "acknowledged",
  "gateway": {
    "contractVersion": 2, "allocationId": "confirmed-allocation",
    "canonicalScope": "canonical registered scope", "configRevision": 41,
    "limitsSha256": "sha256 of canonical normalized limits",
    "observedAt": "2026-10-10T10:00:00.000Z"
  }
}
```

مرجع Gateway، بازه و hash حدود تطبیق داده می‌شوند. شکست، timeout و رسید ناقص
در outbox باقی می‌مانند؛ درخواست بعدی همان eventId/Idempotency-Key را استفاده می‌کند.
فقط آخرین تغییر رسیده به زمان اثر هر قلم ارسال می‌شود. نسخه آینده نباید وضعیت
فعال قبلی را زودهنگام جایگزین کند. زنجیره عمومی pause/resume/close، invalidation
و زمان‌بندی مرکزی باید پیش از اتصال عملیاتی با مالک مرکز تکمیل شود؛ dispatcher
فعلی مسیر امضای محدودیت است و جای receiver lifecycle یا کنترل آنلاین PDP را نمی‌گیرد.

## پذیرش و محدودیت واقعی

آزمون‌های قواعد، API/مرورگر، migration/backup و دو ابزار compatibility از داده
آزمایشی مستقل استفاده می‌کنند. ابزارهای compatibility به package موجود مالک
policy و Gateway مراجعه می‌کنند و هیچ فایل آن‌ها را ویرایش نمی‌کنند:

```powershell
$env:NEOCONTRACT_SERVICE_LIMIT_TEST_EVIDENCE = 'artifacts/service-capacity'
node --test --test-concurrency=1 tests/service-limits.test.mjs
node scripts/check-service-limit-compatibility.mjs <policy-package> artifacts/service-capacity
$env:PYTHONPATH = Join-Path $env:TEMP 'fanasa-api-gateway-devdeps'
python scripts/check-service-limit-gateway.py <gateway-package> artifacts/service-capacity
```

آزمون آخر کد واقعی Lua PEP و limiter را با transport stub و fakeredis اجرا می‌کند؛
نصب native APISIX، Redis زنده یا تحمیل حدود به یک قرارداد واقعی را اثبات نمی‌کند.
پنج پیشنهاد واقعی، برای آزمون امضاشده یا دارای TPS فرضی نمی‌شوند.

بازدید runtime VPS در ۱۰ اکتبر: Docker فقط reverse proxy موجود Nginx را نشان داد؛
APISIX/receiver policy زنده در این پذیرش تأیید نشدند. اتصال زنده تا نگاشت UUID /
تخصیص، producer authentication، گیرنده durable، lifecycle و native enforcement
در وضعیت آماده اتصال می‌ماند. هیچ grant، role binding یا سهمیه واقعی ایجاد نشده است.
