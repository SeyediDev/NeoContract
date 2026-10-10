-- Operational evidence only: these tables are neither financial usage nor a wallet ledger.
CREATE TABLE contracts.api_calls (
 tenant_id uuid NOT NULL REFERENCES contracts.tenants(id), event_id text NOT NULL,
 producer_id text NOT NULL, event_hash text NOT NULL, occurred_at timestamptz NOT NULL,
 service_key text NOT NULL, request_id text NOT NULL, method text NOT NULL, path text NOT NULL,
 status_code integer NOT NULL CHECK(status_code BETWEEN 100 AND 599),
 duration_ms double precision NOT NULL CHECK(duration_ms>=0),
 request_bytes bigint NOT NULL CHECK(request_bytes>=0), response_bytes bigint NOT NULL CHECK(response_bytes>=0),
 request_body jsonb, response_body jsonb, search_document tsvector NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,event_id)
);
CREATE INDEX api_calls_time ON contracts.api_calls(tenant_id,occurred_at DESC,event_id DESC);
CREATE INDEX api_calls_service_time ON contracts.api_calls(tenant_id,service_key,occurred_at DESC);
CREATE INDEX api_calls_status_time ON contracts.api_calls(tenant_id,status_code,occurred_at DESC);
CREATE INDEX api_calls_content ON contracts.api_calls USING gin(search_document);
CREATE TABLE contracts.api_call_hourly (
 tenant_id uuid NOT NULL REFERENCES contracts.tenants(id), hour timestamptz NOT NULL,
 service_key text NOT NULL, status_code integer NOT NULL, latency_bucket integer NOT NULL,
 calls bigint NOT NULL, duration_sum double precision NOT NULL,
 request_bytes bigint NOT NULL, response_bytes bigint NOT NULL,
 PRIMARY KEY(tenant_id,hour,service_key,status_code,latency_bucket)
);
CREATE INDEX api_call_hourly_time ON contracts.api_call_hourly(tenant_id,hour);
