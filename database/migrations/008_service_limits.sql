CREATE TABLE contracts.contract_service_limits (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,contract_id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contracts(tenant_id,id)
);
CREATE TABLE contracts.service_limit_commands (
 tenant_id uuid NOT NULL, contract_id uuid NOT NULL, request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 120),
 request_hash text NOT NULL, revision integer NOT NULL CHECK(revision>0), action text NOT NULL,
 payload jsonb NOT NULL, actor jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id,request_key), UNIQUE(tenant_id,contract_id,revision),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_service_limits(tenant_id,contract_id)
);
CREATE TABLE contracts.service_limit_outbox (
 event_id text PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL,
 version_id uuid NOT NULL, aggregate_version integer NOT NULL CHECK(aggregate_version>0),
 effective_at timestamptz NOT NULL, payload jsonb NOT NULL, payload_sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','blocked')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), last_attempt_at timestamptz,
 receipt jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,contract_id,version_id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_service_limits(tenant_id,contract_id)
);
CREATE INDEX service_limit_outbox_pending ON contracts.service_limit_outbox(status,effective_at);
CREATE TRIGGER immutable_service_limit_command BEFORE UPDATE OR DELETE ON contracts.service_limit_commands
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE FUNCTION contracts.protect_service_limit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.contract_id<>OLD.contract_id OR NEW.revision<>OLD.revision+1
 OR jsonb_array_length(NEW.state->'versions')<jsonb_array_length(OLD.state->'versions')
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.state->'versions') old_v
   WHERE old_v->>'status'='signed' AND NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(NEW.state->'versions') new_v WHERE new_v=old_v)) THEN
  RAISE EXCEPTION 'Signed service limits are immutable and revision must advance once' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_service_limit_history BEFORE UPDATE ON contracts.contract_service_limits
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_history();
CREATE FUNCTION contracts.protect_service_limit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.event_id,NEW.tenant_id,NEW.contract_id,NEW.version_id,NEW.aggregate_version,NEW.effective_at,NEW.payload,NEW.payload_sha256,NEW.created_at)
 IS DISTINCT FROM (OLD.event_id,OLD.tenant_id,OLD.contract_id,OLD.version_id,OLD.aggregate_version,OLD.effective_at,OLD.payload,OLD.payload_sha256,OLD.created_at) THEN
  RAISE EXCEPTION 'Service limit event payloads are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_service_limit_event BEFORE UPDATE OR DELETE ON contracts.service_limit_outbox
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_event();
