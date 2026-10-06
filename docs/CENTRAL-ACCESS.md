# Central application admission

NeoContract supports the observed Fanasa Access Management API:

- `GET /api/platform/application-tenants?subject=...`: active memberships;
- `POST /api/platform/authorize`: `{subject, tenantId,
  permission:"application.access", productKey:"neocontract"}` → `{allowed:boolean}`.

This is application admission, not a contract-role assignment. Access Management
owns central organizations, product registration, offers and application grants.
NeoContract uses existing local membership references and per-workspace contract
roles. It does not store passwords, register a second product catalog, invent
central tenants, infer an administrator from application access or copy platform
administrator roles into a contract workspace.

## Provisioning and activation

1. Register the `neocontract` product centrally with its confirmed official center,
   owner and canonical URL `https://contracts.fanasa.net.local`. Preserve any
   existing registration instead of guessing its ownership or center.
2. Confirm central tenant UUIDs for انتخاب, باسلام, زودکس and سلام‌پی and store an
   explicit local-to-central mapping in `NEOCONTRACT_ACCESS_TENANT_MAP`. Local
   contract IDs and legal history do not change when central IDs differ.
3. Register active offers, subject memberships and per-product entry grants through
   central administration. Demo contract proposals are not signed contracts and
   must not create active commercial entitlements.
4. Configure the dedicated `fanasa-contract-service` confidential client with
   audience `fanasa-access-management-web`, `platform.catalog` scope and only the
   central read/authorize policy required by these two endpoints. A developer or
   portal client is not reused. Client credentials stay in server secrets.
5. Supply the HTTPS service URLs and credential settings documented in
   `.env.example`. Mount the already approved internal CA read-only into the app
   and point `NODE_EXTRA_CA_CERTS` at its container path. TLS remains validated.
6. Verify the dedicated service's actual central API access before setting
   `NEOCONTRACT_ACCESS_ENABLED=true` and recreating the app.

The connector is disabled by default until provisioning is complete. Once enabled,
it cannot fall back to local memberships when the central service fails.

## Runtime behavior

For every SSO API request, the server intersects active local memberships with
active central memberships and affirmative application decisions for the mapped
tenant UUIDs. A local disabled membership, missing mapping, revoked central
membership, inactive offer or absent application grant cannot produce access.
Roles remain scoped to the selected local membership. The browser receives no
service credentials or tokens; bootstrap exposes only `authorizationSource`.

Authorization results are not cached. Only the short-lived service token is
cached; concurrent calls share token acquisition. Each upstream request has a
five-second timeout, redirects are rejected, response size is bounded and invalid
JSON/schema or upstream failure produces a sanitized 503. Explicit denial produces
403. No upstream response body or credential is exposed in the error.

`node --test tests/central-access.test.mjs` exercises revocation, token refresh,
concurrency, malformed replies, TLS/configuration validation, isolated roles and
refusal to fall back during an outage. Live activation additionally requires actual
SSO admin/viewer checks and central revoke/restore verification.
