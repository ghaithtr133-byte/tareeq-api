# Disposable PostgreSQL integration tests

The PostgreSQL integration suites are destructive within their fixture scope. They must never use production, a shared development database, a demo-seed database, or a backup branch.

## One-time owner setup for a new empty Neon test project

1. Create a dedicated, empty Neon project or branch reserved only for Backend integration tests. Do not use `main`, a shared branch, or a backup branch.
2. Derive the sanitized target identity as `host:port/database` from its direct PostgreSQL URL. Do not record or commit the URL itself.
3. In that disposable database only, create the independent marker before any Prisma migration:

```sql
CREATE SCHEMA IF NOT EXISTS tareeq_test_guard;

CREATE TABLE IF NOT EXISTS tareeq_test_guard.target_marker (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  target_identity TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose = 'TAREEQ_DISPOSABLE_INTEGRATION_TEST_ONLY')
);

INSERT INTO tareeq_test_guard.target_marker (singleton, target_identity, purpose)
VALUES (TRUE, 'host:port/database', 'TAREEQ_DISPOSABLE_INTEGRATION_TEST_ONLY')
ON CONFLICT (singleton) DO NOTHING;
```

The value in the SQL must be the sanitized identity for that exact disposable target. It is intentionally independent of the application migrations and survives fixture cleanup.

## Temporary PowerShell environment

Use a fresh PowerShell window. Never copy production `.env` credentials into it. Replace only the placeholders locally; do not save or print connection strings.

```powershell
Remove-Item Env:DATABASE_URL, Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue
$env:TAREEQ_TEST_DATABASE_MODE = '1'
$env:TAREEQ_TEST_DATABASE_APPROVAL = 'TAREEQ_DISPOSABLE_POSTGRES_INTEGRATION'
$env:TEST_DATABASE_URL = '<dedicated-disposable-direct-postgresql-url>'
$env:TEST_DATABASE_TARGET_ID = '<host:port/database>'
$env:JWT_SECRET = '<temporary-test-secret-at-least-32-characters>'
```

The guard rejects missing values, malformed URLs, target-ID mismatches, production/main/shared/backup/release-looking identities, and any `DATABASE_URL` or `DIRECT_DATABASE_URL` that points elsewhere.

## Required order

```powershell
npm run test:db:preflight
npm run test:db:migrate
npm run test:db:integration
```

`preflight` opens a read-only connection and verifies `current_database()` plus the database-resident marker. `migrate` and `integration` perform that same verification first, then force Prisma and all seven suites to use `TEST_DATABASE_URL`. Do not invoke `prisma migrate deploy` or an integration suite directly for this workflow.

The test wrapper enables all seven suite flags only after verification:

- `RUN_DATABASE_INTEGRATION`
- `RUN_AUTH_RECOVERY_DATABASE_INTEGRATION`
- `RUN_CONTENT_DATABASE_INTEGRATION`
- `RUN_DELETION_DATABASE_INTEGRATION`
- `RUN_EMAIL_DATABASE_INTEGRATION`
- `RUN_SUBMISSION_DATABASE_INTEGRATION`
- `RUN_UNIVERSITY_DIRECTORY_DATABASE_INTEGRATION`

The initial five suites previously passed 20/20 tests. The two added security/deletion suites add five tests, for an expected **25 tests across seven suites**. Those five additions are pending their first guarded disposable-target execution; a skipped local suite is not a passing database test.
