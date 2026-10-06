# Customer tenancy release — 2026-10-06

Runtime commit: `47e3d84` (main, pushed and deployed to `/opt/neocontract`).

The user confirmed Titan is a product. The page now reads «پرونده‌های قرارداد».
Four active workspaces contain the five requested proposals and their dynamic
pricing plans: انتخاب 1, باسلام 2, زودکس 1 public-cloud usage, سلام‌پی 1.
The four product scopes remain in انتخاب. Historical source aggregates and the
unassigned internal development contract remain in the archived source workspace.

## Verification

- Seven initial pricing/identity/migration tests passed.
- Seven migration/tenant-boundary tests (including five HTTP subtests) passed.
- The final migration test passed again after adding strict proposal-link checks.
- Two customer-workspace UI scenarios passed at 1440 and 390 pixels.
- Six legacy board/pricing/draft-isolation UI scenarios passed.
- Actual HTTPS SSO logins for `contracts.admin` and `contracts.viewer` succeeded.
- Both identities can read all four assigned workspaces. Viewer writes return 403
  in every workspace. Foreign contract reads and pricing-plan writes return 404;
  selecting the archived tenant returns 403.
- All five copied proposals reference a pricing plan in their own tenant and
  retain their source totals: 36b, 72b, 42b and 24b IRR; Zoodex's historical
  monthly usage example remains 109,242,000 IRR.
- Desktop screenshots and the 390-pixel pricing screen were visually inspected;
  no horizontal overflow or JavaScript page errors were detected.
- Application container was running with zero restarts after deployment.
- Four existing demo memberships are active in each customer workspace. None
  has a platform-administrator role in those workspaces.

## Backup and source preservation

Verified custom-format PostgreSQL backup:
`/opt/neocontract-backups/20261006T152527Z-before-customer-tenancy.dump`
(364,229 bytes; 296 restore-list entries; mode 600).
Previous app image: `neocontract-app:before-customer-tenancy-20261006`.

Before/after database fingerprints matched exactly for all original seven
contract rows and sixteen document rows. No original row was rewritten:

- Contracts: `9c49c770df4dc7a60dac6ddd426617f5`
- Documents: `16602b866fe2e1f6fd1052c3bf3eb8c8`

Deployment used both the tracked production Compose file and the existing private
HTTPS override. No credentials or private overrides are included in this release.

Central tenant and membership synchronization with Access Management remains
unimplemented; current isolation and membership checks are enforced inside
NeoContract. See [customer tenancy](CUSTOMER-TENANCY.md).
