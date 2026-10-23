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
NEOCONTRACT_DEFAULT_TENANT=00000000-0000-0000-0000-000000000001
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

برای پذیرش اتصال مدیریت دسترسی، فرمان `npm run access:check -- <private-case-file>`
را با محیط واقعی برنامه اجرا کنید. این فرمان عضویت‌ها را فقط از PostgreSQL
می‌خواند و توکن، scope، policy، نگاشت چهار مشتری و ثبت سامانه زیر رایان را
بررسی می‌کند؛ تنظیمات و داده را تغییر نمی‌دهد.
[قالب پرونده و محدودیت‌های پذیرش](CENTRAL-ACCESS.md#read-only-activation-preflight).

برنامه فقط روی شبکه Docker قابل دسترسی است و oauth2-proxy ورودی عمومی را کنترل می‌کند. `NEOCONTRACT_TRUST_PROXY_AUTH=true` فقط در همین مسیر تنظیم شده است.

## SSO و نقش‌ها

روی VPS فعلی، ورودی HTTPS در `/opt/fanasa-gateway` قرار دارد. فایل خصوصی و محلی `compose.https.yml` در `/opt/neocontract` به Compose پایه اضافه می‌شود. این فایل برنامه را روی `127.0.0.1:14173` و proxy ورود را روی `127.0.0.1:4180` نگه می‌دارد. Nginx ابتدا ورود را با `/oauth2/auth` بررسی می‌کند، سپس هدرهای هویت را خودش می‌سازد. گواهی محلی در proxy ورود نیز مورد اعتماد است؛ بررسی گواهی یا issuer غیرفعال نشده است. workflow استقرار وجود این فایل را تشخیص می‌دهد و آن را در همه فرمان‌های Compose حفظ می‌کند.

آدرس‌های محیط مشاهده: `contracts.fanasa.net.local` برای قرارداد، `hub.fanasa.net.local` برای پنجره واحد، `access.fanasa.net.local` برای مدیریت دسترسی، `sso.fanasa.net.local` برای Keycloak، `ai.fanasa.net.local` برای Open WebUI و `admin.fanasa.net.local` برای Portainer. آدرس قبلی `panel.fanasa.net.local` به `access.fanasa.net.local` هدایت می‌شود؛ لینک‌های قدیمی ورود زیر `/realms/` و `/admin/` در `access` به `sso` هدایت می‌شوند. issuer ورود `https://sso.fanasa.net.local/realms/fanasa` است. همه از HTTPS روی پورت ۴۴۳ استفاده می‌کنند. آدرس `agentic.fanasa.net.local` رزرو شده و تا استقرار نسخه برنامه، پاسخ ۵۰۳ با توضیح روشن می‌دهد.

در ۲۳ اکتبر، خطای `upstream sent too big header` برای بازگشت SSO قراردادها
در لاگ Nginx تأیید شد. بافر پاسخ در همان server میزبان قراردادها تنظیم شده است
تا مسیرهای `/oauth2/` و `/oauth2/auth` پاسخ بزرگ‌تر ورود را دریافت کنند:

```nginx
proxy_buffer_size 32k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 64k;
```

این دستورها داخل server موجود در `/opt/fanasa-gateway/nginx.conf` هستند؛
کنترل `auth_request` و ساخت هدرهای هویت همان مسیر حفظ می‌شوند. پیش از تغییر
نسخه پشتیبان بگیرید، `nginx -t` را داخل کانتینر gateway اجرا و فقط reload کنید؛
سپس ورود تازه را از ریشه برنامه تا میزکار بررسی کنید. گزارش و مسیر بازگشت در
[پذیرش اصلاحیه ظرفیت](RELEASE-2026-10-23-CAPACITY-AMENDMENT.md) ثبت شده است.

DNS عمومی برای این نام‌ها وجود ندارد؛ هر دستگاه باید آن‌ها را در hosts به IP سرور نگاشت کند و گواهی محلی را پس از تطبیق اثر انگشت مورد اعتماد قرار دهد. کلید خصوصی گواهی و اطلاعات حساب‌های دمو فقط روی سرور نگه‌داری می‌شوند و نباید وارد Git شوند.

در SSO فن‌آسا یک OIDC client با redirect URL محیط بسازید و claimهای `sub` و `email` را فعال کنید. کاربر باید با `subject` معتبر SSO و ایمیل همان حساب در `contracts.app_users` ثبت و سپس فعال شود. نقش‌ها در `contracts.app_roles` و انتساب آن‌ها در `contracts.app_user_roles` نگه‌داری می‌شوند.

عضویت فعلی برنامه به `sub` تأییدشده متصل است؛ ایمیل به‌تنهایی جای شناسه را
نمی‌گیرد. `email_verified=true` نیز برای ورود OIDC لازم است. در محیط فعلی SMTP
SSO تنظیم نشده؛ تأیید دستی حساب مالک در ۱۱ اکتبر، پس از تأیید صریح همان کاربر
ثبت شد و کنترل تأیید ایمیل در proxy فعال باقی ماند.

پذیرش دامنه ایمیل و عضویت برنامه دو کنترل جدا هستند. برای حساب تأییدشده خارج
از دامنه مجاز، فایل خصوصی `authorized-emails.txt` شامل آدرس‌های دقیق، یک آدرس
در هر خط، استفاده می‌شود. این فهرست به‌خودی‌خود نقش یا عضویت تننت ایجاد نمی‌کند.
تنظیم VPS در `compose.https.yml` پایدار است و در انتشارهای بعدی حفظ می‌شود:

```yaml
services:
  oauth2-proxy:
    environment:
      OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE: /etc/oauth2-proxy/authorized-emails.txt
    volumes:
      - /opt/neocontract-auth/authorized-emails.txt:/etc/oauth2-proxy/authorized-emails.txt:ro
```

این قطعه را با override موجود ادغام کنید؛ گواهی، PKCE، cookie و اتصال HTTPS
همان فایل را حفظ کنید. افزودن یک حساب به فهرست نیازمند پذیرش صریح آن حساب است؛
برای رفع خطا، دامنه عمومی یا `*` و `insecure-oidc-allow-unverified-email` فعال
نمی‌شوند. گزینه فایل آدرس‌ها در
[مستندات رسمی OAuth2 Proxy ۷٫۸](https://oauth2-proxy.github.io/oauth2-proxy/7.8.x/configuration/overview/#proxy-options)
توضیح داده شده است. جزئیات اصلاح حساب مالک در
[گزارش رفع خطای ورود](RELEASE-2026-10-11-OWNER-SSO.md) ثبت شده است.

نقش‌های پایه: `platform_admin`، `contract_admin`، `legal_reviewer`، `finance_reviewer`، `account_manager` و `viewer`.

کاربران دمو از ابتدا `disabled` هستند و تا فعال‌سازی صریح قابل ورود نیستند: `demo.admin@fanasa.example`، `demo.legal@fanasa.example`، `demo.finance@fanasa.example` و `demo.viewer@fanasa.example`.

## CI/CD

- `.github/workflows/ci.yml`: نصب، تست backend، بررسی syntax، build تصویر و دو مجموعه تست مرورگر شامل پیکربندی چهار تننت؛ trace و تصویر شکست مرورگر هفت روز نگهداری می‌شود.
- `.github/workflows/deploy.yml`: اجرای دستی staging/production از طریق SSH و Compose.
- GitHub Environmentهای staging و production باید secretهای `VPS_HOST`، `VPS_USER`، `VPS_SSH_KEY` و `VPS_APP_DIR` جداگانه داشته باشند.
