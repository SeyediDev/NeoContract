# Tenant isolation and access

Titan (`00000000-0000-0000-0000-000000000002`, slug `titan`) owns the requested board, its catalog, templates, workflow and the two customer records انتخاب and باسلام. The older demo tenant remains separate. Unresolved counterparties in the board are retained as source labels, not invented additional customers.

Every API request resolves one active tenant on the server. Send `X-Tenant-Id` with its UUID. `/api/tenants` returns the permitted tenants, active tenant and access mode. The SPA starts with Titan; `NEOCONTRACT_DEFAULT_TENANT` can override that initial choice. Legacy API callers without the header continue to use the demo tenant. Settings, contracts, documents, template versions, catalog imports, integration jobs and health counts use the resolved tenant. Composite PostgreSQL foreign keys reject relationships between tenants. There is no global mutable “current tenant”.

## Local use

Without credentials, a non-production server runs in `local-demo` mode. Both the socket address and Host header must be loopback. This mode permits switching tenants for evaluation and is **not authentication**. A loopback reverse proxy must not expose this mode to other users. Cross-origin API requests are rejected, including reads. The frontend shows the local-mode notice and discards the old tenant's state on switching.

## Authenticated deployment

`NODE_ENV=production` requires authentication and cannot enable local-demo mode. Configure `NEOCONTRACT_TENANT_TOKENS` as a JSON object mapping tenant UUIDs to different random secrets of at least 32 characters. Keep this environment value in the deployment secret manager; do not commit it. Supplying credentials also enables authentication outside production. Each request must supply `Authorization: Bearer <tenant-secret>` and may select only the tenant authorized by that secret. Missing or invalid secrets receive 401; selecting a different tenant receives 403. No credentials means all API requests remain denied. Tenant lists never reveal other tenants to that credential. Secrets are compared using constant-time hash comparison and never returned by the API.

The browser evaluation interface does not manage human identities or store these deployment credentials. A production web deployment needs an identity gateway or login/session implementation, HTTPS, access roles, secure tenant provisioning, credential rotation and operational controls before onboarding real users. Tenant API keys provide a server-side boundary, not individual user authentication or approval signatures. Do not put a shared server credential in public JavaScript.

## Catalog, seed and external integration

Titan receives independent identifiers for the 14-center / 87-service checked-in catalog and base template seed. Data is copied from versioned seed files, never from the legacy tenant's live records. Re-running the seed preserves operator edits and existing contract snapshots. The board import is idempotent and retains unknown commercial values as null. Requests cannot advance an intake contract into signing while its customer, amount or dates are missing, or the immutable snapshot retains confirmation flags. Filling database columns alone cannot authorize signing the original preliminary text. Prepare a complete negotiated replacement contract/version and record its relationship in an amendment; the intake snapshot remains evidence of the original request.

The legacy Neo integration configuration applies only to the demo tenant. Other tenants require an explicit server-side `tenantIntegrationOptions[tenantId].neoConfig`; Titan starts disconnected and no seed sends anything to Neo. Integration instances and job locks are separate per tenant. Catalog import and approval always use the requesting tenant. Browser-visible database health contains only the requesting tenant's counts; command-line database health may report aggregate operational totals.

The current implementation uses application-scoped queries and composite tenant constraints, not PostgreSQL row-level security. Direct database administrators are trusted. Backend tenant isolation tests cover credential/header tampering, foreign record reads and writes, settings, catalog identity, health, external integration and concurrent requests.
