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

Provider verification is intentionally separate from normal tests and deployment. Use `npm run integrations:preflight` for a read-only configuration, scheduler, Admin-recipient, and actionable-outbox gate, then follow [Cloudinary and Resend live integration verification](docs/live-integration-verification.md). The preflight never calls Cloudinary or Resend and never changes database records.

Production verification has two report-producing runners. `npm run verify:production:readonly` invokes the existing safe acceptance verifier and read-only Neon/provider checks, then writes timestamped sanitized JSON and Markdown reports to `reports/production-verification/`. `npm run verify:production:live` is a non-mutating live-test plan by default. It does not send mail, create submissions, upload assets, authenticate, or dispatch anything; it reports the independent owner gates required before a later controlled scenario can be authorized. Reports are Git-ignored.

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
| `PUBLIC_ALLOWED_ORIGINS` | Optional; needed for Public Website browser access | Comma-separated exact origins for non-credentialed public content reads and the approved application/inquiry submissions |
| `RESEND_API_KEY` | Email delivery only | Server-only Resend API key; never expose to Frontend code |
| `RESEND_FROM_EMAIL` | Email delivery only | Sender address configured and verified by the Project Owner |
| `RESEND_REPLY_TO_EMAIL` | Optional | Reply-to address for transactional notifications |
| `CRON_SECRET` | Scheduled email retries only | Server-only random secret shared with the protected GitHub Actions scheduler; never expose it to Frontend code |
| `CLOUDINARY_CLOUD_NAME` | Admin image uploads only | Server-only Cloudinary product-environment name |
| `CLOUDINARY_API_KEY` | Admin image uploads only | Server-only Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Admin image uploads only | Server-only Cloudinary API secret; never expose to Frontend code |
| `CLOUDINARY_FOLDER` | Optional; default `tareeq-academy` | Safe public-ID prefix for uploaded content images |

Production uses:

```dotenv
AUTH_ALLOWED_ORIGINS=https://admin.tareeq-academy.com
PUBLIC_ALLOWED_ORIGINS=https://tareeq-academy.com
```

Origins must contain only scheme, host, and optional port—no path, query, or fragment. Never use `*` for credentialed requests. Public content CORS remains read-only; only the separately reviewed application and inquiry routes allow non-credentialed `POST`. Public CORS does not grant Admin access or CSRF trust. Server-to-server calls are not restricted by browser CORS.

Bootstrap and `INITIAL_*` variables are documented in `.env.example` beside sanitized placeholders. Keep real values only in `.env`.

## Commands

```powershell
npm run dev                    # Watch local server
npm run typecheck              # Strict TypeScript check
npm run lint                   # ESLint
npm run build                  # Production compilation
npm start                      # Run compiled local server
npm test                       # Safe default Vitest suite
npm run test:api               # Isolated health/auth/content/submission/media/audit/settings/analytics/FAQ/directory regression
npm run postman:generate       # Regenerate Postman artifacts from OpenAPI
npm run postman:check          # Verify all 87 Collection operations
npm run verify:production:readonly # Timestamped safe production/API/Neon readiness report
npm run verify:production:live # Non-mutating controlled-live-test plan and safety-gate report
npm run notifications:dispatch # Safely retry pending email outbox records
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

State-changing Authentication/Admin requests require an exact trusted `Origin`. Both `ADMIN` and `SUPER_ADMIN` can manage the five content resources, their FAQs, and review applications/inquiries. Only `SUPER_ADMIN` can read the administrator audit trail, manage existing Admin roles/activation, and update public site settings. Protected requests verify that the account remains active and use its current database role, so deactivation and role changes take effect for already-issued access cookies. Public application and inquiry submissions use a separate non-credentialed CORS policy, explicit consent, a honeypot, bounded inputs, and a PostgreSQL-backed rate limit.

## Content image uploads

`POST /api/v1/admin/uploads/images` accepts one authenticated Admin multipart upload for a Country, University, Scholarship, Service, Article, or About Us page. The required `resource` field is one of `countries`, `universities`, `scholarships`, `services`, `articles`, or `about`; the required `file` field must be a complete JPEG, PNG, or WebP image no larger than 4,000,000 bytes. The entire multipart request body is capped at 4,100,000 bytes, leaving room for form headers while remaining below Vercel Functions' 4.5 MB payload limit. SVG, GIF, animation, mismatched MIME declarations, malformed containers, and images exceeding the documented dimension limits are rejected before Cloudinary is called.

## About Us page

`GET /api/v1/about` returns the singleton page only when it is PUBLISHED; a missing, DRAFT, or ARCHIVED singleton responds with `404 CONTENT_NOT_FOUND`. Its public response includes `publishedAt` and `updatedAt`, while the Admin-only `status` and `createdAt` fields remain private. ADMIN and SUPER_ADMIN use `GET` and `PATCH /api/v1/admin/about`. The first PATCH creates the singleton and later PATCH requests merge only supplied fields. Publishing requires non-empty Arabic Hero title/subtitle and Introduction title/body; the original `publishedAt` is retained through future edits and unpublishing. Updates create an atomic `ABOUT_US` audit event. Hero and Introduction image URLs may be supplied from the existing `resource=about` upload flow; no image is required to publish. These locally implemented endpoints require owner review, migration deployment, and Backend deployment before Frontend production use.

## Directory presentation and marketing images

Countries may carry a nullable, unique assigned ISO 3166-1 alpha-2 `countryCode`; inputs normalize to uppercase and no existing Country is backfilled. Universities independently support nullable `logoUrl`, `logoAltAr`, and `logoAltEn` alongside their existing cover image fields. Public University, Scholarship, and Article responses retain concise real relationship summaries, including a related Country’s `id`, `slug`, `nameAr`, and nullable `countryCode`.

`GET /api/v1/marketing/pages/{pageKey}/images` returns optional `HOME` or `DESTINATIONS` Hero/CTA image fields. A missing configuration is a successful all-null response so the Frontend keeps its static fallback. ADMIN and SUPER_ADMIN use the matching Admin GET/PATCH route; null explicitly clears a field. Upload through the existing image endpoint with `resource=marketing`, then save the returned HTTPS URL. No Cloudinary deletion occurs.

The Backend generates a unique Cloudinary public ID under `CLOUDINARY_FOLDER`, performs a signed server-side image upload with an explicit format allowlist, and returns only safe asset metadata including `assetId`, `publicId`, and `secureUrl`. Use `secureUrl` in the existing `imageUrl` or `coverImageUrl` content field. Uploading does not create or update a content record, and this task does not provide deletion or a media library. Missing or invalid Cloudinary configuration fails closed with HTTP `503`; provider failures return a sanitized HTTP `502` response.

## Admin activity audit logs

Successful Admin content creation and updates, publication transitions, and application/inquiry workflow updates create an `AdminAuditLog` row in the same Prisma transaction as the business mutation. If the audit insert fails, the business mutation rolls back. Events contain the actor Admin UUID, structured action, resource type and UUID, timestamp, and bounded metadata containing only status transitions, changed field names, and note-change flags. Request bodies, content values, student messages, internal-note text, contact details, passwords, tokens, cookies, and credentials are never copied into audit metadata.

`GET /api/v1/admin/audit-logs` is read-only and restricted to `SUPER_ADMIN`. It supports `page`, `limit` (maximum 100), `actorId`, exact `action`, `resourceType`, and inclusive `from`/`to` ISO timestamp filters. Results sort deterministically by `createdAt DESC, id DESC`. No audit update or deletion API exists. The additive migration `20261031120000_create_admin_audit_log` must be reviewed and applied by the Project Owner before database-backed audit writes or reads can run.

## Admin account management

`GET /api/v1/admin/users` and `PATCH /api/v1/admin/users/{id}` are restricted to `SUPER_ADMIN`. Listing returns only `id`, `name`, `email`, `role`, and `isActive`. Updates accept exactly one field: `role` (`ADMIN` or `SUPER_ADMIN`) or `isActive`. There is no public registration, Admin creation, deletion, password reset, or credential-management API.

Account mutations are serialized and recheck the acting account inside the transaction. Self-deactivation, self-demotion, and any transition that would remove the last active SUPER_ADMIN are rejected. Deactivation revokes every active refresh session. Because protected requests resolve current activation and role from PostgreSQL, an existing access cookie is rejected immediately after deactivation and uses the new role immediately after a role change. Each successful mutation and its audit event commit atomically.

## Public site settings

`GET /api/v1/site-settings` publicly returns the allowlisted Academy name, contact email/phone, address, and Facebook, Instagram, LinkedIn, and YouTube links. Before initialization, all fields and `updatedAt` return `null`. `PATCH /api/v1/admin/site-settings` is restricted to `SUPER_ADMIN`, accepts only documented fields, validates contact values and HTTPS social domains, and uses `null` to clear a field. Arbitrary keys, environment variables, API keys, credentials, and infrastructure configuration are rejected.

`SiteSettings` uses the fixed UUID `00000000-0000-4000-8000-000000000009`; the database check constraint and atomic upsert enforce a single row under concurrent updates. Settings updates and their safe `site_settings.updated` audit event commit together. The Task #9 migration `20261101000000_add_admin_management_site_settings` depends on the pending Task #8 audit migration and must remain after it in deployment order.

## Visitor analytics and student journeys

`POST /api/v1/analytics/events` accepts one anonymous, idempotent event no larger than 8 KiB. The allowlist contains page views, CTA clicks, four basic engagement milestones, and client-reported application/inquiry submissions. Random UUIDs identify the anonymous visitor, session, and event. Paths cannot contain query strings or fragments; referrers are split into hostname and safe path; UTM values use a small character and length allowlist. The Backend HMAC-hashes the request address only for a five-minute abuse-control bucket and never stores the raw address or hash with an analytics event.

The Public Website is responsible for applying its consent policy before emitting events. It must never send names, emails, phone numbers, form values, student messages, full URLs, arbitrary metadata, or identifiers derived through fingerprinting. Duplicate `eventId` values are acknowledged without creating another event.

`GET /api/v1/admin/analytics/summary` and `GET /api/v1/admin/analytics/journeys` are restricted to SUPER_ADMIN. Summary reports use indexed, UTC, maximum-366-day ranges and include traffic totals, top pages, acquisition sources, CTA engagement, event-stage funnels, and daily/weekly/monthly trends. Browser-reported conversions are deduplicated by anonymous session and remain explicitly separate from server-verified `StudentApplication` and `GeneralInquiry` counts. Journey pages contain at most 100 allowlisted steps per session and no personal information.

The additive migration `20261102000000_create_visitor_analytics` creates the analytics enums, constrained event table, and reporting indexes. It must follow the pending Task #7–#9 migrations. A practical production retention target is 13 months; cleanup should later be implemented as an owner-approved, bounded scheduled deletion using `occurredAt`, not as request-time work.

## Reusable FAQ management

The public API exposes published Homepage FAQs at `GET /api/v1/faqs?scope=GLOBAL` and parent-scoped FAQs at `GET /api/v1/{countries|universities|services|scholarships}/{slug}/faqs`. Parent-scoped reads require a published parent. Collections sort by `displayOrder`, then UUID, default to five entries, and support `page`/`limit` so the Public Website can show five initially and load the remainder. Draft and archived entries are never public.

`ADMIN` and `SUPER_ADMIN` use `GET`/`POST /api/v1/admin/faqs`, `PATCH`/`DELETE /api/v1/admin/faqs/{id}`, and `PATCH /api/v1/admin/faqs/order`. PATCH can atomically relink an FAQ by supplying both `scope` and `parentId`; old-group order is compacted and the FAQ appends to the new group. Arabic question/answer fields are required; English fields are optional but must be provided or cleared together. Only DRAFT and ARCHIVED FAQs can be deleted; PUBLISHED FAQs must be archived first. Reorder requests are atomic and must submit every non-archived UUID for exactly one parent.

FAQ creates, edits, publication changes, archival, and changed order positions write safe `FAQ_ENTRY` audit events atomically with the mutation. Audit metadata contains identifiers, status transitions, changed field names, and order positions—not question/answer text. The additive migration `20261102010000_create_faq_entries` adds the enum, table, relationship/check constraints, indexes, and audit resource type. It must remain after the pending Task #10 migration and requires Project Owner review before deployment.

## University programs and directory filters

`GET /api/v1/universities` preserves its existing behavior when no new filters are supplied. It additionally accepts `major`, `studyLevel`, `language`, `city`, and `universityType`. Major, study level, and teaching language are evaluated against one published `UniversityProgram`, preventing attributes from different programs from producing a false match. Universities without program data remain visible until a P1 program filter is active. Existing `cityAr`/`cityEn` values remain unchanged; normalized `cityId` and `universityType` are nullable and never inferred.

Published program details are available at `GET /api/v1/universities/{slug}/programs`. Dynamic counts come from `GET /api/v1/universities/filter-options`: every option counts distinct published Universities, respects the other active filters, excludes its own current facet, and omits unsupported values. Controlled study levels are `FOUNDATION`, `DIPLOMA`, `BACHELORS`, `MASTERS`, and `PHD`. Teaching languages are a reviewed enum and can be extended only through a future additive migration.

ADMIN and SUPER_ADMIN manage programs through `GET`/`POST /api/v1/admin/universities/{universityId}/programs` and `PATCH /api/v1/admin/university-programs/{id}`. Academic Major and City catalogs support list/create/update/delete through `/api/v1/admin/academic-majors` and `/api/v1/admin/cities`; deletes reject linked records and catalog names are normalized unique. Publishing requires a controlled major and study level, at least one teaching language, an HTTPS official source URL, and a non-future verification time. Program and catalog mutations write safe audit events atomically. No program DELETE API exists; use `ARCHIVED`.

The additive migration `20261102120000_add_university_programs_and_filters` follows the FAQ migration. It creates normalized catalog/program/language tables, nullable University fields, constraints, foreign keys, and filtering indexes without backfilling or guessing existing data. P3 tuition range, currencies, conversion, and estimation remain explicitly deferred.

`GET /api/v1/scholarships` also accepts `universitySearch`, `universityCountry`, `universityMajor`, `universityStudyLevel`, `universityLanguage`, `universityCity`, `universityType`, and `universityFeatured`. Supplying any of these requires a related PUBLISHED University and evaluates the complete University result set independently of University pagination. Major, controlled Program study level, and teaching language must match one PUBLISHED Program. Existing `university`, `country`, `studyLevel`, and other Scholarship filters retain their original meanings and combine with University filters using AND semantics. Results remain distinct PUBLISHED Scholarships with the existing pagination, sorting, and effective OPEN/CLOSED behavior. No additional database migration is required.

## University details tabs

`GET /api/v1/universities/{slug}/programs` now supports `search`, `studyLevel`, `language`, `faculty`, `page`, and `limit`. Program titles are distinct from the Academic Major taxonomy and may include localized faculty plus paired duration `value`/`unit` fields. Tuition is returned as the latest `tuition` schedule or `null`, while `tuitionFees` preserves every explicitly entered academic year. Amounts are decimal strings, zero is valid only when entered, and no currency or billing period is inferred. Tuition range filtering and exchange-rate conversion remain deferred.

The remaining public tabs use `GET /api/v1/universities/{slug}/admission-requirements` and `GET /api/v1/universities/{slug}/gallery`. Admission data is split into `university`, `studyLevels`, and `programs` arrays so general information is never misrepresented as program-specific. Gallery entries are separate ordered associations; upload first through the existing Cloudinary endpoint, then attach its `secureUrl` through the Admin gallery API. Detaching an association never deletes a Cloudinary asset or the existing University cover image.

`ADMIN` and `SUPER_ADMIN` manage scoped requirements through `/api/v1/admin/universities/{universityId}/admission-requirements` and `/api/v1/admin/university-admission-requirements/{id}`. Gallery list/attach/reorder operations are under `/api/v1/admin/universities/{universityId}/gallery`; update/detach uses `/api/v1/admin/university-gallery/{id}`. All successful mutations are audited atomically with safe metadata.

The additive migration `20261102130000_complete_university_details` follows the University Directory migration. It adds nullable localized program metadata, normalized academic-year tuition schedules, scoped admission requirements, ordered gallery associations, indexes, constraints, and audit classifications. It performs no backfill and must be owner-reviewed before deployment.

## Article related Scholarships

Admin Article create and update requests accept an ordered `scholarshipIds` UUID array with at most 50 unique entries. Every ID must reference an existing Scholarship. On update, omitting both association fields preserves the current links; `scholarshipIds` replaces the complete ordered set and `[]` clears it. The legacy nullable `scholarshipId` remains supported: when supplied alone it maps to zero or one association. When both fields are supplied, `scholarshipId` must equal the first `scholarshipIds` entry, while `null` requires an empty array. Stored legacy `scholarshipId` always mirrors the first selected ID so older clients keep a consistent value.

`GET /api/v1/articles/{slug}` returns `relatedScholarships` in Admin-selected order. Only PUBLISHED Scholarships appear publicly; a published Scholarship whose effective application status is `CLOSED` remains visible and is marked accordingly. Each card contains `id`, `slug`, `titleAr`, nullable `imageUrl`, nullable Country summary, and `effectiveApplicationStatus`. Article list responses are unchanged.

The additive migration `20261102140000_add_article_scholarships` creates the ordered join table without removing the legacy column. It safely backfills each existing non-null `Article.scholarshipId` at position zero with conflict protection and must be owner-reviewed and applied only after the preceding pending migrations.

Successful application and inquiry responses confirm database persistence, not email delivery. The same transaction stores notification intents for the student and currently active ADMIN/SUPER_ADMIN recipients. A best-effort dispatch is awaited after the commit; missing configuration, a terminated request, or provider failure leaves bounded, idempotent retry state in PostgreSQL. Retries use stable Resend idempotency keys, at most four attempts, short exponential delays, a two-minute claim lease, and a 23-hour retry window that stays inside Resend's documented 24-hour provider retention.

The reusable `npm run notifications:dispatch` worker processes up to 25 pending records for an authorized operator. The protected `GET /internal/cron/email-notifications` route rejects requests unless `Authorization: Bearer <CRON_SECRET>` exactly matches the server-only Backend environment variable. The route is intentionally absent from OpenAPI and Postman because it is an internal operational endpoint. The worker and route return aggregate counts only and never print message bodies, recipients, or credentials.

### Disabled GitHub Actions email scheduler

`.github/workflows/email-notifications.yml` prepares GitHub Actions as the future scheduler without activating scheduled execution. It currently exposes only `workflow_dispatch`; the intended `*/10 * * * *` UTC schedule is retained as commented YAML. Ten minutes is longer than the two-minute claim lease and provides regular opportunities for the existing 1-, 5-, and 15-minute bounded retry delays, but GitHub Actions schedules are best-effort and may be queued or delayed. Exact dispatch or retry times are not guaranteed.

Every trigger is also protected by the repository variable `EMAIL_DISPATCH_ENABLED`. Unless its value is exactly `true`, the dispatch job is skipped and the workflow does not read the secret or contact the Backend. The dispatch job has no repository permissions, uses a non-overlapping concurrency group, and calls only the HTTPS production endpoint with bounded connection, request, retry, and job timeouts. It records the HTTP status only; it never prints the authorization header, secret, or response body. Network errors, timeouts, missing secrets, and non-2xx responses fail the run safely.

After the database migrations and Backend deployment are verified, the Project Owner can activate the scheduler in this order:

1. Confirm the deployed endpoint rejects an unauthenticated request with `401 EMAIL_DISPATCH_UNAUTHORIZED` without invoking dispatch.
2. Add a GitHub Actions repository secret named `CRON_SECRET` whose value exactly matches the Production Backend `CRON_SECRET`. Never use a public variable for this value.
3. Add the repository variable `EMAIL_DISPATCH_ENABLED` with the exact value `true`.
4. Manually run **Email notification dispatch** and confirm a successful 2xx workflow result and expected aggregate/outbox behavior. The workflow intentionally does not log the response body.
5. Uncomment the `schedule` block in the workflow through a separately reviewed commit. Scheduled workflows run from the default branch and can be delayed by GitHub Actions capacity.

To disable dispatch immediately, delete `EMAIL_DISPATCH_ENABLED` or change it to any value other than exact lowercase `true`. Removing the `CRON_SECRET` secret also fails enabled runs closed, but the opt-in variable is the primary kill switch. The scheduler does not contain a second queue or mutate notification records directly; the Backend dispatcher remains the sole processing authority.

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

Temporary comprehensive test fixtures use a separate, reversible, disabled-by-default workflow. Start with `npm run seed:demo:preflight` and `npm run seed:demo:dry-run`; neither command writes data. Seed and cleanup require explicit target identity, environment opt-ins, confirmation tokens, and exact ignored batch manifests. See [Reversible demo database seed](docs/demo-seed.md) before any future execution. Demo seeding is never run by install, build, tests, development startup, or deployment.

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

The local generated API contains exactly 128 operations. Phase B adds SUPER_ADMIN-only challenge-confirmed hard deletion for Countries, Universities, Scholarships, Services, and Articles, with explicit approved editorial child deletion/unlinking and protected history blockers. Admin account creation/deletion, password recovery, Cloudinary asset deletion, a standalone media library, public analytics reporting, tuition-range filtering, exchange-rate conversion, scheduled-job management, student accounts, and payments are not available endpoints.
