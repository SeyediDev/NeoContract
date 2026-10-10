-- Commercial parameter definitions are not an application/role/policy registry.
CREATE TABLE contracts.contract_parameter_definitions (
 tenant_id uuid NOT NULL REFERENCES contracts.tenants(id), parameter_key text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), definition jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,parameter_key)
);
CREATE TABLE contracts.contract_parameter_definition_history (
 tenant_id uuid NOT NULL, parameter_key text NOT NULL, revision integer NOT NULL,
 request_key text NOT NULL, request_hash text NOT NULL, definition jsonb NOT NULL,
 actor jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,parameter_key,revision), UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id,parameter_key) REFERENCES contracts.contract_parameter_definitions(tenant_id,parameter_key)
);
CREATE TRIGGER immutable_parameter_definition_history BEFORE UPDATE OR DELETE ON contracts.contract_parameter_definition_history
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE TABLE contracts.contract_parameters (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id), FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contracts(tenant_id,id)
);
CREATE TABLE contracts.contract_parameter_commands (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL, request_key text NOT NULL,
 request_hash text NOT NULL, revision integer NOT NULL CHECK(revision>0), action text NOT NULL,
 payload jsonb NOT NULL, actor jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id,request_key), UNIQUE(tenant_id,contract_id,revision),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_parameters(tenant_id,contract_id)
);
CREATE TRIGGER immutable_parameter_command BEFORE UPDATE OR DELETE ON contracts.contract_parameter_commands
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE TRIGGER immutable_parameter_signed_history BEFORE UPDATE ON contracts.contract_parameters
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_history();
CREATE TABLE contracts.contract_parameter_outbox (
 event_id text PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, version_id uuid NOT NULL,
 aggregate_version integer NOT NULL CHECK(aggregate_version>0), effective_at timestamptz NOT NULL,
 payload jsonb NOT NULL, payload_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'awaiting-mapping' CHECK(status='awaiting-mapping'),
 UNIQUE(tenant_id,contract_id,version_id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_parameters(tenant_id,contract_id)
);
CREATE TRIGGER immutable_parameter_event BEFORE UPDATE OR DELETE ON contracts.contract_parameter_outbox
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_event();
