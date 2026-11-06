# Tareeq Academy Backend Handoff

## Release summary

Production API: `https://api.tareeq-academy.com`. The deployed OpenAPI reports 108 operations. Public read-only acceptance was performed on 2026-11-06; authenticated Admin GET acceptance is `AUTH_BLOCKED` because no session credentials were requested or used.

- OpenAPI: https://api.tareeq-academy.com/openapi.json
- Scalar: https://api.tareeq-academy.com/docs
- Detailed integration guide: `docs/frontend-integration.md` in this repository.

## Public API links

- https://api.tareeq-academy.com/api/v1/health
- https://api.tareeq-academy.com/api/v1/statistics
- https://api.tareeq-academy.com/api/v1/countries?page=1&limit=12
- https://api.tareeq-academy.com/api/v1/countries/{slug}
- https://api.tareeq-academy.com/api/v1/universities?page=1&limit=12
- https://api.tareeq-academy.com/api/v1/universities/{slug}
- https://api.tareeq-academy.com/api/v1/scholarships?page=1&limit=12
- https://api.tareeq-academy.com/api/v1/scholarships/test
- https://api.tareeq-academy.com/api/v1/scholarships/filter-options
- https://api.tareeq-academy.com/api/v1/services?page=1&limit=12
- https://api.tareeq-academy.com/api/v1/services/{slug}
- https://api.tareeq-academy.com/api/v1/articles?page=1&limit=12
- https://api.tareeq-academy.com/api/v1/articles/{slug}
- https://api.tareeq-academy.com/api/v1/faqs?scope=GLOBAL&page=1&limit=5
- https://api.tareeq-academy.com/api/v1/about
- https://api.tareeq-academy.com/api/v1/marketing/pages/HOME/images
- https://api.tareeq-academy.com/api/v1/marketing/pages/DESTINATIONS/images
- https://api.tareeq-academy.com/api/v1/student-journey-steps

`/about` returns 404 until the owner publishes valid About Us content. Empty Service, Article, FAQ, Marketing, and Journey collections/configuration are valid content states; hide their UI rather than fabricating placeholders.

## Response changes

- Country details: nullable `overviewImageUrl` and `overviewImageAltAr`, `studentFacts`, and `studyGuide: []` when unset.
- Service details: `stepsAr: []` and `benefitsAr: []` when unset.
- Scholarship details: `benefitsAr`, `requirementItemsAr`, and `applicationStepsAr`, each empty when unset.
- Scholarship filter options: `value`, `count`, and nullable `labelAr`. Recognized Arabic labels include `ASSOCIATE_BACHELOR_MASTER_PHD`, `BACHELOR_MASTER_PHD`, `MASTER`, `GOVERNMENT_FUNDED`, `GOVERNMENT_FUNDED_FULL`, and `TUITION_AND_STIPEND`. Unknown values—including `test`—remain `null`.

## Admin API paths

All require an existing authenticated Admin session and trusted origin. Do not send credentials in URLs.

- `GET|POST /api/v1/admin/countries/{parentId}/study-guide`
- `PATCH /api/v1/admin/countries/{parentId}/study-guide/order`
- `PATCH|DELETE /api/v1/admin/study-guide/{id}`
- `GET|POST /api/v1/admin/services/{parentId}/service-detail-items`
- `PATCH /api/v1/admin/services/{parentId}/service-detail-items/order`
- `PATCH|DELETE /api/v1/admin/service-detail-items/{id}`
- `GET|POST /api/v1/admin/scholarships/{parentId}/scholarship-detail-items`
- `PATCH /api/v1/admin/scholarships/{parentId}/scholarship-detail-items/order`
- `PATCH|DELETE /api/v1/admin/scholarship-detail-items/{id}`

Admin order requests submit the full, duplicate-free ID list for one parent/kind. Frontend must preserve stable IDs and use empty public arrays as an intentional no-content state.

## Ticket closure matrix

| Ticket | Status | Frontend note |
|---|---|---|
| TA-20 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | University directory filters are deployed; tuition-range filtering remains a separate product decision. |
| TA-21 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Existing University data/API work is deployed; verify UI against OpenAPI. |
| TA-22 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Existing related-content functionality is deployed. |
| TA-23 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | University detail data APIs are deployed. |
| TA-24 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Existing article/scholarship relationship support is deployed. |
| TA-25 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | FAQ APIs are deployed; country editorial entries remain data pending. |
| TA-26 | FRONTEND_DEPENDENCY | Student Journey APIs are deployed; approved icon-key allowlist is still required. |
| TA-27 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Analytics APIs are deployed; Admin HTTP acceptance needs an authorized session. |
| TA-28 | DATA_PENDING | Journey slots/content remain unconfigured pending owner content and icon mapping. |
| TA-29 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Country facts, guide, and images are deployed; approved country content/images remain pending. |
| TA-31 | DATA_PENDING | University metadata editing exists; owner must supply verified City/type values. |
| TA-32 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Programs/admissions/gallery/FAQ capability is deployed. |
| TA-33 | CODE_FIX_LOCAL_PENDING_DEPLOY | Dynamic facets are deployed; Arabic label correction is local and awaits deployment. Published `test` remains editorially visible. |
| TA-34 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Scholarship detail sections are deployed; verified editorial detail content remains pending. |
| TA-35 | DATA_PENDING | Service workflow is deployed; no approved published Services are configured. |
| TA-37 | DONE_DEPLOYED_NOT_FULLY_VERIFIED | Service step/benefit capability is deployed; content is optional and currently may be empty. |
| TA-38 | DATA_PENDING | Site Settings workflow is deployed; official contact/social content remains owner-supplied. |

## Editorial and integration dependencies

- Do not hide published `test` Scholarship in code. Owner should review/archive or correct it, including its Admin-creation URL, through the approved editorial process.
- Supply real Country imagery/Arabic alt text, Country FAQs, Service content, scholarship sources/deadlines, University type/City metadata, and official contact/social settings.
- Supply the Frontend Student Journey icon-key allowlist. Until then, the Backend safely keeps unsupported icons from public activation.

## Acceptance evidence

- Public health, statistics, Country/University/Scholarship/Service/Article lists, and scholarship facets: PASS reachability (HTTP 200).
- Public FAQs: use `scope=GLOBAL&page=1&limit=5` for the Homepage collection.
- Public About Us: valid 404 while no published singleton exists.
- Marketing/Journey contract paths: use the URLs listed above; no content is assumed.
- Admin GET and Analytics Summary HTTP endpoint: AUTH_BLOCKED; no credentials were requested or used.
- TA-33 Arabic labels: local tests PASS; deployment required before production response changes.
