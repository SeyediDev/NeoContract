# Fanasa Managed Binding Acceptance

Development-only .NET10 HTTP fixture for PostgreSQL and Redis consumption, separate from the root NeoContract Node application. Do not expose it publicly. It has no standalone authentication and must be launched only through the existing tenant-authorized developer portal.

## Portal Inputs

- Repository: `https://github.com/SeyediDev/NeoContract`; branch: `master`.
- Runtime: `dotnet10`; project: `samples/fanasa-managed-bindings/ManagedBindings.csproj`.
- Port: `8080`; CPU: `100m`; memory: `256Mi`; replicas: `1`; environment: development only.
- Import this folder's `appsettings.json`. It requests `cache`/Redis and `database`/PostgreSQL, with credentials injected through Secret references. Never commit passwords or connection strings.
- Restore uses pinned dependencies and `packages.lock.json`: verify with `dotnet restore --locked-mode`.

## Acceptance

Launch from the actual Git source through the portal, retaining the source commit and deployment revision. Never substitute binaries or rewrite the source PVC. Process liveness is `/health/live`; `/health/ready` actually performs PostgreSQL SELECT1 and Redis PING and returns503 without bindings.

POST a new UUID to `/acceptance/probes/{uuid}` and require both `postgreSqlReadBack` and `redisReadBack` to be true. GET that same UUID separately. Restart only the fixture runtime through the authorized portal control, then GET again without another write. Save the probe ID and readback evidence, never credentials.

Writes are limited to `fanasa_acceptance_probes` and UUID-based `fanasa:acceptance:` Redis keys. SQL uses parameters, cache keys expire after24 hours, and no unrelated data is deleted. The two writes are not a distributed transaction. The database user has DDL permission for this evaluation fixture, not a production migration design. This does not prove database TLS, backup/restore, full tenant isolation or production readiness.

## Local Contract Tests

Run `dotnet run -c Release --urls http://127.0.0.1:15189` from this folder without connection settings. Run `node --test --test-isolation=none tests/unconfigured.test.mjs`, then stop the runtime. Missing-binding tests are not actual database-consumption evidence.

This isolated folder changes no root Node dependency, application, solution or existing workflow. Merely publishing the fixture is not proof it was deployed or that consumption succeeded.
