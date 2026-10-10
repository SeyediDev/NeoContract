CREATE TABLE contracts.contract_economics (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id), FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contracts(tenant_id,id)
);
CREATE TRIGGER immutable_economics_signed_history BEFORE UPDATE ON contracts.contract_economics
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_history();
CREATE TABLE contracts.economics_commands (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL, request_key text NOT NULL, request_hash text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL, payload jsonb NOT NULL, actor jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,contract_id,request_key),
 UNIQUE(tenant_id,contract_id,revision), FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_economics(tenant_id,contract_id)
);
CREATE TRIGGER immutable_economics_command BEFORE UPDATE OR DELETE ON contracts.economics_commands
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE TABLE contracts.economics_outbox (
 event_id text PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, version_id uuid NOT NULL,
 aggregate_version integer NOT NULL, effective_at timestamptz NOT NULL, payload jsonb NOT NULL,
 payload_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'awaiting-central-accounting' CHECK(status='awaiting-central-accounting'),
 UNIQUE(tenant_id,contract_id,version_id), FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_economics(tenant_id,contract_id)
);
CREATE TRIGGER immutable_economics_event BEFORE UPDATE OR DELETE ON contracts.economics_outbox
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_event();
-- These are reviewed commercial allocation proposals, not posted ledger documents or balances.
CREATE TABLE contracts.settlement_proposals (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, version_id uuid NOT NULL,
 period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, proposal jsonb NOT NULL,
 request_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_key), UNIQUE(tenant_id,contract_id,period_start,period_end),
 CHECK(period_start<period_end), FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_economics(tenant_id,contract_id)
);
CREATE TRIGGER immutable_settlement_proposal BEFORE UPDATE OR DELETE ON contracts.settlement_proposals
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE TABLE contracts.provider_applications (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES contracts.tenants(id),
 revision integer NOT NULL CHECK(revision>0), state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE contracts.provider_application_commands (
 tenant_id uuid NOT NULL, application_id uuid NOT NULL, request_key text NOT NULL, request_hash text NOT NULL,
 revision integer NOT NULL, action text NOT NULL, actor jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,request_key), UNIQUE(tenant_id,application_id,revision),
 FOREIGN KEY(tenant_id,application_id) REFERENCES contracts.provider_applications(tenant_id,id)
);
CREATE TRIGGER immutable_provider_command BEFORE UPDATE OR DELETE ON contracts.provider_application_commands
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
