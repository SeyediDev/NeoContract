# Central admission preparation — 2026-10-06

Runtime commits: `883f7a7` (central connector and status UI), `7f24dee`
(atomic local role changes and access audit). Both were pushed and deployed to
the existing VPS contract application.

The user explicitly approved coordinating with the chat **Fanasa Platform Control
Center** and chose **رایان** as NeoContract's primary capability center. The central
registration request was sent to that chat. This does not mean registration or
central authorization has completed.

## Completed verification

- Six connector scenarios passed, including token sharing/refresh, immediate
  revocation, invalid upstream replies, response limits, safe error messages,
  explicit tenant mappings and refusal to fall back during central outage.
- Four existing SSO/role scenarios passed with the new connector available.
- The role-management regression now injects an audit-write failure and confirms
  the prior role grant is preserved, then confirms a successful update/audit.
- Actual admin and viewer SSO logins succeeded after deployment. All four customer
  workspaces, five linked pricing proposals, foreign record denial and viewer
  write denial remained correct.
- Mobile status-panel screenshot was inspected. It correctly shows local
  application membership while central admission is not activated.
- From inside the app container, HTTPS requests to Access `/health/live` and SSO
  discovery returned 200 using the approved CA with TLS validation enabled.
- App container was running, healthy, with zero restarts after deployment.

## Deployment controls and outstanding dependency

Dedicated credentials are loaded from the existing private contract-service file
on the VPS; no credentials were added to Git or browser responses. The app receives
read-only access to the already approved gateway certificate and host mappings for
the two canonical service hosts. Previous private deployment configuration and
the previous app image were preserved for rollback.

`NEOCONTRACT_ACCESS_ENABLED=false` remains set deliberately. The dedicated central
service's request for `platform.catalog` was rejected with HTTP 400 during the
readiness probe. Central tenant IDs, NeoContract's registered offer/application
grants and the dedicated service's permission for the two read/authorize endpoints
must be confirmed before activation. Existing SSO access is still enforced by
active application memberships and per-tenant roles.

The original five proposals have not generated active commercial entitlements.
See [central access](CENTRAL-ACCESS.md) for activation and live acceptance checks.
