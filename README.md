# Tareeq Academy Backend

Standalone API for Tareeq Academy. It provides administrative cookie authentication and content APIs for countries, universities, scholarships, services, and articles.

Detailed endpoint schemas and examples are generated at `/openapi.json` and rendered through Scalar at `/docs`. Frontend workflows are documented in [docs/frontend-integration.md](docs/frontend-integration.md).

## Technology and prerequisites

- Node.js `24.x`.
- npm `11.6.2`, as declared by `packageManager`; use the committed `package-lock.json`.
- Hono `4.13.13`, strict TypeScript, Zod/OpenAPI, and Scalar.
- Prisma ORM and Client `7.10.0`.
- A Neon PostgreSQL database with a pooled runtime URL and direct migration URL.

Do not provide database URLs, JWT secrets, bootstrap credentials, or other Backend secrets to Frontend applications. Frontends communicate only with the HTTP API.

## Local setup

From the repository root:

```powershell
npm install
Copy-Item .env.example .env
npm run prisma:generate
npm run dev
```

On macOS or Linux, replace the copy command with `cp .env.example .env`. Fill in `.env` before starting routes that use authentication or the database. Never commit `.env`.

`npm run dev` loads `.env` when present and starts the local Node server. `PORT` defaults to `3000`, so the default URLs are:

- `http://localhost:3000/api/v1/health` — process health only; it does not probe the database.
- `http://localhost:3000/openapi.json` — generated OpenAPI 3.1 document.
- `http://localhost:3000/docs` — Scalar interactive API reference.

If `PORT` is changed, use that port in all three URLs.

## Environment variables

| Variable | Requirement | Used by | Format |
| --- | --- | --- | --- |
| `PORT` | Optional; default `3000` | Local Node server | Integer from 1–65535 |
| `NODE_ENV` | Optional; default `development` | Runtime cookie security | `development`, `test`, or `production` |
| `DATABASE_URL` | Required for database-backed runtime routes | Prisma runtime client | Pooled Neon PostgreSQL URL |
| `DIRECT_DATABASE_URL` | Required by the approved migration workflow | Prisma CLI | Direct/unpooled URL for the same Neon database |
| `JWT_SECRET` | Required for authentication/Admin routes | JWT signing and verification | Private random string, at least 32 characters |
| `AUTH_ALLOWED_ORIGINS` | Required for authentication/Admin routes | Credentialed CORS and origin/CSRF checks | Comma-separated exact origins without paths |
| `PUBLIC_ALLOWED_ORIGINS` | Optional; required for cross-origin public browser reads | Non-credentialed CORS for the public read route category | Comma-separated exact origins without paths |
| `BOOTSTRAP_SUPER_ADMIN_NAME` | Bootstrap only | `npm run auth:bootstrap` | Non-empty name, maximum 120 characters |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | Bootstrap only | `npm run auth:bootstrap` | Valid administrator email |
| `BOOTSTRAP_SUPER_ADMIN_PASSWORD` | Bootstrap only | `npm run auth:bootstrap` | 12–128 characters with lowercase, uppercase, and numeric characters |
| `INITIAL_ADMIN_NAME` | Task #4 provisioning only | `npm run admins:provision` | Non-empty name, maximum 120 characters |
| `INITIAL_ADMIN_EMAIL` | Task #4 provisioning only | `npm run admins:provision` and authenticated verification | Valid administrator email |
| `INITIAL_ADMIN_PASSWORD` | Task #4 provisioning only | Provisioning and authenticated verification | 9–128 characters with at least one lowercase and one uppercase English letter; numbers and special characters are optional |
| `INITIAL_SUPER_ADMIN_NAME` | Task #4 provisioning only | `npm run admins:provision` | Non-empty name, maximum 120 characters |
| `INITIAL_SUPER_ADMIN_EMAIL` | Task #4 provisioning only | `npm run admins:provision` and authenticated verification | Valid administrator email distinct from the ADMIN email |
| `INITIAL_SUPER_ADMIN_PASSWORD` | Task #4 provisioning only | Provisioning and authenticated verification | 9–128 characters with at least one lowercase and one uppercase English letter; numbers and special characters are optional |

`DATABASE_URL` is used by the running application through `src/database/client.ts`. `DIRECT_DATABASE_URL` is preferred by `prisma7.config.ts` for Prisma migrations; the configuration technically falls back to `DATABASE_URL`, but the approved Neon workflow uses the direct URL.

`AUTH_ALLOWED_ORIGINS` values must be exact Admin origins such as `http://localhost:3001` or `https://admin.tareeq-academy.com`. It controls both credentialed CORS and trusted-origin/CSRF checks for authentication and Admin routes. `PUBLIC_ALLOWED_ORIGINS` independently permits non-credentialed browser reads from exact student/frontend origins such as `https://tareeq-academy.com`; it does not grant credentialed access or CSRF trust. Do not include paths. Never use `*` with credentialed requests.

## Commands

```powershell
npm run dev                    # Watch and run src/server.ts with .env
npm run prisma:generate        # Generate Prisma Client
npm run prisma:validate        # Validate schema and Prisma configuration
npm run prisma:migrate:status  # Read-only migration status
npm run typecheck              # Strict TypeScript check
npm run lint                   # ESLint
npm run build                  # Compile production output to dist/
npm start                      # Run the compiled local Node server
npm test                       # Safe default Vitest suite; DB suites remain gated
npm run test:api               # Safe isolated health/auth/content API regression
npm run seed:inspect           # Read-only database counts and deterministic seed plan
npm run admins:provision       # Explicit idempotent permanent Admin provisioning
npm run content:seed           # Explicit idempotent initial content seed
```

The repository uses the custom root configuration file `prisma7.config.ts`. Prisma `7.10.0` discovers it when commands run from the repository root, which is how the npm scripts are defined. The file loads `.env`, uses `DIRECT_DATABASE_URL` before `DATABASE_URL`, and points Prisma at `prisma/schema.prisma` and `prisma/migrations`.

For an already provisioned/deployed database, inspect status first and apply reviewed migrations only when explicitly authorized:

```powershell
npm run prisma:migrate:status
npm run prisma:migrate:deploy
```

`prisma:migrate:deploy` changes the database. Do not run it merely to test setup. `prisma:migrate:dev` is retained for explicitly identified isolated development databases and must not be used casually against the shared Neon database. Never use `prisma db push` as a substitute for migration history.

### Explicitly authorized PostgreSQL tests

The ordinary test commands do not mutate Neon. Content integration is separately gated:

```powershell
$env:RUN_CONTENT_DATABASE_INTEGRATION = '1'
npm test -- test/content.postgres.integration.test.ts
Remove-Item Env:RUN_CONTENT_DATABASE_INTEGRATION
```

Run it only with current authorization. It creates uniquely named temporary fixtures, tracks exact IDs, deletes only those IDs, and verifies cleanup. The existing authentication PostgreSQL suite is similarly gated by `RUN_DATABASE_INTEGRATION=1` and should be run only when its mutations are explicitly in scope.

## Approved database policy

Project Leadership formally approved one Neon PostgreSQL database for development and eventual production. Treat it as production-sensitive:

- Never reset the database or rewrite migration history.
- Never use destructive migrations without explicit approval.
- Never use broad `DELETE`, `TRUNCATE`, or cleanup operations.
- Never modify real records as test fixtures.
- Isolate temporary fixtures and remove them by exact tracked IDs.
- After actual production launch, obtain fresh authorization before any database-mutating integration test.
- Do not operate Neon or Vercel management consoles through agents.

## Authentication and browser security

The API uses host-only HttpOnly cookies: a signed 15-minute access JWT and an opaque rotating refresh credential valid for seven days. Tokens are never returned in JSON and must never be stored in `localStorage` or `sessionStorage`.

Cookies use `SameSite=Lax`, explicit paths, and `Secure` when `NODE_ENV=production`. State-changing authenticated requests require an `Origin` that exactly matches the request origin or `AUTH_ALLOWED_ORIGINS`. Credentialed CORS never uses a wildcard. Public route-category CORS is separate, never enables credentials, and is limited to `GET`, `HEAD`, and their preflight requests; future public mutations require an explicit security review and policy change.

The supported roles are exactly `ADMIN` and `SUPER_ADMIN`; both can manage Task #3 content. The accepted V1 limitation is that an already signed access token may remain usable for up to its 15-minute expiry after session revocation or account deactivation. Login and refresh reject inactive accounts.

Cross-site Vercel Preview domains may not receive `SameSite=Lax` cookies consistently. Use appropriately related production/custom domains rather than weakening cookie security. A separate Next.js host or middleware cannot read host-only cookies owned by the API host.

## Initial SUPER_ADMIN

The bootstrap variables are optional during normal runtime. On an empty database, and only with explicit authorization, configure all three bootstrap variables and run:

```powershell
npm run auth:bootstrap
```

The command refuses to run when an administrator already exists, creates no default account, and does not print credentials or hashes. Remove bootstrap values from the environment afterward.

## Initial Admin accounts and content

Task #4 adds a separate idempotent provisioning path for the permanent `ADMIN` and `SUPER_ADMIN`. Put the six `INITIAL_*` values in the Git-ignored `.env` file, inspect first, then run the explicit commands:

```powershell
npm run seed:inspect
npm run admins:provision
npm run content:seed
npm run seed:inspect
```

Provisioning refuses conflicting role, active-state, name, or password data and refuses unrelated administrator records; it never resets or overwrites an account. Content seeding uses deterministic slugs, validates through the existing Zod schemas and content service, preserves exact matches, and stops on a conflicting record instead of updating it. Repeating either command performs no write for matching records.

Initial-account passwords use a provisioning-only policy: 9–128 characters with at least one lowercase and one uppercase English letter. Numbers and special characters are optional. The shared Authentication API and one-time bootstrap password policy remain unchanged.

The initial public dataset contains three published destinations, six published universities verified from their official sites, and three officially sourced 2026 scholarship calls published with `CLOSED` application state. Proposed consulting services and editorial articles remain `DRAFT` until Tareeq Academy approves their business and editorial content. The article samples retain the flat structured-block contract.

Every successful provisioning or seed result is recorded in the Git-ignored `reports/initial-seed-manifest.json`, including its UUID, outcome, publication state, relationships, and relevant official source. The manifest is permanent verification evidence; the seed command does not clean up these records.

The deployed acceptance verifier remains read-only by default and consumes the manifest when present:

```powershell
pwsh -File scripts/verify-backend.ps1
pwsh -File scripts/verify-backend.ps1 -Authenticated
npm run verify:browser-auth
```

The verifier defaults to `https://tareeq-academy.com` for `-PublicOrigin` and `https://admin.tareeq-academy.com` for `-AdminOrigin`. It verifies public non-credentialed reads separately from credentialed Admin CORS and CSRF rejection. Override these exact origins when checking an approved local or preview topology.

`-Authenticated` reads only the four required email/password values from the current environment or local `.env`, uses isolated in-memory cookie jars for each role, and performs the authorized login/refresh/Admin-read/logout workflows. It also verifies that the public-only origin cannot make credentialed state-changing requests. It changes only authentication session records and never writes content or account data. Missing credentials are reported as `BLOCKED — MISSING_PREREQUISITE`; secrets, cookies, identities, and raw response bodies are excluded from reports.

`npm run verify:browser-auth` is a separate real-browser check for local same-site cookie persistence. It launches installed Google Chrome through Playwright, serves a temporary frontend at `http://localhost:3001`, starts the local Backend at `http://localhost:3002`, and verifies browser-managed login, reload persistence, refresh, Admin reads, logout, and cookie invalidation for both roles. Playwright may be installed as a development dependency or supplied through `PLAYWRIGHT_MODULE_PATH`; it is not a production dependency. The sanitized `reports/backend-browser-auth.{json,md}` results are incorporated into subsequent PowerShell acceptance reports so HTTP cookie-jar and browser persistence outcomes remain distinct. This harness proves cookie-policy compatibility, not full Admin Dashboard integration.

## Content behavior

All public content routes use `/api/v1`, default to `page=1&limit=12`, cap `limit` at 50, and return only `PUBLISHED` records. Admin routes use `/api/v1/admin/{resource}` and support GET, POST, and PATCH for `countries`, `universities`, `scholarships`, `services`, and `articles`. There are no DELETE operations.

Arabic fields are required; English content is optional. Previously published slugs are immutable, and `publishedAt` records the first publication time. A scholarship may remain public while applications are closed; a passed `verifiedDeadline` produces an effective `CLOSED` status without archiving it.

Article bodies are validated arrays of plain-text blocks, not HTML and not native TipTap JSON. See the Frontend guide for the exact format and required TipTap adapter.

## Troubleshooting

- **Missing environment variables:** compare `.env` with `.env.example`. Authentication/database-backed routes require `DATABASE_URL`, `JWT_SECRET`, and `AUTH_ALLOWED_ORIGINS`.
- **Invalid Neon connection:** confirm the pooled URL is in `DATABASE_URL`, the direct URL is in `DIRECT_DATABASE_URL`, both name the intended database, and SSL parameters are present. Do not print either value in logs or support requests.
- **Prisma Client missing:** run `npm run prisma:generate`. Generated files live under ignored `src/generated/prisma/`.
- **Prisma configuration not detected:** run the npm scripts from the repository root and confirm `prisma7.config.ts` exists.
- **Pending migrations:** run `npm run prisma:migrate:status`. Apply with `npm run prisma:migrate:deploy` only after reviewing SQL and receiving authorization.
- **Invalid JWT configuration:** `JWT_SECRET` must be at least 32 characters and identical for every instance serving the same environment.
- **CORS or CSRF rejection:** add Admin origins only to `AUTH_ALLOWED_ORIGINS`; add student/frontend origins that need public reads to `PUBLIC_ALLOWED_ORIGINS`. Send browser credentials only for cookie-authenticated requests, and include the browser-generated `Origin` on POST/PATCH.
- **Authentication cookies absent:** verify HTTPS and `NODE_ENV=production` in production, exact API/Frontend domain relationships, and browser cookie restrictions. Cross-site preview domains are not a reliable final cookie topology.
- **Bootstrap variables missing:** they are required only for the explicitly invoked one-time bootstrap command, not normal startup.

Unexpected responses include `X-Request-Id`. Provide that value when reporting a server failure; the API never returns stack traces or SQL details.

## Deployment ownership and current limitations

`src/index.ts` is the Vercel Hono entrypoint and `src/server.ts` is the standalone local Node entrypoint. The Project Owner manages deployment and all Neon/Vercel console operations.

Email, uploads/media storage, analytics, audit logs, scheduled jobs, student accounts, payments, and Admin account management are outside Task #3. Content images are URL references only.

