# Tareeq Academy Backend

Standalone backend API for Tareeq Academy, an educational consulting platform. The current implementation provides the API foundation, PostgreSQL authentication schema, and administrative authentication/authorization. Business modules are added only through separately approved tasks.

## Technology stack

- Node.js 24
- TypeScript in strict mode
- Hono
- Zod and `@hono/zod-openapi`
- Scalar API Reference
- Prisma ORM and Neon PostgreSQL
- Vercel Functions

Resend and Cloudinary remain deferred to future approved work.

## Prerequisites

- Node.js 24.x
- npm 11.x

## Local setup

```sh
npm install
copy .env.example .env
npm run dev
```

On macOS or Linux, use `cp .env.example .env`. Configure:

- `PORT`: local Node.js server port; defaults to `3000`.
- `NODE_ENV`: `development`, `test`, or `production`; production enables Secure cookies.
- `DATABASE_URL`: pooled Neon PostgreSQL URL used by the running API.
- `DIRECT_DATABASE_URL`: direct development database URL used by Prisma migrations.
- `JWT_SECRET`: cryptographically random JWT signing secret of at least 32 characters.
- `AUTH_ALLOWED_ORIGINS`: comma-separated exact Frontend origins allowed to send credentialed requests.
- `BOOTSTRAP_SUPER_ADMIN_NAME`, `BOOTSTRAP_SUPER_ADMIN_EMAIL`, and `BOOTSTRAP_SUPER_ADMIN_PASSWORD`: used only by the explicitly invoked initial bootstrap script.

Development and production databases must be separate. Never place actual secrets or connection strings in committed files.

## Commands

```sh
npm run dev        # Start the local server with file watching
npm run typecheck  # Check TypeScript types
npm run lint       # Run ESLint
npm test           # Run focused automated tests
npm run build      # Compile production output to dist/
npm start          # Run the compiled local Node.js entrypoint
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:dev -- --name <migration-name>
npm run prisma:migrate:deploy
```

Use `prisma:migrate:dev` only against an isolated development database. Review generated SQL before applying it. Use `prisma:migrate:deploy` in an approved deployment workflow; do not use `prisma db push` as a replacement for migration history.

The initial migration enables PostgreSQL `citext` and `pgcrypto`, then creates:

- `AdminUser`: UUID identity, case-insensitive unique email, Argon2id password hash, `ADMIN`/`SUPER_ADMIN` role, active state, and UTC-compatible timestamps.
- `RefreshSession`: UUID identity, owning administrator, unique refresh-token hash, expiry/revocation/use timestamps, and cascading deletion with its administrator.

Only hashed refresh credentials are persisted.

## API and documentation

With the local server running:

- `GET http://localhost:3000/api/v1/health` — unauthenticated process health check.
- `GET http://localhost:3000/openapi.json` — generated OpenAPI 3.1 document.
- `GET http://localhost:3000/docs` — interactive Scalar API reference.
- `POST http://localhost:3000/api/v1/auth/login` — validate credentials and set access/refresh cookies.
- `POST http://localhost:3000/api/v1/auth/refresh` — rotate the refresh session and both cookies.
- `POST http://localhost:3000/api/v1/auth/logout` — revoke the current refresh session and clear cookies.
- `GET http://localhost:3000/api/v1/auth/me` — return the authenticated administrator.
- `POST http://localhost:3000/api/v1/auth/change-password` — change the password, revoke refresh sessions, and require a fresh login.

API endpoints return a consistent envelope. Successful responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`.

## Authentication and authorization

Passwords use Argon2id. The access credential is a signed HS256 JWT containing the administrator ID and role and expires after 15 minutes. The refresh credential is an opaque random value valid for seven days; only its SHA-256 hash is stored. Every successful refresh atomically consumes the existing session and creates its replacement, preventing reuse and concurrent double rotation.

Both credentials are sent only through host-only, HttpOnly cookies. Cookies use `SameSite=Lax`, exact paths, explicit expirations, and `Secure` in production. Authenticated state-changing requests require an approved or same-origin `Origin`. Authentication CORS uses an explicit allowlist with credentials and never uses a wildcard.

Available roles are exactly `ADMIN` and `SUPER_ADMIN`. Reusable middleware supports authenticated routes, either administrative role, and `SUPER_ADMIN`-only routes. Normal role checks use verified JWT claims without a database lookup.

The approved V1 limitation is that a signed access token can remain usable until its 15-minute expiration after session revocation or account deactivation. Refresh and login reject inactive accounts; no token blacklist or Redis layer is used.

Vercel preview domains that are cross-site may not support the final `SameSite=Lax` cookie flow. Production cookie security must not be weakened to accommodate previews.

## Initial SUPER_ADMIN

After applying migrations to an empty, isolated database, set the three `BOOTSTRAP_SUPER_ADMIN_*` values and run:

```sh
npm run auth:bootstrap
```

The command is never run by application startup or deployment. It refuses to create an account if any administrator already exists, never prints credentials or hashes, and creates no default account. Remove the bootstrap credential values from the environment after successful provisioning.

## Vercel preparation

`src/index.ts` exports the Hono application as the default export, which is the entrypoint expected by Hono's current zero-configuration Vercel integration. The local Node.js server lives separately in `src/server.ts`, so it is not required by the Vercel runtime. Set the project runtime to Node.js 24 in Vercel and deploy the repository root. No `vercel.json` is currently necessary.

An actual production deployment is not part of this initialization task and has not been performed.

## Current limitations

- No business-domain endpoints.
- No email, file upload, analytics, audit, or scheduled-job integrations.
- The health check reports process availability only and intentionally has no dependency checks.
- No production deployment has been performed.
- Database migration execution and live integration require approved Neon development credentials.

#
