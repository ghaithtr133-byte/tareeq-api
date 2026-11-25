# Backend release checklist

Use this checklist for a coordinated Backend release. It records evidence, not approval.

## Already verified locally

- The earlier guarded disposable PostgreSQL run completed 20/20 tests across five suites.
- Current non-database local checks after the latest test-suite additions:
  - `npm test`: 192 passed; PostgreSQL-gated tests skip without the approved test target.
  - `npm run test:api`: 136 passed.
  - TypeScript, ESLint, Prisma validation/generation, Postman synchronization, and production build: passed locally.
  - Generated OpenAPI/Postman contract: 143 operations.
- The five latest PostgreSQL tests in `auth-recovery.postgres.integration.test.ts` and `deletion.postgres.integration.test.ts` are **not yet executed against the disposable target**. Do not report 25/25 until the guarded command succeeds.

## Required owner actions before release completion

1. In the dedicated disposable test project only, run the documented guarded sequence in [database-integration-testing.md](./database-integration-testing.md). Require 25/25 passing tests across seven suites, including fixture cleanup and rollback checks.
2. Review and commit the resulting local changes, then deploy through the approved release process. Do not deploy unreviewed test failures or generated-artifact drift.
3. Verify Resend sender/domain configuration and one owner-approved real recovery/delivery acceptance flow (TA-15). Do not expose OTPs or credentials in records or reports.
4. Verify one authorized Cloudinary upload returns the expected HTTPS media URL without exposing provider credentials (TA-16).
5. Run the read-only production verifier and targeted frontend compatibility smoke tests: public content reads, Admin cookie/origin behavior, recovery request/verify/reset, featured ordering, and deletion contracts without destructive production requests.
6. Close Linear work only after the relevant code, isolated PostgreSQL evidence, deployment, and production acceptance evidence are recorded.

## Deployment safeguards

- Confirm production migration history and backups through owner-approved procedures before any migration. Do not use `db push`, reset, or a shared/disposable test target.
- Keep `PASSWORD_RECOVERY_SECRET` server-only, 32+ characters, and distinct from `JWT_SECRET`. Changing it invalidates outstanding recovery challenges.
- Ensure production has the exact approved `AUTH_ALLOWED_ORIGINS` and `PUBLIC_ALLOWED_ORIGINS`; `https://tareeq-academy.com` and `https://www.tareeq-academy.com` are distinct origins.
- Preserve Resend and Cloudinary secrets only in deployment configuration. They never belong in Git, Postman environments, browser code, or logs.

## Rollback note

Use application deployment rollback for an application regression. Do not attempt a destructive migration rollback against production data. The pending security migrations are additive; owner review is still required for migration history and production-state compatibility.
