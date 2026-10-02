# SQL Server deployment

این پوشه اسکریپت ساخت دیتابیس عملیاتی SQL Server برای NeoContract را نگه می‌دارد.

```powershell
npm run db:sqlserver
```

یا برای احراز هویت SQL Server:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sqlserver-provision.ps1 -Server localhost -User app_user -Password '<secret>'
```

اسکریپت‌ها قابل اجرای مجدد هستند و داده‌های پایه گروه انتخاب، مدیر حساب، مشتری نمونه، الگوی قرارداد مادر، پنج مرحله گردش کار و تنظیمات فضای کاری را درج می‌کنند. رشته اتصال واقعی در مخزن ثبت نمی‌شود.

> وضعیت فعلی برنامه: Runtime موجود هنوز از PostgreSQL/PGlite استفاده می‌کند. این Schema و Seed مسیر استقرار SQL Server را آماده می‌کنند؛ برای تغییر Runtime باید adapter اختصاصی SQL Server و تبدیل Queryهای PostgreSQL در یک مرحله جداگانه اضافه شود.
