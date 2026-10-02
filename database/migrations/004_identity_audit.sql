SET search_path TO contracts, public;

CREATE TABLE IF NOT EXISTS app_user_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL,
 target_user_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('access_updated')),
 before_state jsonb NOT NULL DEFAULT '{}',
 after_state jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, actor_user_id) REFERENCES app_users(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id, target_user_id) REFERENCES app_users(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS app_user_audit_target_idx ON app_user_audit(tenant_id,target_user_id,created_at DESC);
