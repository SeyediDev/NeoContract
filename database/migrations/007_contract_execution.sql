-- The signed basis and every execution command are retained independently of proposals.
CREATE TABLE contracts.contract_execution (
 tenant_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contracts(tenant_id,id)
);
CREATE TABLE contracts.execution_commands (
 tenant_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 120),
 request_hash text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL,
 actor jsonb,
 payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contract_id,request_key),
 UNIQUE(tenant_id,contract_id,revision),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES contracts.contract_execution(tenant_id,contract_id)
);
CREATE FUNCTION contracts.protect_execution_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Execution commands are immutable; record a compensating command' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_execution_command BEFORE UPDATE OR DELETE ON contracts.execution_commands
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_command();
CREATE FUNCTION contracts.protect_execution_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.contract_id<>OLD.contract_id OR NEW.revision<>OLD.revision+1
 OR NEW.state->'basis' IS DISTINCT FROM OLD.state->'basis' THEN
  RAISE EXCEPTION 'Execution basis is immutable and revision must advance once' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_execution_basis BEFORE UPDATE ON contracts.contract_execution
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_execution_basis();
