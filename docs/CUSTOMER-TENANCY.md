# Product and customer workspaces

The user confirmed that **Titan (تایتان) is a product**. It is not an organization,
provider, or tenant. The page is named «پرونده‌های قرارداد».

## Corrective import

Normal server startup runs `provisionCustomerTenants` once after the historical
seed and pricing import. `NEOCONTRACT_CUSTOMER_TENANTS=false` retains the legacy
fixture for regression tests; it does not undo an already completed import.

| Workspace | Intake | Linked pricing models |
| --- | --- | ---: |
| انتخاب (`entekhab`) | titan-02 and four product scopes | 1 |
| باسلام (`basalam`) | titan-01, titan-05 | 2 |
| زودکس (`zoodex`) | titan-04, public cloud usage | 1 |
| سلام‌پی (`salam-pay`) | titan-03 | 1 |

The import copies complete selected contract aggregates with new deterministic
IDs: template versions, workflow, document revisions, events, services, pricing
plans and every pricing version. Referenced IDs are mapped within the destination
tenant. Original legal text, document hashes, timestamps and source provenance are
retained. Original aggregates remain untouched in the archived legacy workspace.
The internal project `titan-06` has no confirmed customer and remains in that
archive, alongside the superseded Zoodex draft. It is not arbitrarily assigned.

The transaction rolls back on an operator configuration conflict. Its completion
marker prevents repeated copying or overwriting later edits. External `neo_binding`
is cleared on copies so another tenant's integration identity is never reused.
Legal identities still marked unresolved remain unresolved; workspace names are
not treated as verified legal company identities.

## Authorization

Only the four existing demo identities, recognized by exact email and demo marker,
receive corresponding memberships with their existing active/disabled status and
existing product roles. No platform or Keycloak administrator grant is added.
Other operator memberships are not expanded automatically.

SSO authorization uses the verified subject. Email cannot substitute a different
subject. Only active memberships in active workspaces are listed. Roles are read
from the selected membership, never combined across tenants. Foreign and archived
workspaces are denied before disclosing their contents.

Tenant isolation is implemented in NeoContract. This import does not provision
central tenants. The optional [central admission connector](CENTRAL-ACCESS.md)
intersects local memberships with fresh central membership and application-entry
decisions when enabled after central provisioning. Contract roles remain scoped
locally. Access Management remains the central application registry; this change
creates no separate product registry.

## Verification

`node --test tests/customer-tenancy.test.mjs` verifies atomic rollback, five scoped
models, preserved original history, correct pricing links, repeatability and
per-tenant SSO permissions. `npx playwright test -c playwright.customer.config.mjs`
checks workspace switching, board counts and linked pricing on desktop and mobile.
