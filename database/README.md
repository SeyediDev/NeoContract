# PostgreSQL storage

Version 008 adds `contract_service_limits`, append-only `service_limit_commands`
and immutable-payload `service_limit_outbox`. Contract locks serialize revisions,
signed evidence, audit and outbox in one transaction. Signed versions cannot be
rewritten; amendments append a later-effective version. All three tables are in
JSON backup/restore. Seeds do not infer TPS from prices or create signed limits.
See [service capacity](../docs/SERVICE-CAPACITY.md).

`node scripts/check-service-limit-database.mjs` requires an explicitly supplied
`NEOCONTRACT_SERVICE_LIMIT_ACCEPTANCE_URL`, with an empty database named
`neocontract_capacity_acceptance_<digits>`. It verifies migration 008, signed
amendments, rollback, retries, tenant/role isolation, SQL immutability and receipt
validation through a test transport. The operator creates/removes the scratch DB.

`lib/database.mjs` opens standard PostgreSQL through `connectionString`, or durable PGlite PostgreSQL at `.data/postgres` by default. PGlite is the PostgreSQL engine compiled to WASM, not a JSON or SQLite fallback. The default local demo should have one server process per data directory.

```js
const db = await createDatabase({ dataDir: '.data/postgres' });
await db.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1', [tenantId]);
await db.transaction(async tx => { /* parameterized writes */ });
await db.close();
```

For a separate PostgreSQL server pass `{ connectionString: process.env.DATABASE_URL }`. The adapter uses a pool and binds all queries in each transaction to one checked-out connection. No credential is written to this repository.

Migrations in `migrations/` are applied atomically with a checksum ledger. Version 001 creates the tenant-scoped schema; version 002 protects contract snapshots and adds unique request idempotency keys. Later changes must be new numbered migrations; changed historical checksums fail closed. `schema.sql` describes the original bootstrap. Initialize current installations through `createDatabase` / `npm run db:migrate` so all numbered migrations and their checksums are applied; do not treat the original bootstrap alone as the current schema. Runtime initialization applies both seeds in one transaction and preserves existing operator edits.

All relational references to tenant-owned entities use composite foreign keys. The API also enforces tenant memberships and application roles; the composite constraints independently reject cross-tenant references.

The observed source seed contains 5 zones, 14 centers and 87 services. Pricing-model mappings were observed; per-service SLA/delivery and prices were not present in that snapshot and remain unknown. SLA business-day values retain their units rather than being converted to elapsed minutes. All source records remain `browser-observed-unverified`. Customers/managers are visibly synthetic; template clauses are editorial demos without legal approval.

`node --test tests/database.test.mjs` executes real PostgreSQL checks for initial/repeated initialization, tenant constraints, rollback, invalid dates/quantities, published-version immutability, independent contract snapshots and durable close/reopen. The PostgreSQL pool path shares the same SQL but requires an operator-supplied database for an external-server integration run.

Version 007 adds `contract_execution` (signed immutable basis and revisioned execution aggregate) and append-only `execution_commands`. Contract locks serialize writes; state, receipt, and contract event commit atomically. Both tables are included in JSON backup/restore. Execution starts only by explicit recording of signed evidence; seeds never fabricate executions. See [execution rules](../docs/CONTRACT-EXECUTION.md).
