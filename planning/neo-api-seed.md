# اتصال به برد موجود Neo

پروژه CONTRACTS با نام «مدیریت قراردادها» از قبل در workspace موجود بوده است. در ۲۰۲۶-۰۹-۳۰ خواندن catalog، جزئیات تسک‌ها و API موفق شد و ترتیب و وابستگی‌ها روی همان رکوردها ثبت شد.

شناسه‌ها و آدرس محیط محلی در [neo-binding.json](neo-binding.json) قرار دارند. این فایل credential ندارد. [work-items.json](work-items.json) خروجی برد است؛ منبع عملیاتی، API و Web خود Neo هستند.

**bootstrap.json سند تاریخی برنامه اولیه است؛ آن را seed نکنید.** ساخت مجدد organization/workspace/project به رکورد تکراری منجر می‌شود. فرض قبلیِ نبود دسترسی فقط از نبود متغیر محیطی نتیجه گرفته شده بود و با بررسی مستقیم API اصلاح شد.

## قواعد به‌روزرسانی

- پیش از تغییر، catalog و جزئیات کامل کار، مالک، وابستگی، evidence و runها خوانده شود.
- احراز هویت از تنظیم جاری میزبان استفاده کند؛ token یا credential در Git و لاگ ثبت نشود.
- API در مسیر api/orchestration/v1/organizations/{organizationId}/workspaces/{workspaceId} است.
- عنوان و شرح ورودی موجود حفظ شود؛ توالی، معیار پذیرش و تصمیم‌ها در logs ثبت شوند.
- وابستگی با POST items/{id}/dependencies و expectedVersion تازه ثبت شود.
- شروع: Backlog → Ready → claim → InProgress؛ پایان: evidence و log → Review → Done.
- نقش آزاد در کل workspace بررسی و شناسه همین چت استفاده شود. 409 نیازمند بازخوانی و بررسی است.
- Commit evidence فقط SHA واقعی است؛ Test و Artifact متصل به commit بعد از ثبت خود commit ثبت شوند.

ثبت برد و وابستگی‌ها انجام شده است. اتصال خود اپلیکیشن قراردادها به Neo، کار مستقل CTR-007 است و هنوز انجام نشده است.
