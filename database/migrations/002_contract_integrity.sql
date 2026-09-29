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
