# Tenant isolation and access

Titan is a product. The active workspaces are انتخاب (`entekhab`), باسلام (`basalam`), زودکس (`zoodex`) and سلام‌پی (`salam-pay`). The original `titan` workspace is archived after the atomic corrective import; original evidence and the unassigned internal project are retained there. See [customer tenancy](CUSTOMER-TENANCY.md) for the mapping, history and repeatability rules. Unresolved legal counterparties remain unresolved.

Every API request resolves one active tenant on the server. Send `X-Tenant-Id` with its UUID. `/api/tenants` returns permitted tenants, active tenant and access mode. SSO starts with an authorized membership; local use starts with انتخاب. `NEOCONTRACT_DEFAULT_TENANT` can override the local initial choice. Settings, contracts, documents, template versions, catalog imports, integration jobs and health counts use the resolved tenant. Composite PostgreSQL foreign keys reject relationships between tenants. There is no global mutable “current tenant”.

## Local use

Without credentials, a non-production server runs in `local-demo` mode. Both the socket address and Host header must be loopback. This mode permits switching tenants for evaluation and is **not authentication**. A loopback reverse proxy must not expose this mode to other users. Cross-origin API requests are rejected, including reads. The frontend shows the local-mode notice and discards the old tenant's state on switching.

## Authenticated deployment

The VPS uses `oidc-proxy` through Fanasa SSO with HTTPS. The application trusts
identity headers only behind its restricted proxy. The verified SSO subject must
match an active stored membership in an active tenant. Email does not substitute
another subject. Multiple memberships allow workspace selection, with roles read
only from the selected tenant. A viewer cannot mutate data, including pricing.
An archived or foreign tenant is denied before returning its contents. This does
not yet synchronize memberships with the central Access Management registry.

Workflow completion also requires the role of the current saved stage; reviewers
cannot advance another department's stage or a signature step. See
[workflow permissions](WORKFLOW.md). User administration cannot grant
`platform_admin` from `contract_admin`, remove the current administrator's own
administrative role, or disable/demote the last active administrator. These
changes are serialized per workspace and committed with their audit record.
Late user-list replies are discarded after a workspace change.

### Tenant API credentials

`NODE_ENV=production` requires authentication and cannot enable local-demo mode. Configure `NEOCONTRACT_TENANT_TOKENS` as a JSON object mapping tenant UUIDs to different random secrets of at least 32 characters. Keep this environment value in the deployment secret manager; do not commit it. Supplying credentials also enables authentication outside production. Each request must supply `Authorization: Bearer <tenant-secret>` and may select only the tenant authorized by that secret. Missing or invalid secrets receive 401; selecting a different tenant receives 403. No credentials means all API requests remain denied. Tenant lists never reveal other tenants to that credential. Secrets are compared using constant-time hash comparison and never returned by the API.

The browser does not store shared deployment credentials. The web deployment uses
the identity gateway and application roles described above. Tenant API keys provide
a server-side boundary, not individual user authentication or approval signatures.
Do not put a shared server credential in public JavaScript.

## Catalog, seed and external integration

Each customer workspace has independent identifiers for the 14-center / 87-service checked-in catalog and base template seed. Those are copied from versioned seed files. The one-time corrective import additionally copies the explicitly mapped historical demo aggregates from the archived source, preserving their history. Re-running the seed preserves operator edits and existing contract snapshots. The board import is idempotent and retains unknown commercial values as null. Requests cannot advance an intake contract into signing while its customer, amount or dates are missing, or the immutable snapshot retains confirmation flags. Filling database columns alone cannot authorize signing the original preliminary text. Prepare a complete negotiated replacement contract/version and record its relationship in an amendment; the intake snapshot remains evidence of the original request.

The legacy Neo integration configuration applies only to the demo tenant. Other tenants require an explicit server-side `tenantIntegrationOptions[tenantId].neoConfig`; Titan starts disconnected and no seed sends anything to Neo. Integration instances and job locks are separate per tenant. Catalog import and approval always use the requesting tenant. Browser-visible database health contains only the requesting tenant's counts; command-line database health may report aggregate operational totals.

The current implementation uses application-scoped queries and composite tenant constraints, not PostgreSQL row-level security. Direct database administrators are trusted. Backend tenant isolation tests cover credential/header tampering, foreign record reads and writes, settings, catalog identity, health, external integration and concurrent requests.
