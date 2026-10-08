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

## Read-only activation preflight

Keep central authorization disabled while provisioning. With the application's
server-side environment loaded, run:

```bash
npm run access:check -- /run/secrets/neocontract-admission-cases.json
```

On the existing VPS, execute inside the app container so the approved CA, HTTPS
host resolution and PostgreSQL configuration match runtime. Preserve both Compose
files (`docker-compose.production.yml` and the private `compose.https.yml`). The
case file must already be readable inside the container; pass it through an
approved private mount or copy it temporarily with restricted permissions. Never
commit real subjects or credentials. The command does not load `.env` by itself.

The file is a JSON array of explicit, approved SSO subjects and expected local
tenant UUIDs, for example:

```json
[
  {
    "subject": "<actual-approved-admin-subject>",
    "tenantIds": [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000003",
      "00000000-0000-0000-0000-000000000004",
      "00000000-0000-0000-0000-000000000005"
    ],
    "allowed": true
  }
]
```

For demo acceptance include all four approved subjects (admin, legal, finance,
viewer); negative cases may also use `allowed:false`. Every local customer must
have at least one positive case; duplicate subject/tenant pairs are rejected.
Placeholder subjects are documentation examples only. The archived Titan
workspace is rejected. The mapping must contain exactly the four current local
customers with unique, confirmed central UUIDs.

The JSON report checks trusted SSO proxy settings, TLS validation, dedicated
service identity, mapping coverage, token scope/client/audience/expiry, active
local and central membership, actual application admission and central product
metadata (key, Rayan center, canonical URL and nonempty owner/name/audience).
`GET /api/platform/products?subject=...&tenant=...` is additionally required for
the preflight's read-only registry check; runtime admission still uses only the
two endpoints listed above. The product audience's exact integration value and
registry durability across restart must be verified with the central owner.

Token claims are inspected for diagnostics, **not cryptographically verified by
this script**; the authenticated Access API must also accept the token and enforce
its signature, issuer, audience and policy. A decoded JWT alone cannot pass the
preflight. HTTP 400 from the token endpoint is reported separately from HTTP 403
on a protected API. These statuses identify the failing layer, not a guessed
upstream reason. Response bodies, credentials, tokens and subject values are
never included; subjects are identified only by zero-based index in the private
case file. A local PostgreSQL read failure is also sanitized.

The database transaction is `READ ONLY`; this command does not migrate, seed,
open/create PGlite, register products, grant access, or change the activation flag.
Exit status is 0 only when all configured checks pass, otherwise 1. The report's
`activationChanged` is always false. Mapping and token errors can be reported
together even when provisioning is incomplete. Passing this preflight does not
replace real SSO role checks, denied direct-access checks, central revoke/restore
acceptance or durable registry verification before operational activation.

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

`node --test tests/central-access-preflight.test.mjs` checks readiness failures,
token/API policy distinction, catalog identity, negative cases, archived/disabled
local membership and secret-free reports without contacting the live platform.
