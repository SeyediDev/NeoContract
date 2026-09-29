# NeoContract — دموی مدیریت قرارداد هلدینگ

وب فارسی RTL برای مدیریت قرارداد، کاتالوگ فن‌آسا و مشتریان هلدینگی. مسیر مرجع E:\SJVS\Projects\NeoContract و مخزن خصوصی [SeyediDev/NeoContract](https://github.com/SeyediDev/NeoContract) است.

## اجرا و تست

نیازمند Node.js 20 یا بالاتر؛ وابستگی npm ندارد.

```powershell
npm start
# http://127.0.0.1:4173
npm test
```

پورت با متغیر PORT قابل تغییر است. سرور روی loopback اجرا می‌شود. تست‌ها سرور مستقل روی پورت موقت دارند و سرور جاری را متوقف نمی‌کنند.

## وضعیت واقعی نسخه حاضر

رابط نمایشی شامل داشبورد، قراردادها، الگوها، کاتالوگ درختی، مشتریان و مدیران حساب است. داده‌های ایجادشده فقط در حافظه صفحه‌اند و پس از reload از بین می‌روند؛ backend و persistence هنوز پیاده نشده است. SQL موجود طراحی/seed اجرا‌نشده است. کنترل دسترسی و مدیریت کاربران در دامنه این مرحله نیست.

بازبینی منبع و دامنه و اصلاح سرور تکمیل شده است. فرآیند سفارشی و snapshot کامل قرارداد، نگاشت مشتری/مدیر حساب، الگوهای واقعی و پذیرش UI هنوز در برنامه اجرا هستند. نگاشت SLA/روش تحویل فعلی UI و defaults SQL نیاز به اصلاح دارند و نباید شرایط رسمی هر سرویس تلقی شوند.

## داده فن‌آسا

منبع دقیق [fanasa.net/fa](https://fanasa.net/fa) است. فایل observed JSON شامل ۵ پهنه، ۱۴ مرکز، ۸۷ سرویس و نگاشت ۷ مدل درآمدی از مشاهده قبلی مرورگر است. وضعیت browser-observed-unverified حفظ شده؛ نگاشت SLA و روش تحویل هر سرویس در فایل وجود ندارد. [گزارش منبع](planning/fanasa-source-research.md) حدود این داده را توضیح می‌دهد.

## SQL و Neo

فایل‌های database/schema.sql و database/fanasa-catalog.sql برای PostgreSQL نوشته شده‌اند. Neo سامانه مدیریت کار است؛ Neon یک گزینه میزبانی PostgreSQL است و الزامی نیست. اجرای SQL، اصلاح integrity tenant و migration در CTR-002 و CTR-008 برنامه‌ریزی شده است.

برای آزمایش روی دیتابیس خالی توسعه، پس از اصلاح و بازبینی اسکریپت‌ها:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/fanasa-catalog.sql
```

این دستورات هنوز در این محیط اجرا نشده‌اند؛ schema.sql فعلی migration قابل تکرار روی دیتابیس موجود نیست.

## برنامه اجرا

[توالی ۱۸ تسک و معیار پذیرش](planning/WORK_ITEMS.md) · [JSON خروجی برد](planning/work-items.json) · [دامنه MVP](planning/MVP_SCOPE.md) · [گزارش اجرا](planning/EXECUTION_LOG.md)

برد Neo در پروژه CONTRACTS مرجع کار است؛ شناسه‌های آن در planning/neo-binding.json ثبت شده‌اند. تسک‌های موجود با حفظ سابقه مرتب شدند و دو کار الگو/نسخه و API/SQL به آن‌ها افزوده شد. bootstrap قدیمی را اجرا نکنید. اتصال عملیاتی خود محصول به Neo در CTR-007 باقی است.
