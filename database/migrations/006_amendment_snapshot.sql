-- Review decisions can evolve; the submitted content and financial version cannot.
CREATE OR REPLACE FUNCTION contracts.protect_amendment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.contract_id,NEW.amendment_no,NEW.title,NEW.reason,NEW.summary,NEW.created_at,NEW.delta-'workflow')
 IS DISTINCT FROM
 (OLD.id,OLD.tenant_id,OLD.contract_id,OLD.amendment_no,OLD.title,OLD.reason,OLD.summary,OLD.created_at,OLD.delta-'workflow') THEN
  RAISE EXCEPTION 'Amendment snapshots are immutable; create a new draft' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_amendment_snapshot BEFORE UPDATE ON contracts.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_amendment_snapshot();
