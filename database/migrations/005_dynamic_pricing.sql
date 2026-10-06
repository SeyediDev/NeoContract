CREATE TABLE contracts.pricing_plans (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES contracts.tenants(id),
  name text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  model jsonb NOT NULL,
  total numeric(18,0) NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE TABLE contracts.pricing_plan_versions (
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  model jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, plan_id, revision),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES contracts.pricing_plans(tenant_id, id)
);
CREATE INDEX pricing_plans_tenant_updated ON contracts.pricing_plans(tenant_id, updated_at DESC);

CREATE FUNCTION contracts.protect_pricing_version() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Pricing model versions are immutable' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_pricing_version BEFORE UPDATE OR DELETE ON contracts.pricing_plan_versions
FOR EACH ROW EXECUTE FUNCTION contracts.protect_pricing_version();

ALTER TABLE contracts.contract_services ALTER COLUMN quantity TYPE numeric(22,6);
ALTER TABLE contracts.contract_services ALTER COLUMN unit_price TYPE numeric(22,6);
