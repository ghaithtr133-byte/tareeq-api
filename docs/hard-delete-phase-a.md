# Guarded hard deletion — Phases A and B

Phase A evaluates and executes a safe initial hard deletion for a DRAFT or ARCHIVED Country, University, Scholarship, Service, or Article when the freshly evaluated impact graph contains no destructive or protected dependency. Phase B adds a `SUPER_ADMIN`-only, database-backed, short-lived, one-time confirmation challenge for a PUBLISHED target or approved editorial effects. The graph is always locked and evaluated again inside the final transaction.

`DELETE /api/v1/admin/{resource}/{id}` and `POST /api/v1/admin/{resource}/{id}/hard-delete/confirm` are implemented for `countries`, `universities`, `scholarships`, `services`, and `articles`.

## Decision outcomes

| Outcome | HTTP | Meaning |
| --- | ---: | --- |
| `SAFE` | 200 | The non-published target has no destructive/protected dependency and is deleted with an audit record. The standard success envelope returns the verified `data.impact` with `outcome: "SAFE"`. |
| `REQUIRES_CONFIRMATION` | 409 `DELETE_REQUIRES_CONFIRMATION` | The target is PUBLISHED or has an approved explicit `DELETE`/`UNLINK` effect. A SUPER_ADMIN receives a five-minute actor-bound challenge and must use the confirmation endpoint. |
| `BLOCKED` | 409 `DELETE_BLOCKED` | The graph contains a protected, RESTRICT, demo-owned, or unknown/incomplete dependency. No delete occurs. |

Every 409 includes `error.details.impact`. Items identify the resource type, relationship path, effect, count, bounded safe IDs, code, and whether it is confirmable or blocked. A SUPER_ADMIN challenge is stored server-side with its actor, target, impact digest, expiry, and one-time consumption state. Results are not a client-controlled authorization mechanism: no `force` or cascade flag is accepted.

## Relationship inventory

| Target | Direct and transitive relationships inspected | Phase A effect |
| --- | --- | --- |
| Country | Universities, Cities, Scholarships, Articles, Student Applications, FAQs; Country Study Guide sections | Universities/Cities/Student Applications/FAQs are `BLOCK`. Study Guides are explicitly `DELETE`; optional Scholarship and Article country links are explicitly `UNLINK`. |
| University | University Programs, Program Languages/Tuition, Admission Requirements, Gallery images, Scholarships, Articles, Student Applications, FAQs | Programs and their Language/Tuition children, Admissions, and Gallery items are explicit `DELETE`; optional Scholarship and Article university links are explicit `UNLINK`; Student Applications and FAQs are `BLOCK`. |
| Scholarship | Scholarship detail items; legacy Article relation; Article–Scholarship links; Student Applications; FAQs | Detail items are explicit `DELETE`; legacy Article and join-table links are explicit `UNLINK`; Student Applications and FAQs are `BLOCK`. |
| Service | Service detail items; FAQs | Detail items are explicit `DELETE`; FAQs are `BLOCK`. |
| Article | Article–Scholarship links | Relation rows are explicit `DELETE`; no Scholarship, audit, analytics, or other shared record is deleted. |

For all five targets, matching immutable Admin audit history and Analytics Events are reported as `PRESERVE` and are not removed. A fixture-like `demo-e2e-` target slug is blocked as a defense-in-depth safeguard. This repository currently has no schema-level fixture ownership field, so a future deletion expansion must use the seed manifest or add authoritative ownership metadata rather than relying solely on a naming convention.

## External assets and failure behavior

Hard deletion never calls Cloudinary, Resend, a scheduler, or any external provider. If the atomic audit insert fails, the target delete is rolled back. If a final database foreign-key check detects a relationship that changed during evaluation, the request is rejected and returns a safe unknown-impact block rather than deleting partially.

## Confirmation protocol

1. The Frontend calls `DELETE` first and renders the returned impact.
2. Only a `SUPER_ADMIN` receives `details.confirmation.challengeId` and `expiresAt` for an eligible impact.
3. The Frontend submits `{ "challengeId": "uuid" }` to the confirmation endpoint without adding any browser-computed effect list.
4. The transaction locks the target, recomputes the digest, rejects stale/expired/used/wrong-actor challenges with an updated 409 impact, then explicitly executes only the policy-listed operations.
5. Target deletion, child delete/unlink operations, challenge consumption, and the append-only audit record are atomic.

## Schema safeguards and future policy

The pending migrations add `HardDeleteChallenge` and change Country Study Guide, Service Detail, Scholarship Detail, University Program Language, University Program Tuition, and Article–Scholarship foreign keys to `RESTRICT`. This removes hidden database cascades; Phase B explicitly deletes each approved child in FK-safe order.

Future expansion still requires Project Leadership approval for:

1. Any additional resource-specific effect class beyond this matrix.
2. An authoritative Demo Seed ownership mechanism beyond the current defense-in-depth fixture slug check.
3. Any change to audit/analytics retention.
4. An external-media deletion policy. This implementation preserves all external assets.

No client-supplied blind `force` flag is accepted.
