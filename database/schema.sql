-- نئوکنتراکت / Neon PostgreSQL schema
-- کنترل دسترسی و جدول کاربران عمداً خارج از محدوده MVP است.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE SCHEMA IF NOT EXISTS contracts;
SET search_path TO contracts, public;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug citext NOT NULL UNIQUE, name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, unit_type text NOT NULL DEFAULT 'subsidiary' CHECK (unit_type IN ('holding','subsidiary','department','branch')),
  registration_no text, is_active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, code)
);
CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('company','person','government','other')), legal_name text NOT NULL,
  registration_no text, national_id text, email text, phone text, address text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX parties_reg_uq ON parties(tenant_id, registration_no) WHERE registration_no IS NOT NULL;
CREATE TABLE contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, category text, description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  current_version_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, code)
);
CREATE TABLE contract_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0), body_template text NOT NULL DEFAULT '', variable_schema jsonb NOT NULL DEFAULT '{}', process_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')), published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (template_id, version_no)
);
ALTER TABLE contract_templates ADD CONSTRAINT fk_template_current_version FOREIGN KEY (current_version_id) REFERENCES contract_template_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE template_workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_version_id uuid NOT NULL REFERENCES contract_template_versions(id) ON DELETE CASCADE,
  stage_key text NOT NULL, name text NOT NULL, sequence_no integer NOT NULL CHECK (sequence_no > 0), required boolean NOT NULL DEFAULT true,
  role_key text, sla_days integer CHECK (sla_days IS NULL OR sla_days >= 0), task_blueprint jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (template_version_id, stage_key), UNIQUE (template_version_id, sequence_no)
);
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_no text NOT NULL, title text NOT NULL, contract_type text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_process','awaiting_signature','active','expired','terminated','cancelled')),
  owning_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL, template_version_id uuid NOT NULL REFERENCES contract_template_versions(id) ON DELETE RESTRICT,
  template_snapshot jsonb NOT NULL DEFAULT '{}', start_date date, end_date date, currency char(3), total_value numeric(20,4), variables jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, contract_no), CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX contracts_tenant_status_idx ON contracts(tenant_id,status,updated_at DESC);
CREATE TABLE contract_parties (
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, party_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  role_key text NOT NULL, is_primary boolean NOT NULL DEFAULT false, signatory_name text, signatory_title text, metadata jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (contract_id, party_id, role_key)
);
CREATE TABLE contract_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES contract_template_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','cancelled','blocked')), is_customized boolean NOT NULL DEFAULT true,
  customization_note text, process_snapshot jsonb NOT NULL DEFAULT '{}', started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contract_process_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), process_id uuid NOT NULL REFERENCES contract_processes(id) ON DELETE CASCADE,
  source_stage_id uuid REFERENCES template_workflow_stages(id) ON DELETE SET NULL, step_key text NOT NULL, name text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','skipped','blocked')),
  required boolean NOT NULL DEFAULT true, is_custom boolean NOT NULL DEFAULT false, role_key text, sla_days integer CHECK (sla_days IS NULL OR sla_days >= 0), due_at timestamptz,
  started_at timestamptz, completed_at timestamptz, completed_by_label text, input_schema jsonb NOT NULL DEFAULT '{}', output_data jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (process_id, step_key), UNIQUE (process_id, sequence_no)
);
CREATE INDEX process_steps_queue_idx ON contract_process_steps(status,due_at);
CREATE TABLE contract_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  process_step_id uuid REFERENCES contract_process_steps(id) ON DELETE CASCADE, code text, title text NOT NULL, description text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','skipped','blocked')), assignee_role text, assignee_label text, due_at timestamptz,
  completed_at timestamptz, sort_order integer NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  process_step_id uuid REFERENCES contract_process_steps(id) ON DELETE SET NULL, document_type text NOT NULL DEFAULT 'working', file_name text NOT NULL, storage_key text NOT NULL,
  mime_type text, byte_size bigint, sha256 text, version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0), uploaded_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, amendment_no integer NOT NULL CHECK (amendment_no > 0),
  title text NOT NULL, reason text, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','rejected','signed','cancelled')), effective_date date, summary text, delta jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (contract_id, amendment_no)
);
ALTER TABLE contract_documents ADD COLUMN amendment_id uuid REFERENCES contract_amendments(id) ON DELETE SET NULL;
CREATE TABLE contract_events (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE, process_id uuid REFERENCES contract_processes(id) ON DELETE SET NULL,
  event_type text NOT NULL, from_status text, to_status text, actor_role text, actor_label text, payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_events_timeline_idx ON contract_events(contract_id,occurred_at DESC);

CREATE OR REPLACE FUNCTION contracts.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER units_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON contract_templates FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER parties_updated_at BEFORE UPDATE ON parties FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER processes_updated_at BEFORE UPDATE ON contract_processes FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON contract_tasks FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();
CREATE TRIGGER amendments_updated_at BEFORE UPDATE ON contract_amendments FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

-- seed دمو: tenant و واحدهای هلدینگ و الگوی خرید
INSERT INTO tenants(id,slug,name) VALUES ('00000000-0000-0000-0000-000000000001','entekhab','هلدینگ انتخاب') ON CONFLICT DO NOTHING;
INSERT INTO business_units(id,tenant_id,code,name,unit_type) VALUES
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','HQ','ستاد مرکزی','holding'),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','APPL','شرکت لوازم خانگی','subsidiary') ON CONFLICT DO NOTHING;
INSERT INTO contract_templates(id,tenant_id,code,name,category,status) VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','PURCHASE','خرید کالا و خدمات','خرید','active') ON CONFLICT DO NOTHING;
INSERT INTO contract_template_versions(id,template_id,version_no,body_template,status,published_at) VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000021',1,'قرارداد {{title}} با {{party_name}}','published',now()) ON CONFLICT DO NOTHING;
UPDATE contract_templates SET current_version_id='00000000-0000-0000-0000-000000000022' WHERE id='00000000-0000-0000-0000-000000000021';
INSERT INTO template_workflow_stages(template_version_id,stage_key,name,sequence_no,role_key,sla_days) VALUES
('00000000-0000-0000-0000-000000000022','legal_review','بررسی حقوقی',1,'legal',2),('00000000-0000-0000-0000-000000000022','finance_review','بررسی مالی',2,'finance',2),('00000000-0000-0000-0000-000000000022','management_approval','تأیید مدیریت',3,'management',1),('00000000-0000-0000-0000-000000000022','signature','امضا',4,'signatory',3) ON CONFLICT DO NOTHING;
