ALTER TABLE contracts.service_limit_outbox
 ADD COLUMN dispatch_projection jsonb,
 ADD COLUMN dispatch_sha256 text,
 ADD COLUMN dispatch_registry_reference text,
 ADD CONSTRAINT service_limit_dispatch_complete CHECK (
   (dispatch_projection IS NULL AND dispatch_sha256 IS NULL AND dispatch_registry_reference IS NULL)
   OR (dispatch_projection IS NOT NULL AND jsonb_typeof(dispatch_projection)='object'
       AND dispatch_sha256 IS NOT NULL AND dispatch_sha256 ~ '^[a-f0-9]{64}$'
       AND dispatch_registry_reference IS NOT NULL AND length(dispatch_registry_reference) BETWEEN 1 AND 1000)
 );

CREATE FUNCTION contracts.protect_service_limit_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.dispatch_projection IS NOT NULL AND
  (NEW.dispatch_projection,NEW.dispatch_sha256,NEW.dispatch_registry_reference)
  IS DISTINCT FROM (OLD.dispatch_projection,OLD.dispatch_sha256,OLD.dispatch_registry_reference) THEN
  RAISE EXCEPTION 'Dispatched service limit projection is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.status='acknowledged' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Observed Gateway receipt is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_service_limit_delivery BEFORE UPDATE ON contracts.service_limit_outbox
 FOR EACH ROW EXECUTE FUNCTION contracts.protect_service_limit_delivery();
