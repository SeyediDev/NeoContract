-- Fanasa SSO identity mapping and application roles.
SET search_path TO contracts, public;

CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 subject text NOT NULL,
 email text NOT NULL,
 display_name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 metadata jsonb NOT NULL DEFAULT '{}',
 last_login_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,subject), UNIQUE(tenant_id,email)
);

CREATE TABLE IF NOT EXISTS app_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 role_key text NOT NULL,
 label text NOT NULL,
 description text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,role_key)
);

CREATE TABLE IF NOT EXISTS app_user_roles (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 role_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,role_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES app_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,role_id) REFERENCES app_roles(tenant_id,id) ON DELETE CASCADE
);

INSERT INTO app_roles(tenant_id,role_key,label,description)
SELECT t.id,v.role_key,v.label,v.description FROM tenants t CROSS JOIN (VALUES
 ('platform_admin','مدیر سامانه','مدیریت کامل سامانه و کاربران'),
 ('contract_admin','مدیر قرارداد','مدیریت قرارداد، مشتری، الگو و تنظیمات'),
 ('legal_reviewer','بازبین حقوقی','بازبینی و پیشروی مراحل حقوقی'),
 ('finance_reviewer','بازبین مالی','بازبینی و پیشروی مراحل مالی'),
 ('account_manager','مدیر حساب','مدیریت مشتریان و قراردادهای پرتفوی'),
 ('viewer','مشاهده‌گر','مشاهده اطلاعات مجاز')) v(role_key,label,description)
WHERE t.slug='titan' ON CONFLICT(tenant_id,role_key) DO NOTHING;

-- Demo identities are disabled by default and become usable only when explicitly enabled.
INSERT INTO app_users(tenant_id,subject,email,display_name,status,metadata)
SELECT t.id,v.subject,v.email,v.display_name,'disabled',jsonb_build_object('demo',true,'ssoProvider','fanasa')
FROM tenants t CROSS JOIN (VALUES
 ('demo-admin','demo.admin@fanasa.example','دمو · مدیر قرارداد'),
 ('demo-legal','demo.legal@fanasa.example','دمو · بازبین حقوقی'),
 ('demo-finance','demo.finance@fanasa.example','دمو · بازبین مالی'),
 ('demo-viewer','demo.viewer@fanasa.example','دمو · مشاهده‌گر')) v(subject,email,display_name)
WHERE t.slug='titan' ON CONFLICT(tenant_id,subject) DO NOTHING;

INSERT INTO app_user_roles(tenant_id,user_id,role_id)
SELECT u.tenant_id,u.id,r.id FROM app_users u JOIN app_roles r ON r.tenant_id=u.tenant_id
WHERE u.subject='demo-admin' AND r.role_key='contract_admin' ON CONFLICT DO NOTHING;
INSERT INTO app_user_roles(tenant_id,user_id,role_id)
SELECT u.tenant_id,u.id,r.id FROM app_users u JOIN app_roles r ON r.tenant_id=u.tenant_id
WHERE u.subject='demo-legal' AND r.role_key='legal_reviewer' ON CONFLICT DO NOTHING;
INSERT INTO app_user_roles(tenant_id,user_id,role_id)
SELECT u.tenant_id,u.id,r.id FROM app_users u JOIN app_roles r ON r.tenant_id=u.tenant_id
WHERE u.subject='demo-finance' AND r.role_key='finance_reviewer' ON CONFLICT DO NOTHING;
INSERT INTO app_user_roles(tenant_id,user_id,role_id)
SELECT u.tenant_id,u.id,r.id FROM app_users u JOIN app_roles r ON r.tenant_id=u.tenant_id
WHERE u.subject='demo-viewer' AND r.role_key='viewer' ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS app_users_updated_at ON app_users;
CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

