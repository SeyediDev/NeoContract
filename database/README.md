# PostgreSQL storage

`lib/database.mjs` opens standard PostgreSQL through `connectionString`, or durable PGlite PostgreSQL at `.data/postgres` by default. PGlite is the PostgreSQL engine compiled to WASM, not a JSON or SQLite fallback. The default local demo should have one server process per data directory.

```js
const db = await createDatabase({ dataDir: '.data/postgres' });
await db.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1', [tenantId]);
await db.transaction(async tx => { /* parameterized writes */ });
await db.close();
```

For a separate PostgreSQL server pass `{ connectionString: process.env.DATABASE_URL }`. The adapter uses a pool and binds all queries in each transaction to one checked-out connection. No credential is written to this repository.

Migrations in `migrations/` are applied atomically with a checksum ledger. Version 001 creates the tenant-scoped schema; version 002 protects contract snapshots and adds unique request idempotency keys. Later changes must be new numbered migrations; changed historical checksums fail closed. `schema.sql` is the matching rerunnable standalone bootstrap; run it before `seed.sql` and `fanasa-catalog.sql` when using psql, with `ON_ERROR_STOP=1` and `--single-transaction` for seed files. Runtime initialization applies both seeds in one transaction and preserves existing operator edits.

All relational references to tenant-owned entities use composite foreign keys. Authorization remains intentionally outside this demo; these constraints reject cross-tenant references without implementing users/RBAC.

The observed source seed contains 5 zones, 14 centers and 87 services. Pricing-model mappings were observed; per-service SLA/delivery and prices were not present in that snapshot and remain unknown. SLA business-day values retain their units rather than being converted to elapsed minutes. All source records remain `browser-observed-unverified`. Customers/managers are visibly synthetic; template clauses are editorial demos without legal approval.

`node --test tests/database.test.mjs` executes real PostgreSQL checks for initial/repeated initialization, tenant constraints, rollback, invalid dates/quantities, published-version immutability, independent contract snapshots and durable close/reopen. The PostgreSQL pool path shares the same SQL but requires an operator-supplied database for an external-server integration run.
