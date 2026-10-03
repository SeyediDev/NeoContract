# استقرار، CI/CD و SSO فن‌آسا

## محیط‌ها

- توسعه محلی: PGlite در `.data/postgres`.
- CI: PGlite با `memory://` و تست‌های Node؛ تصویر Docker نیز build می‌شود.
- staging و production: PostgreSQL جداگانه روی VPS با volume مستقل.

فایل `docker-compose.production.yml` سرویس PostgreSQL، برنامه و oauth2-proxy را در شبکه داخلی اجرا می‌کند. مقدارهای واقعی در GitHub Environment یا secret manager VPS قرار می‌گیرند.

## تنظیم VPS

فایل `.env` خصوصی روی VPS:

```env
POSTGRES_PASSWORD=<random-long-secret>
NEOCONTRACT_DEFAULT_TENANT=00000000-0000-0000-0000-000000000002
FANASA_SSO_ISSUER=https://<fanasa-issuer>
FANASA_SSO_CLIENT_ID=<client-id>
FANASA_SSO_CLIENT_SECRET=<client-secret>
FANASA_SSO_REDIRECT_URL=https://contracts.<fanasa-domain>/oauth2/callback
FANASA_SSO_COOKIE_SECRET=<32-byte-base64-secret>
FANASA_SSO_EMAIL_DOMAIN=fanasa.ir
```

```bash
npm run deploy:check
docker compose --env-file .env -f docker-compose.production.yml up -d --build
```

پیش‌بررسی بالا فقط کامل و HTTPS بودن تنظیمات را بررسی می‌کند و هیچ secretی را نمایش نمی‌دهد. تا زمانی که issuer، client و دامنه واقعی SSO آماده نشده‌اند، سرویس `oauth2-proxy` را عمومی نکنید.

برنامه فقط روی شبکه Docker قابل دسترسی است و oauth2-proxy ورودی عمومی را کنترل می‌کند. `NEOCONTRACT_TRUST_PROXY_AUTH=true` فقط در همین مسیر تنظیم شده است.

## SSO و نقش‌ها

روی VPS فعلی، ورودی HTTPS در `/opt/fanasa-gateway` قرار دارد. فایل خصوصی و محلی `compose.https.yml` در `/opt/neocontract` به Compose پایه اضافه می‌شود. این فایل برنامه را روی `127.0.0.1:14173` و proxy ورود را روی `127.0.0.1:4180` نگه می‌دارد. Nginx ابتدا ورود را با `/oauth2/auth` بررسی می‌کند، سپس هدرهای هویت را خودش می‌سازد. گواهی محلی در proxy ورود نیز مورد اعتماد است؛ بررسی گواهی یا issuer غیرفعال نشده است. workflow استقرار وجود این فایل را تشخیص می‌دهد و آن را در همه فرمان‌های Compose حفظ می‌کند.

آدرس‌های محیط مشاهده: `contracts.fanasa.net.local` برای قرارداد، `hub.fanasa.net.local` برای پنجره واحد، `panel.fanasa.net.local` برای مدیریت دسترسی، `access.fanasa.net.local` برای Keycloak، `ai.fanasa.net.local` برای Open WebUI و `admin.fanasa.net.local` برای Portainer. همه از HTTPS روی پورت ۴۴۳ استفاده می‌کنند. آدرس `agentic.fanasa.net.local` رزرو شده و تا استقرار نسخه برنامه، پاسخ ۵۰۳ با توضیح روشن می‌دهد.

DNS عمومی برای این نام‌ها وجود ندارد؛ هر دستگاه باید آن‌ها را در hosts به IP سرور نگاشت کند و گواهی محلی را پس از تطبیق اثر انگشت مورد اعتماد قرار دهد. کلید خصوصی گواهی و اطلاعات حساب‌های دمو فقط روی سرور نگه‌داری می‌شوند و نباید وارد Git شوند.

در SSO فن‌آسا یک OIDC client با redirect URL محیط بسازید و claimهای `sub` و `email` را فعال کنید. کاربر باید با `subject` یا ایمیل در `contracts.app_users` ثبت و سپس فعال شود. نقش‌ها در `contracts.app_roles` و انتساب آن‌ها در `contracts.app_user_roles` نگه‌داری می‌شوند.

نقش‌های پایه: `platform_admin`، `contract_admin`، `legal_reviewer`، `finance_reviewer`، `account_manager` و `viewer`.

کاربران دمو از ابتدا `disabled` هستند و تا فعال‌سازی صریح قابل ورود نیستند: `demo.admin@fanasa.example`، `demo.legal@fanasa.example`، `demo.finance@fanasa.example` و `demo.viewer@fanasa.example`.

## CI/CD

- `.github/workflows/ci.yml`: نصب، تست، بررسی syntax و build تصویر.
- `.github/workflows/deploy.yml`: اجرای دستی staging/production از طریق SSH و Compose.
- GitHub Environmentهای staging و production باید secretهای `VPS_HOST`، `VPS_USER`، `VPS_SSH_KEY` و `VPS_APP_DIR` جداگانه داشته باشند.
