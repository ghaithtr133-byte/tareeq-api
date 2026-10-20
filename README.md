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
| `BOOTSTRAP_SUPER_ADMIN_NAME` | Bootstrap only | `npm run auth:bootstrap` | Non-empty name, maximum 120 characters |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | Bootstrap only | `npm run auth:bootstrap` | Valid administrator email |
| `BOOTSTRAP_SUPER_ADMIN_PASSWORD` | Bootstrap only | `npm run auth:bootstrap` | 12–128 characters with lowercase, uppercase, and numeric characters |

`DATABASE_URL` is used by the running application through `src/database/client.ts`. `DIRECT_DATABASE_URL` is preferred by `prisma7.config.ts` for Prisma migrations; the configuration technically falls back to `DATABASE_URL`, but the approved Neon workflow uses the direct URL.

`AUTH_ALLOWED_ORIGINS` values must be exact origins such as `http://localhost:3001` or `https://admin.example.com`. Do not include paths and do not use `*` with credentialed requests.

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

Cookies use `SameSite=Lax`, explicit paths, and `Secure` when `NODE_ENV=production`. State-changing authenticated requests require an `Origin` that exactly matches the request origin or `AUTH_ALLOWED_ORIGINS`. Credentialed CORS never uses a wildcard.

The supported roles are exactly `ADMIN` and `SUPER_ADMIN`; both can manage Task #3 content. The accepted V1 limitation is that an already signed access token may remain usable for up to its 15-minute expiry after session revocation or account deactivation. Login and refresh reject inactive accounts.

Cross-site Vercel Preview domains may not receive `SameSite=Lax` cookies consistently. Use appropriately related production/custom domains rather than weakening cookie security. A separate Next.js host or middleware cannot read host-only cookies owned by the API host.

## Initial SUPER_ADMIN

The bootstrap variables are optional during normal runtime. On an empty database, and only with explicit authorization, configure all three bootstrap variables and run:

```powershell
npm run auth:bootstrap
```

The command refuses to run when an administrator already exists, creates no default account, and does not print credentials or hashes. Remove bootstrap values from the environment afterward.

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
- **CORS or CSRF rejection:** add the exact Frontend origin to `AUTH_ALLOWED_ORIGINS`, send browser credentials for cookie-authenticated requests, and include the browser-generated `Origin` on POST/PATCH.
- **Authentication cookies absent:** verify HTTPS and `NODE_ENV=production` in production, exact API/Frontend domain relationships, and browser cookie restrictions. Cross-site preview domains are not a reliable final cookie topology.
- **Bootstrap variables missing:** they are required only for the explicitly invoked one-time bootstrap command, not normal startup.

Unexpected responses include `X-Request-Id`. Provide that value when reporting a server failure; the API never returns stack traces or SQL details.

## Deployment ownership and current limitations

`src/index.ts` is the Vercel Hono entrypoint and `src/server.ts` is the standalone local Node entrypoint. The Project Owner manages deployment and all Neon/Vercel console operations.

Email, uploads/media storage, analytics, audit logs, scheduled jobs, student accounts, payments, and Admin account management are outside Task #3. Content images are URL references only.

##
