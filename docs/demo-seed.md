# Reversible demo database seed

This tooling prepares a focused temporary dataset for Admin Dashboard and Public Website testing. It is disabled by default, never runs from install/build/test/dev/deployment, and does not apply migrations.

## Safety model

- One database target must be confirmed as `host:port/database` through `DEMO_SEED_TARGET_ID`. Do not include a username, password, query string, or full connection URL.
- `DIRECT_DATABASE_URL` is preferred when present; otherwise `DATABASE_URL` is used.
- Every local Prisma migration must already be successfully applied. Unknown, failed, rolled-back, or pending migration rows block seeding.
- Seed writes require both `DEMO_SEED_ALLOW_WRITES=true` and `--confirm-write=TAREEQ_DEMO_SEED`.
- The default `private` profile converts every intended published fixture to `DRAFT`. Archived fixtures remain archived.
- A `published` profile additionally requires `DEMO_SEED_ALLOW_PUBLICATION=true` and `--confirm-publication=TAREEQ_DEMO_PUBLICATION`. Synthetic Scholarships, placeholder galleries, and unverifiable admissions remain non-public even in that profile.
- All writes occur in one Prisma transaction. A failure rolls back the whole batch.
- Stable fixture UUIDs and `demo-e2e-` slugs are precalculated. Existing IDs, unique-key collisions, changed fixtures, and partial batches are refused.
- Exact ownership hashes and IDs are saved under ignored `reports/demo-seed/`. A `PLANNED` manifest is written before database mutation and becomes `COMMITTED` only after commit.
- Cleanup requires the exact manifest batch UUID, revalidates every fixture, checks for non-demo dependents, and deletes exact tracked records in reverse dependency order.
- Cleanup never uses `TRUNCATE`, reset, broad `deleteMany`, slug-prefix deletion, or migration-history repair.

## Coverage and exact counts

| Model | Count | Coverage |
| --- | ---: | --- |
| Country | 3 | Finland, Estonia, Luxembourg test-labelled records |
| City | 4 | Normalized Helsinki, Tartu, Luxembourg City, Espoo fixtures |
| AcademicMajor | 3 | Computer Science, Data Science, Software Engineering |
| University | 4 | Three with programs and one without programs |
| UniversityProgram | 5 | Bachelor/Master, exact names, duration, source and verification date |
| UniversityProgramLanguage | 6 | English plus one multilingual filter case |
| UniversityProgramTuition | 3 | Annual and semester periods; two programs intentionally have no tuition row |
| UniversityAdmissionRequirement | 3 | University, study-level, and program scopes; one explicit source-null draft |
| UniversityGalleryImage | 3 | Draft-only `.invalid` placeholders; no upload or public image claim |
| Scholarship | 4 | Two sourced closed references, one synthetic OPEN draft, one archived draft fixture |
| Service | 3 | Published-profile, draft, and archived states; clearly test-labelled |
| FaqEntry | 18 | Global and all supported resource scopes; ordering, archive/draft, and more than five global entries |
| Article | 3 | Published-profile, draft, archive, optional-null and relationship cases |
| ArticleScholarship | 6 | Ordered multiple-Scholarship associations and legacy-first consistency |
| StudentApplication | 4 | Synthetic NEW/IN_REVIEW/RESOLVED/CLOSED records |
| GeneralInquiry | 4 | Synthetic NEW/IN_REVIEW/RESOLVED/CLOSED records |
| AnalyticsEvent | 12 | Two anonymous journeys, pages, engagement, CTA clicks and client conversions |
| **Total** | **88** | Focused comprehensive batch |

The following operational/security models are intentionally excluded: `AdminUser`, `RefreshSession`, `AdminAuditLog`, `SiteSettings`, `EmailNotification`, and `PublicSubmissionRateLimit`.

- Admin accounts are permanent and never created or changed.
- Audit rows are not fabricated. If later authorized Admin activity creates audit events for demo resources, those append-only rows are retained after cleanup.
- Applications and inquiries are inserted without email-notification intents. Every synthetic address uses `example.invalid`, and no dispatcher or provider is invoked.
- Site Settings are not changed, so no snapshot/restore operation is required.
- Rate-limit records and sessions are unrelated operational state and remain untouched.

## Academic data and limitations

Program names, durations, languages, tuition values, and admission summaries are limited to facts represented by the stored official source URLs and the fixture verification date. Unknown optional values remain null. The University of Helsinki Computer Science fee, University of Tartu Computer Science fee, and University of Luxembourg Computer Science semester fee are the only tuition rows.

Synthetic OPEN Scholarship and service/article content is visibly prefixed as demo data and remains draft. Gallery URLs use the reserved `example.invalid` domain and remain draft; the seed never uploads to Cloudinary. No scholarship deadline is invented.

## Migration prerequisite and preflight

The seed depends on all migrations through:

1. `20261031000000_add_scholarship_image_fields`
2. `20261031120000_create_admin_audit_log`
3. `20261101000000_add_admin_management_site_settings`
4. `20261102000000_create_visitor_analytics`
5. `20261102010000_create_faq_entries`
6. `20261102120000_add_university_programs_and_filters`
7. `20261102130000_complete_university_details`
8. `20261102140000_add_article_scholarships`

After the owner has separately reviewed and applied migrations, run the read-only checks:

```powershell
npm run seed:demo:preflight
npm run seed:demo:dry-run
```

Preflight reads `_prisma_migrations` and protected aggregate counts only. It never repairs migration history. Dry-run reads exact fixture IDs and unique keys, prints per-table create/preserve counts, and performs no manifest or database write.

## Future private seed execution

Set the target identity and write switch locally without committing them, then run:

```powershell
npm run seed:demo:dry-run
npm run seed:demo -- --confirm-write=TAREEQ_DEMO_SEED
```

The exact target identity can be constructed from the configured connection URL as `hostname:port/database`, for example `example.neon.tech:5432/neondb`; never copy credentials into it. The actual command emits only a batch UUID, safe counts, state, and ignored manifest path.

Publishing temporary data is a separate decision because it may become visible immediately after Backend deployment:

```powershell
npm run seed:demo:dry-run -- --visibility=published
npm run seed:demo -- --visibility=published --confirm-write=TAREEQ_DEMO_SEED --confirm-publication=TAREEQ_DEMO_PUBLICATION
```

Do not use the published profile until the Project Owner explicitly authorizes public test content and sets `DEMO_SEED_ALLOW_PUBLICATION=true`.

## Verification and cleanup

Record the batch UUID from the committed manifest. Verify expected API/Admin behavior, then preview cleanup:

```powershell
npm run seed:demo:cleanup:dry-run -- --batch=<batch-uuid>
```

The preview must show no blockers and the exact 88-record model counts. Destructive cleanup additionally requires the normal write switch and the same UUID twice:

```powershell
npm run seed:demo:cleanup -- --batch=<batch-uuid> --confirm-cleanup=<batch-uuid> --confirm-write=TAREEQ_DEMO_SEED
```

Cleanup refuses to proceed if a fixture was changed or removed, if an untracked record depends on demo content, or if an email notification references a synthetic submission. It retains append-only audit rows and marks the batch manifest `CLEANED`.

## Failure recovery

- `PLANNED` or `FAILED` manifest with zero fixture rows: inspect the failure, rerun dry-run, then retry the same seed command.
- Exact full fixture set with a `PLANNED` manifest: dry-run can recognize the complete owned set, covering the narrow case where the database committed but final manifest persistence was interrupted.
- Partial fixture presence, ownership drift, unknown migration state, or dependency blockers: stop. Preserve the manifest and request owner review; the tool intentionally performs no automatic repair.
- Never delete the manifest to bypass ownership checks, and never use Prisma reset/db push to recover a demo batch.
