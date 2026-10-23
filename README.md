# Tareeq Academy Backend

Node.js 24, Hono, TypeScript, Prisma, and PostgreSQL API for Tareeq Academy. It exposes public educational content and cookie-authenticated content management for `ADMIN` and `SUPER_ADMIN` users.

## Frontend onboarding

Production:

- API: `https://api.tareeq-academy.com`
- Public Website: `https://tareeq-academy.com`
- Admin Dashboard: `https://admin.tareeq-academy.com`
- OpenAPI 3.1: `https://api.tareeq-academy.com/openapi.json`
- Scalar: `https://api.tareeq-academy.com/docs`

Frontend developers should start with [docs/frontend-integration.md](docs/frontend-integration.md). It contains the API base URL, Axios setup, cookie authentication, role matrix, practical requests, and localhost limitations. Detailed fields and examples belong in Scalar rather than this README.

Never provide Frontend applications with database URLs, JWT secrets, administrator credentials, or other Backend-only configuration.

## Local Backend setup

Prerequisites: Node.js `24.x`, npm `11.6.2`, and access to the approved PostgreSQL database.

```powershell
npm install
Copy-Item .env.example .env
npm run prisma:generate
npm run dev
```

On macOS or Linux, use `cp .env.example .env`. Fill in the Git-ignored `.env` before starting database-backed or authenticated routes.

The local server defaults to `http://localhost:3000`:

- `/api/v1/health` — process health; it does not query PostgreSQL.
- `/openapi.json` — generated OpenAPI 3.1 contract.
- `/docs` — Scalar API reference.

## Backend environment

| Variable | Requirement | Behavior |
| --- | --- | --- |
| `PORT` | Optional; default `3000` | Local server port, integer 1–65535 |
| `NODE_ENV` | Optional; default `development` | `production` enables Secure cookies |
| `DATABASE_URL` | Runtime required | Backend-only pooled PostgreSQL URL |
| `DIRECT_DATABASE_URL` | Migration workflow required | Direct URL for the same database; Prisma falls back to `DATABASE_URL` |
| `JWT_SECRET` | Authentication required | Private string of at least 32 characters |
| `AUTH_ALLOWED_ORIGINS` | Authentication/Admin required | Comma-separated exact origins for credentialed CORS and CSRF trust |
| `PUBLIC_ALLOWED_ORIGINS` | Optional; needed for cross-origin public browser reads | Comma-separated exact origins for non-credentialed public `GET`/`HEAD` CORS |

Production uses:

```dotenv
AUTH_ALLOWED_ORIGINS=https://admin.tareeq-academy.com
PUBLIC_ALLOWED_ORIGINS=https://tareeq-academy.com
```

Origins must contain only scheme, host, and optional port—no path, query, or fragment. Never use `*` for credentialed requests. Public CORS does not grant Admin access or CSRF trust; future public mutations require a separate security review. Server-to-server calls are not restricted by browser CORS.

Bootstrap and `INITIAL_*` variables are documented in `.env.example` beside sanitized placeholders. Keep real values only in `.env`.

## Commands

```powershell
npm run dev                    # Watch local server
npm run typecheck              # Strict TypeScript check
npm run lint                   # ESLint
npm run build                  # Production compilation
npm start                      # Run compiled local server
npm test                       # Safe default Vitest suite
npm run test:api               # Isolated health/auth/content regression
npm run postman:generate       # Regenerate Postman artifacts from OpenAPI
npm run postman:check          # Verify all 36 Collection operations
npm run prisma:generate        # Generate Prisma Client
npm run prisma:validate        # Validate Prisma configuration/schema
npm run prisma:migrate:status  # Read-only migration status
npm run seed:inspect           # Read-only counts and seed plan
npm run admins:provision       # Explicit idempotent account provisioning
npm run content:seed           # Explicit idempotent initial content seeding
```

`prisma7.config.ts` prefers `DIRECT_DATABASE_URL` for Prisma commands. Apply reviewed migrations only with explicit authorization:

```powershell
npm run prisma:migrate:deploy
```

Never use `prisma db push` as a migration substitute.

## Database safety

Leadership approved one Neon PostgreSQL database for development and eventual production. Treat it as production-sensitive:

- Never reset it, rewrite migration history, or run broad cleanup.
- Do not use real records as test fixtures.
- Database integration tests require separate authorization, unique fixtures, and exact-ID cleanup.
- Default tests and the read-only verifier do not create content or accounts.
- Do not access Neon or Vercel management consoles through agents.

The gated suites use `RUN_DATABASE_INTEGRATION=1` and `RUN_CONTENT_DATABASE_INTEGRATION=1`; do not enable them without current authorization.

## Authentication and CORS

Authentication uses host-only HttpOnly cookies: a signed 15-minute access JWT and a rotating seven-day refresh credential. Production cookies are `Secure` and use `SameSite=Lax`. Tokens are never returned in JSON and must not be stored in browser storage.

State-changing Authentication/Admin requests require an exact trusted `Origin`. Both `ADMIN` and `SUPER_ADMIN` can manage the five content resources. No dedicated SUPER_ADMIN or Admin account-management endpoint exists.

Cross-site preview or localhost-to-production combinations cannot reliably persist `SameSite=Lax` cookies. Use shared-site production domains or a same-site localhost topology; do not weaken cookie policy or assume a Server Action forwards API-host cookies.

## Provisioning and seed data

With explicit authorization and the six `INITIAL_*` values configured locally:

```powershell
npm run seed:inspect
npm run admins:provision
npm run content:seed
npm run seed:inspect
```

Provisioning and seeding are idempotent: exact matches are preserved and conflicts stop without overwriting records. The ignored `reports/initial-seed-manifest.json` records verification identifiers.

Current public seeds contain three Countries, six Universities, and three CLOSED Scholarships. Services and Articles remain DRAFT, so their public collections can legitimately be empty.

## Verification

```powershell
pwsh -File scripts/verify-backend.ps1
pwsh -File scripts/verify-backend.ps1 -Authenticated
npm run verify:browser-auth
npm run verify:browser-auth:production
```

The PowerShell verifier is read-only by default. Authenticated mode performs the requested login/refresh/logout session lifecycle but never changes content or accounts. Reports are sanitized under ignored `reports/`.

## Troubleshooting

- **Missing configuration:** compare `.env` with `.env.example`; never print values in support output.
- **Database connection:** confirm pooled `DATABASE_URL`, direct `DIRECT_DATABASE_URL`, the intended database, and SSL parameters.
- **Prisma Client missing:** run `npm run prisma:generate` from the repository root.
- **Pending migrations:** inspect with `npm run prisma:migrate:status`; deploy only after SQL review and authorization.
- **CORS/CSRF rejection:** put Admin origins only in `AUTH_ALLOWED_ORIGINS` and public browser-read origins in `PUBLIC_ALLOWED_ORIGINS`.
- **Cookies absent:** verify HTTPS, `NODE_ENV=production`, shared-site domains, `withCredentials: true`, and the browser's cookie restrictions.
- **Unexpected 500:** record the response's `X-Request-Id`; responses never expose SQL, stack traces, or secrets.

## Deployment ownership and limits

`src/index.ts` is the Vercel Hono entrypoint and `src/server.ts` is the local Node entrypoint. The Project Owner manages Git publishing, deployment, and management consoles.

The implemented API contains exactly 36 operations: 1 Health, 5 Authentication, 10 Public Content, and 20 Admin Content. Applications, inquiries, uploads, analytics, audit logs, scheduled jobs, student accounts, payments, and Admin account management are not available endpoints.
