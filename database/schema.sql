-- Rerunnable PostgreSQL bootstrap generated from the versioned migrations.
BEGIN;
-- NeoContract PostgreSQL schema v1. Identity and RBAC extensions are applied by migrations/003_identity_rbac.sql.
CREATE SCHEMA IF NOT EXISTS contracts;
SET search_path TO contracts, public;
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL, name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
 settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uq ON tenants(lower(slug));

CREATE TABLE IF NOT EXISTS business_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 code text NOT NULL, name text NOT NULL, unit_type text NOT NULL DEFAULT 'subsidiary' CHECK(unit_type IN ('holding','subsidiary','department','branch')), registration_no text, is_active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,code)
);

CREATE TABLE IF NOT EXISTS parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 party_type text NOT NULL DEFAULT 'company' CHECK(party_type IN ('company','person','government','other')), legal_name text NOT NULL, registration_no text, national_id text, email text, phone text, address text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)

);

CREATE UNIQUE INDEX IF NOT EXISTS parties_reg_uq ON parties(tenant_id,registration_no) WHERE registration_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_managers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 manager_code text NOT NULL, display_name text NOT NULL, email text, phone text, portfolio text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), verification_status text NOT NULL DEFAULT 'demo-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,manager_code)
);

CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 customer_code text NOT NULL, legal_name text NOT NULL, parent_id uuid, party_id uuid, account_manager_id uuid, unit text, industry text, segment text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('lead','active','paused','churned')), primary_contact_name text, primary_contact_email text, verification_status text NOT NULL DEFAULT 'demo-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,customer_code),
 CHECK(parent_id IS NULL OR parent_id <> id),
 FOREIGN KEY(tenant_id,parent_id) REFERENCES customers(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,account_manager_id) REFERENCES account_managers(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 code text NOT NULL, name text NOT NULL, category text, description text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')), current_version_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,code)
);

CREATE TABLE IF NOT EXISTS contract_template_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 template_id uuid NOT NULL, version_no integer NOT NULL CHECK(version_no > 0), body_template text NOT NULL DEFAULT '', variable_schema jsonb NOT NULL DEFAULT '{}', process_config jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')), published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,template_id,version_no),
 UNIQUE(tenant_id,template_id,id),
 FOREIGN KEY(tenant_id,template_id) REFERENCES contract_templates(tenant_id,id) ON DELETE CASCADE
);

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='template_current_version_fk' AND conrelid='contracts.contract_templates'::regclass) THEN ALTER TABLE contract_templates ADD CONSTRAINT template_current_version_fk FOREIGN KEY(tenant_id,id,current_version_id) REFERENCES contract_template_versions(tenant_id,template_id,id) DEFERRABLE INITIALLY DEFERRED; END IF; END $$;

CREATE TABLE IF NOT EXISTS template_workflow_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 template_version_id uuid NOT NULL, stage_key text NOT NULL, name text NOT NULL, sequence_no integer NOT NULL CHECK(sequence_no > 0), required boolean NOT NULL DEFAULT true, role_key text, sla_days integer CHECK(sla_days IS NULL OR sla_days >= 0), task_blueprint jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,template_version_id,stage_key),
 UNIQUE(tenant_id,template_version_id,sequence_no),
 FOREIGN KEY(tenant_id,template_version_id) REFERENCES contract_template_versions(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 source_key text NOT NULL, source_url text NOT NULL, observation_method text NOT NULL DEFAULT 'browser DOM snapshot', verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), observed_at timestamptz, fetched_at timestamptz, http_status integer, content_sha256 text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,source_key)
);

CREATE TABLE IF NOT EXISTS catalog_zones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 source_id uuid, zone_key text NOT NULL, name text NOT NULL, display_order integer NOT NULL DEFAULT 0, verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,zone_key),
 FOREIGN KEY(tenant_id,source_id) REFERENCES catalog_sources(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_centers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 zone_id uuid NOT NULL, source_id uuid, center_key text NOT NULL, name text NOT NULL, verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,center_key),
 FOREIGN KEY(tenant_id,zone_id) REFERENCES catalog_zones(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,source_id) REFERENCES catalog_sources(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 center_id uuid NOT NULL, source_id uuid, service_code text NOT NULL, name text NOT NULL, pricing_model text CHECK(pricing_model IS NULL OR pricing_model IN ('per_user','usage','fixed','hybrid','project','overhead','included')), delivery text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')), verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,service_code),
 FOREIGN KEY(tenant_id,center_id) REFERENCES catalog_centers(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,source_id) REFERENCES catalog_sources(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sla_tiers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 source_id uuid, code text NOT NULL, label text NOT NULL, availability_pct numeric(5,2) CHECK(availability_pct BETWEEN 0 AND 100), first_response_value numeric(10,2) CHECK(first_response_value >= 0), first_response_unit text CHECK(first_response_unit IN ('minute','hour','business_day')), resolution_target_value numeric(10,2) CHECK(resolution_target_value >= 0), resolution_target_unit text CHECK(resolution_target_unit IN ('minute','hour','business_day')), first_response_text text, resolution_target_text text, business_calendar text, coverage text, observed_service_count integer CHECK(observed_service_count >= 0), verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,source_id) REFERENCES catalog_sources(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS revenue_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 source_id uuid, code text NOT NULL, name text NOT NULL, model_type text NOT NULL CHECK(model_type IN ('per_user','usage','fixed','hybrid','project','overhead','included')), unit_label text, billing_period text, description text, pricing_config jsonb NOT NULL DEFAULT '{}', verification_status text NOT NULL DEFAULT 'browser-observed-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,source_id) REFERENCES catalog_sources(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_service_sla (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 service_id uuid NOT NULL, sla_tier_id uuid NOT NULL, is_default boolean NOT NULL DEFAULT false, verification_status text NOT NULL DEFAULT 'manual-unverified' CHECK (verification_status IN ('browser-observed-unverified','demo-unverified','verified','deprecated','manual-unverified','http-observed-unverified','operator-verified')), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,service_id,sla_tier_id),
 FOREIGN KEY(tenant_id,service_id) REFERENCES catalog_services(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,sla_tier_id) REFERENCES sla_tiers(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_service_revenue_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 service_id uuid NOT NULL, revenue_model_id uuid NOT NULL, is_default boolean NOT NULL DEFAULT false, unit_price numeric(20,4) CHECK(unit_price >= 0), currency char(3) DEFAULT 'IRR', metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,service_id,revenue_model_id),
 FOREIGN KEY(tenant_id,service_id) REFERENCES catalog_services(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,revenue_model_id) REFERENCES revenue_models(tenant_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS service_one_default_sla ON catalog_service_sla(tenant_id,service_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS service_one_default_revenue ON catalog_service_revenue_models(tenant_id,service_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_no text NOT NULL, title text NOT NULL, contract_type text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_process','awaiting_signature','active','expired','terminated','cancelled')), owning_unit_id uuid, template_version_id uuid NOT NULL, customer_id uuid, account_manager_id uuid, template_snapshot jsonb NOT NULL DEFAULT '{}', start_date date, end_date date, currency char(3) NOT NULL DEFAULT 'IRR', total_value numeric(20,4) CHECK(total_value >= 0), variables jsonb NOT NULL DEFAULT '{}', neo_binding jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,contract_no),
 UNIQUE(tenant_id,id,template_version_id),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
 FOREIGN KEY(tenant_id,owning_unit_id) REFERENCES business_units(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,template_version_id) REFERENCES contract_template_versions(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,account_manager_id) REFERENCES account_managers(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, party_id uuid NOT NULL, role_key text NOT NULL, is_primary boolean NOT NULL DEFAULT false, signatory_name text, signatory_title text, metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,contract_id,party_id,role_key),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_processes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, template_version_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','cancelled','blocked')), is_customized boolean NOT NULL DEFAULT true, customization_note text, process_snapshot jsonb NOT NULL DEFAULT '{}', started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,contract_id),
 FOREIGN KEY(tenant_id,contract_id,template_version_id) REFERENCES contracts(tenant_id,id,template_version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_process_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 process_id uuid NOT NULL, source_stage_id uuid, step_key text NOT NULL, name text NOT NULL, sequence_no integer NOT NULL CHECK(sequence_no > 0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','skipped','blocked')), required boolean NOT NULL DEFAULT true, is_custom boolean NOT NULL DEFAULT false, role_key text, sla_days integer CHECK(sla_days >= 0), due_at timestamptz, started_at timestamptz, completed_at timestamptz, completed_by_label text, input_schema jsonb NOT NULL DEFAULT '{}', output_data jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,process_id,step_key),
 UNIQUE(tenant_id,process_id,sequence_no),
 FOREIGN KEY(tenant_id,process_id) REFERENCES contract_processes(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,source_stage_id) REFERENCES template_workflow_stages(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, process_step_id uuid, code text, title text NOT NULL, description text, status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done','skipped','blocked')), assignee_role text, assignee_label text, due_at timestamptz, completed_at timestamptz, sort_order integer NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,process_step_id) REFERENCES contract_process_steps(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, amendment_no integer NOT NULL CHECK(amendment_no > 0), title text NOT NULL, reason text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','rejected','signed','cancelled')), effective_date date, summary text, delta jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,contract_id,amendment_no),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, process_step_id uuid, amendment_id uuid, document_type text NOT NULL DEFAULT 'working', file_name text NOT NULL, storage_key text NOT NULL, mime_type text, byte_size bigint CHECK(byte_size >= 0), sha256 text, version_no integer NOT NULL DEFAULT 1 CHECK(version_no > 0), uploaded_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,process_step_id) REFERENCES contract_process_steps(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,amendment_id) REFERENCES contract_amendments(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid, process_id uuid, event_type text NOT NULL, from_status text, to_status text, actor_role text, actor_label text, payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,process_id) REFERENCES contract_processes(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, service_id uuid, service_code text NOT NULL, service_name_snapshot text NOT NULL, pricing_model_snapshot text CHECK(pricing_model_snapshot IS NULL OR pricing_model_snapshot IN ('per_user','usage','fixed','hybrid','project','overhead','included')), sla_tier_snapshot text, service_snapshot jsonb NOT NULL DEFAULT '{}', delivery text, quantity numeric(20,4) CHECK(quantity >= 0), unit_price numeric(20,4) CHECK(unit_price >= 0), currency char(3) NOT NULL DEFAULT 'IRR', source_verification_status text NOT NULL DEFAULT 'browser-observed-unverified', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,service_id) REFERENCES catalog_services(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customer_service_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 customer_id uuid NOT NULL, service_id uuid NOT NULL, account_manager_id uuid, sla_tier_id uuid, revenue_model_id uuid, contract_id uuid, status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','active','paused','ended')), quantity numeric(20,4) CHECK(quantity >= 0), unit_price numeric(20,4) CHECK(unit_price >= 0), currency char(3) DEFAULT 'IRR', starts_on date, ends_on date, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,service_id) REFERENCES catalog_services(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,account_manager_id) REFERENCES account_managers(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,sla_tier_id) REFERENCES sla_tiers(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,revenue_model_id) REFERENCES revenue_models(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app_settings (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, key text NOT NULL, value jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,key));

CREATE TABLE IF NOT EXISTS catalog_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','failed')), source_url text NOT NULL, content_sha256 text, http_status integer, payload jsonb NOT NULL DEFAULT '{}', error_message text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 UNIQUE(tenant_id,id)

);

CREATE TABLE IF NOT EXISTS integration_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 contract_id uuid, kind text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed')), payload jsonb NOT NULL DEFAULT '{}', result jsonb NOT NULL DEFAULT '{}', error_message text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), next_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS contracts_tenant_status_idx ON contracts(tenant_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS contract_events_timeline_idx ON contract_events(tenant_id,contract_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS contract_services_contract_idx ON contract_services(tenant_id,contract_id);
CREATE INDEX IF NOT EXISTS catalog_services_tenant_idx ON catalog_services(tenant_id,status);
CREATE INDEX IF NOT EXISTS customers_tenant_manager_idx ON customers(tenant_id,account_manager_id);
CREATE INDEX IF NOT EXISTS integration_jobs_queue_idx ON integration_jobs(tenant_id,status,next_attempt_at);

CREATE OR REPLACE FUNCTION contracts.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS business_units_updated_at ON business_units;
CREATE TRIGGER business_units_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS parties_updated_at ON parties;
CREATE TRIGGER parties_updated_at BEFORE UPDATE ON parties FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS account_managers_updated_at ON account_managers;
CREATE TRIGGER account_managers_updated_at BEFORE UPDATE ON account_managers FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS contract_templates_updated_at ON contract_templates;
CREATE TRIGGER contract_templates_updated_at BEFORE UPDATE ON contract_templates FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS contracts_updated_at ON contracts;
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS contract_processes_updated_at ON contract_processes;
CREATE TRIGGER contract_processes_updated_at BEFORE UPDATE ON contract_processes FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS contract_tasks_updated_at ON contract_tasks;
CREATE TRIGGER contract_tasks_updated_at BEFORE UPDATE ON contract_tasks FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS contract_amendments_updated_at ON contract_amendments;
CREATE TRIGGER contract_amendments_updated_at BEFORE UPDATE ON contract_amendments FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS catalog_services_updated_at ON catalog_services;
CREATE TRIGGER catalog_services_updated_at BEFORE UPDATE ON catalog_services FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS customer_service_subscriptions_updated_at ON customer_service_subscriptions;
CREATE TRIGGER customer_service_subscriptions_updated_at BEFORE UPDATE ON customer_service_subscriptions FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS app_settings_updated_at ON app_settings;
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

DROP TRIGGER IF EXISTS integration_jobs_updated_at ON integration_jobs;
CREATE TRIGGER integration_jobs_updated_at BEFORE UPDATE ON integration_jobs FOR EACH ROW EXECUTE FUNCTION contracts.set_updated_at();

CREATE OR REPLACE FUNCTION contracts.protect_published_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('published','retired') AND (TG_OP='DELETE' OR (NEW.body_template,NEW.variable_schema,NEW.process_config,NEW.version_no,NEW.template_id,NEW.tenant_id) IS DISTINCT FROM (OLD.body_template,OLD.variable_schema,OLD.process_config,OLD.version_no,OLD.template_id,OLD.tenant_id)) THEN
  RAISE EXCEPTION 'Published template versions are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_template_versions ON contract_template_versions;
CREATE TRIGGER immutable_template_versions BEFORE UPDATE OR DELETE ON contract_template_versions FOR EACH ROW EXECUTE FUNCTION contracts.protect_published_template();

INSERT INTO contracts.schema_migrations(version,name,checksum) VALUES(1,'001_initial.sql','240f477aa25de5ac4a0c4e64fb1fd745e2eae246b2c9fdf6cf07c3dfca581f59') ON CONFLICT(version) DO NOTHING;
-- v2: legal document snapshots are append-only; changes belong to amendments.
SET search_path TO contracts, public;
CREATE OR REPLACE FUNCTION contracts.protect_contract_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.template_snapshot,NEW.template_version_id,NEW.customer_id,NEW.account_manager_id)
    IS DISTINCT FROM (OLD.template_snapshot,OLD.template_version_id,OLD.customer_id,OLD.account_manager_id) THEN
  RAISE EXCEPTION 'Contract snapshots are immutable; record an amendment instead' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_contract_snapshot ON contracts;
CREATE TRIGGER immutable_contract_snapshot BEFORE UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_contract_snapshot();
CREATE UNIQUE INDEX IF NOT EXISTS contracts_idempotency_key_uq
 ON contracts(tenant_id,(metadata->>'idempotencyKey'))
 WHERE NULLIF(metadata->>'idempotencyKey','') IS NOT NULL;

INSERT INTO contracts.schema_migrations(version,name,checksum) VALUES(2,'002_contract_integrity.sql','ae94b64fb394f83bcffc0244d642cb32af91b3545c28cf601c669038def5dd53') ON CONFLICT(version) DO NOTHING;
COMMIT;
