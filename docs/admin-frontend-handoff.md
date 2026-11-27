# Admin Frontend handoff — Merna

This handoff describes the Backend contracts implemented locally as of the generated 144-operation OpenAPI document. It does **not** claim that the latest local changes have been deployed. Use the generated OpenAPI and Postman Collection as the machine-readable source of truth.

## Shared browser rules

- Base path: `/api/v1`.
- Send Admin cookies with `credentials: 'include'`. Tokens are HttpOnly cookies and are never returned in JSON or stored by the Frontend.
- Every state-changing authenticated request must send `Content-Type: application/json` and originate from an exact configured Admin origin. A `401` means no valid active session; `403` can mean an untrusted origin or insufficient role.
- Success is `{ success: true, data }`; errors are `{ success: false, error: { code, message, details } }`. Render `details.fields` for `VALIDATION_ERROR` where present.
- Use the role returned by `GET /auth/me` to hide privileged controls, but always handle server `403` responses. Never infer authorization in the browser.

## TA-81 / TA-82 — featured content and ordering

All five content directories support the established public and Admin list routes under `/countries`, `/universities`, `/scholarships`, `/services`, and `/articles`.

- Editorial visibility remains `status`: `DRAFT`, `PUBLISHED`, or `ARCHIVED`.
- `featured` is independent from order. For public `featured=true` requests, records are ordered by newest `featuredAt`, then `createdAt`, then `id`. A record becomes newly featured only when `featured` changes from false to true; clearing it clears `featuredAt`.
- Normal public lists retain their documented chronological defaults. Do not build a public UI dependency on `displayOrder`/`manualOrder`.
- `PATCH /admin/{resource}/order` remains an optional editorial tool for ADMIN and SUPER_ADMIN. It accepts `{ "orderedIds": ["uuid", "..."] }` for the *complete unfiltered set* of non-archived records and returns `{ items: [{ id, manualOrder }] }`. Never submit only a page or filtered subset. `409 ORDER_SET_MISMATCH` means refetch all pages and retry.

## TA-84 — Arabic-first content forms

All content writes are authenticated ADMIN/SUPER_ADMIN requests:

```text
POST/PATCH /admin/countries[/ {id}]
POST/PATCH /admin/universities[/ {id}]
POST/PATCH /admin/scholarships[/ {id}]
POST/PATCH /admin/services[/ {id}]
POST/PATCH /admin/articles[/ {id}]
```

### Article SEO suggestions

`POST /api/v1/admin/articles/{id}/seo-suggestions` is available to ADMIN and SUPER_ADMIN. It returns `{ seoTitleAr, seoDescriptionAr }` only; the Dashboard must let the editor review and explicitly save either value through the existing Article PATCH endpoint. The endpoint never changes Article status, slug, publication timestamps, or content. `GEMINI_DAILY_LIMIT` defaults to 100 requests per UTC day (maximum 500). On `429`, distinguish `GEMINI_DAILY_LIMIT_REACHED` (`remainingRequests: 0`, `resetAt`) from `GEMINI_PROVIDER_QUOTA_EXCEEDED` (optional provider-supplied `retryAfterSeconds` only).

English translation fields are optional unless explicitly noted. Omit an optional translation to preserve it on PATCH; send `null` only where the OpenAPI schema permits clearing it.

| Resource | Core required identity/editorial fields | Publication gate |
| --- | --- | --- |
| Country | `nameAr`, `slug`, `introductionAr`, `detailsAr` | Entering `PUBLISHED` requires `imageUrl` and meaningful `imageAltAr`. |
| University | `nameAr`, `officialName`, `slug`, `countryId`, `cityAr`, `overviewAr` | Entering `PUBLISHED` requires non-empty `summaryAr`. `officialName` remains required. |
| Scholarship | `titleAr`, `slug`, `studyLevel`, `fundingType`, `requirementsAr`, `descriptionAr` | Entering `PUBLISHED` requires `summaryAr` and `officialSourceUrl`; newly selected study/funding values must be active catalog choices. Legacy records remain editable for unrelated fields. |
| Service | `titleAr`, `slug`, `summaryAr`, `descriptionAr` | Standard publication status behavior. |
| Article | `titleAr`, `slug`, `summaryAr`, `bodyAr` | Standard publication status behavior; ordered `scholarshipIds` replaces links when supplied. |

Cities and Academic Majors remain Arabic-first for their editorial labels, but their current Backend contracts require `nameEn`; do not remove those inputs. Preserve slug and identity fields after publication: changing a previously published content slug returns `409 PUBLISHED_SLUG_IMMUTABLE`.

## TA-85 — Settings and About Us

| Endpoint | Role | Contract and UI behavior |
| --- | --- | --- |
| `GET /site-settings` | Public | Safe all-null defaults before initialization. |
| `PATCH /admin/site-settings` | SUPER_ADMIN | Send one or more allowlisted fields only: Academy names, contact email/phone/WhatsApp, Arabic/English addresses, and approved HTTPS social URLs. `null` clears a nullable field. ADMIN must not see editing controls. |
| `GET /about` | Public | Returns only a published singleton; otherwise `404 CONTENT_NOT_FOUND`. |
| `GET /admin/about` | SUPER_ADMIN | Returns editable singleton or `404` before first save. |
| `PATCH /admin/about` | SUPER_ADMIN | Partial merge. Publishing requires `heroTitleAr`, `heroSubtitleAr`, `introTitleAr`, and `introBodyAr` in the merged record. |

Use a Draft/Publish UI for About Us. `publishedAt` and `updatedAt` are public; Admin-only `status` and `createdAt` stay private.

## TA-86 — own profile and password

| Endpoint | Request | Response / behavior |
| --- | --- | --- |
| `GET /auth/me` | none | `{ user: { id, name, email, role } }` for an active authenticated account. |
| `PATCH /auth/me` | `{ "name": "..." }` only | Name is trimmed and repeated whitespace is normalized. Other fields are rejected. |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` | New password: 12–128 chars, lowercase, uppercase, and number; must differ from current password. Success clears cookies; prompt for login again. |

Password change revokes existing refresh sessions and invalidates prior access cookies immediately through `authVersion`.

## TA-87 — administrator account management

SUPER_ADMIN only:

```text
GET   /admin/users?page=1&limit=20
PATCH /admin/users/{id}
```

List responses contain only `id`, `name`, `email`, `role`, and `isActive`. A PATCH accepts exactly one group:

- `{ name?, email? }` — normalized; email is case-insensitive unique.
- `{ role: "ADMIN" | "SUPER_ADMIN" }`.
- `{ isActive: true | false }`.

Handle `409` for duplicate email, unchanged update, self-demotion, self-deactivation, and last-active-SUPER_ADMIN protection. There is no Admin creation, physical deletion, or plaintext-password reset endpoint. Deactivation is the supported removal-of-access action and immediately invalidates the target’s existing sessions.

## TA-88 — password recovery

```text
POST /auth/password-recovery/request  { email }
POST /auth/password-recovery/verify   { challengeId, otp }
POST /auth/password-recovery/reset    { challengeId, resetAuthorization, newPassword }
POST /auth/admin/users/{id}/password-recovery  # SUPER_ADMIN only; no body
```

The request endpoint always responds `202` with a generic message and an opaque UUID `challengeId`, including for unknown, inactive, cooldown-limited, and rate-limited emails. Move to the code-entry screen with that ID; do not use the response to determine whether an account exists. Verify requires exactly six digits. A successful verify returns `{ resetAuthorization }`; keep it only in transient in-memory UI state and submit it once with a policy-compliant password. Codes and authorization expire after 10 minutes; an OTP has five attempts. Reset success clears cookies and requires a fresh login.

Never display OTPs, reset authorizations, target-email overrides, or temporary passwords in the Admin UI. The SUPER_ADMIN initiation endpoint must show only generic acceptance.

## TA-71 / TA-72 — applications and inquiries

```text
GET   /admin/applications            GET    /admin/inquiries
GET   /admin/applications/{id}       GET    /admin/inquiries/{id}
PATCH /admin/applications/{id}/status
PATCH /admin/inquiries/{id}/status
DELETE /admin/applications/{id}      DELETE /admin/inquiries/{id}
```

ADMIN and SUPER_ADMIN may list, view, and update `{ status?, internalNote? }`; statuses are `NEW`, `IN_REVIEW`, `RESOLVED`, and `CLOSED`. Application lists also accept `applicationType`; both lists accept pagination and documented sort/status filters.

Permanent deletion is SUPER_ADMIN-only. After an explicit irreversible-action dialog, send exactly `{ "confirmation": "DELETE" }`. The Backend atomically deletes only the submission and its EmailNotification outbox records, then records a safe audit event. It never deletes the referenced Country, University, Scholarship, or unrelated submissions. Handle `400`, `401`, `403`, and `404`; refresh the list after `200`.

## TA-42 — content hard delete

For Countries, Universities, Scholarships, Services, and Articles:

```text
DELETE /admin/{resource}/{id}
POST   /admin/{resource}/{id}/hard-delete/confirm  { challengeId }
```

Call `DELETE` first. Both ADMIN and SUPER_ADMIN can delete a DRAFT, PUBLISHED, or ARCHIVED target when its impact contains only the target, preserved history, and association unlinking. Article deletion preserves linked Countries, Universities, and Scholarships while removing its relationship rows. A `409 DELETE_REQUIRES_CONFIRMATION` is reserved for SUPER_ADMIN operations that would delete additional dependent records; it includes `error.details.confirmation.challengeId` and an impact matrix. Render the impact, then submit that challenge within its short lifetime. The Backend locks and recalculates the graph; stale, changed, expired, cross-actor, or reused challenges return an updated `409`. Never invent a `force` flag. Some protected historical relationships produce `409 DELETE_BLOCKED` and must be resolved by policy, not bypassed in the UI.

## Backend-ready versus Frontend work

The routes above are implemented locally and documented in OpenAPI/Postman. The Admin Frontend still needs its own forms, role-aware controls, confirmation dialogs, cookie-aware API client, error rendering, and deployment compatibility testing. Password recovery production use additionally depends on the owner verifying the Resend sender/domain; media forms depend on the owner verifying Cloudinary upload credentials and returned URLs.
