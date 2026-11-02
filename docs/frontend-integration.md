# Frontend Integration Guide

## Quick Start — Connect Your Frontend

Production uses these shared-site HTTPS domains:

| Application | URL | API behavior |
| --- | --- | --- |
| Public Website | `https://tareeq-academy.com` | Reads published content and submits applications/inquiries without cookies |
| Admin Dashboard | `https://admin.tareeq-academy.com` | Uses Backend-owned HttpOnly cookies |
| Backend | `https://api.tareeq-academy.com` | API, OpenAPI, and Scalar |

Every application endpoint starts with `/api/v1`. A Next.js project can expose the API base URL as public configuration:

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://api.tareeq-academy.com/api/v1
```

`NEXT_PUBLIC_API_BASE_URL` is an example name; confirm the Frontend repository's convention before adding it. Frontend applications must never receive `DATABASE_URL`, `DIRECT_DATABASE_URL`, `JWT_SECRET`, administrator passwords, or other Backend secrets.

Create separate Axios clients for public and authenticated calls:

```ts
import axios from 'axios'

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL
if (!baseURL) throw new Error('API base URL is required')

export const publicApi = axios.create({ baseURL })

export const adminApi = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})
```

Verify the first public request:

```ts
const response = await publicApi.get('/countries', {
  params: { page: 1, limit: 1 },
})

console.log(response.status) // 200
console.log(response.data.success) // true
```

- API reference: [`https://api.tareeq-academy.com/docs`](https://api.tareeq-academy.com/docs)
- OpenAPI 3.1: [`https://api.tareeq-academy.com/openapi.json`](https://api.tareeq-academy.com/openapi.json)

## Public Website vs Admin Dashboard

- Public content `GET` and the approved application/inquiry `POST` requests require no authentication cookies. Browser requests are allowed from the configured `PUBLIC_ALLOWED_ORIGINS`; server-to-server requests are not governed by browser CORS.
- Admin and Authentication requests use exact trusted origins. Set `withCredentials: true` so the browser stores and sends the API host's cookies.
- Login credentials come from authorized users. The Frontend learns the authoritative role from `GET /auth/me`.
- Access and refresh credentials remain in host-only HttpOnly cookies. Never copy them into `localStorage`, `sessionStorage`, JavaScript state, or Authorization headers.
- CSRF origin checks remain active for state-changing Authentication and Admin requests. Public CORS does not grant Admin permission.
- Public content CORS remains read-only. Applications and inquiries have a separate, narrowly scoped non-credentialed `POST`/`OPTIONS` policy; future public mutations still require individual security review.

### Local authenticated development

`http://localhost` and `https://api.tareeq-academy.com` are different sites. A local Admin Dashboard calling the deployed API directly cannot rely on `SameSite=Lax` session cookies.

For real authenticated browser testing, use the shared-site production domains or run the Frontend and Backend on `localhost` with separate ports. Do not weaken cookies to `SameSite=None`, and do not add a BFF or proxy unless that architecture is separately approved. Server Actions do not automatically forward host-only cookies owned by another host.

## Roles and Implemented API

| Capability | Public user | `ADMIN` | `SUPER_ADMIN` |
| --- | ---: | ---: | ---: |
| Health and published-content reads | Yes | Yes | Yes |
| Start an Admin session | Authorized Admin credentials required | Yes | Yes |
| Use `/auth/me`, refresh, logout, or change password | No | Yes | Yes |
| List, create, update, publish, unpublish, or archive content | No | Yes | Yes |
| Submit an application or inquiry | Yes | Yes | Yes |
| Review applications/inquiries and update workflow status or internal notes | No | Yes | Yes |
| Upload an image for an existing content workflow | No | Yes | Yes |
| Read administrator audit logs | No | No | Yes |
| List and change existing administrator roles/activation | No | No | Yes |
| Read public site settings | Yes | Yes | Yes |
| Update public site settings | No | No | Yes |
| Send consent-approved anonymous analytics | Yes | Yes | Yes |
| Read analytics reports and journeys | No | No | Yes |
| Read published FAQs | Yes | Yes | Yes |
| Create, edit, publish, archive, and reorder FAQs | No | Yes | Yes |
| Read verified University programs, admission requirements, gallery, and dynamic filters | Yes | Yes | Yes |
| Manage University programs, admission requirements, gallery, Majors, Cities, and University type | No | Yes | Yes |
| Create or delete administrator accounts | No | No endpoint | No endpoint |

`ADMIN` and `SUPER_ADMIN` have the same Content Management and FAQ-management permissions. Audit-log review, existing Admin-account management, site-settings updates, and analytics reporting are SUPER_ADMIN-only. There is no Admin creation or deletion endpoint.

The approved API contains exactly 81 operations:

| Group | Operations | Access |
| --- | ---: | --- |
| System | 1 | Public health check |
| Authentication | 5 | Login plus cookie-session operations |
| Public Content | 10 | List and slug detail for five resources |
| Admin Content | 20 | List, UUID detail, create, and update for five resources |
| Public Submissions | 2 | Create an application or general inquiry |
| Admin Submissions | 6 | List, UUID detail, and workflow update |
| Admin Media | 1 | Authenticated Cloudinary image upload |
| Admin Audit Logs | 1 | SUPER_ADMIN-only read access |
| Admin Account Management | 2 | SUPER_ADMIN-only list and update |
| Public Site Settings | 1 | Public read |
| Admin Site Settings | 1 | SUPER_ADMIN-only update |
| Public Analytics | 1 | Anonymous event ingestion |
| Admin Analytics | 2 | SUPER_ADMIN-only reports |
| Public FAQs | 5 | Homepage plus four published-resource collections |
| Admin FAQs | 4 | Scoped list, create, update/archive, and atomic reorder |
| Public University Directory | 2 | Dynamic filter options and published programs |
| Admin University Programs | 3 | Scoped list, create, and update/archive |
| Public University Details | 2 | Scoped admission requirements and ordered gallery |
| Admin University Details | 8 | Admission list/create/update and gallery list/attach/update/reorder/detach |
| Admin Directory Catalogs | 4 | Major and City list/create operations |

Resources are `countries`, `universities`, `scholarships`, `services`, and `articles`.

```text
GET  /health

POST /auth/login                 GET  /auth/me
POST /auth/refresh               POST /auth/logout
POST /auth/change-password

GET  /{resource}                 GET   /{resource}/{slug}
GET  /admin/{resource}           GET   /admin/{resource}/{id}
POST /admin/{resource}           PATCH /admin/{resource}/{id}

POST /applications               POST  /inquiries
GET  /admin/applications         GET   /admin/inquiries
GET  /admin/applications/{id}    GET   /admin/inquiries/{id}
PATCH /admin/applications/{id}/status
PATCH /admin/inquiries/{id}/status

POST /admin/uploads/images
GET  /admin/audit-logs
GET  /admin/users                PATCH /admin/users/{id}
GET  /site-settings              PATCH /admin/site-settings
POST /analytics/events
GET  /admin/analytics/summary    GET /admin/analytics/journeys
GET  /faqs
GET  /countries/{slug}/faqs     GET /universities/{slug}/faqs
GET  /services/{slug}/faqs      GET /scholarships/{slug}/faqs
GET  /admin/faqs                POST /admin/faqs
PATCH /admin/faqs/{id}          PATCH /admin/faqs/order
GET  /universities/filter-options
GET  /universities/{slug}/programs
GET  /admin/universities/{universityId}/programs
POST /admin/universities/{universityId}/programs
PATCH /admin/university-programs/{id}
GET  /admin/academic-majors     POST /admin/academic-majors
GET  /admin/cities              POST /admin/cities
```

All paths above are relative to `https://api.tareeq-academy.com/api/v1`. Publication changes use the normal Admin `PATCH`; there is no separate publish endpoint and no DELETE operation.

Authentication endpoints are implemented even when an anonymous request correctly returns `401`. For example, `GET /auth/me` requires a valid access cookie.

Admin creation/deletion, password recovery, image deletion, a standalone media library, public analytics reporting, and student accounts are not implemented. Audit records have no update or deletion endpoint.

## Practical Requests

### Published content

```ts
// Published countries
const countries = await publicApi.get('/countries', {
  params: { featured: true, page: 1, limit: 12, sort: 'manual' },
})

// Universities filtered by Country slug
const universities = await publicApi.get('/universities', {
  params: { country: 'romania', page: 1, limit: 12, sort: 'name' },
})

// Closed opportunities, including passed verified deadlines
const scholarships = await publicApi.get('/scholarships', {
  params: { applicationStatus: 'CLOSED', sort: 'deadline' },
})
```

Scholarship `status` controls editorial publication. `effectiveApplicationStatus` reports whether applications are effectively `OPEN` or `CLOSED`; a passed `verifiedDeadline` makes it `CLOSED` without hiding the published record.

Services and Articles currently contain only DRAFT seed records, so their public collections may correctly return an empty `items` array.

### Login, current user, and refresh

```ts
await adminApi.post('/auth/login', { email, password })

const me = await adminApi.get('/auth/me')
console.log(me.data.data.user.role) // ADMIN or SUPER_ADMIN

await adminApi.post('/auth/refresh')
```

Login returns user data and sets cookies; it never returns JWTs. Refresh credentials are single-use, so coordinate concurrent `401` recovery into one refresh attempt. Logout clears the current browser session:

```ts
await adminApi.post('/auth/logout')
```

### Read and publish Admin content

```ts
const drafts = await adminApi.get('/admin/articles', {
  params: { status: 'DRAFT', page: 1, limit: 12, sort: 'newest' },
})

// Use authorized non-production test data only.
const created = await adminApi.post('/admin/countries', {
  nameAr: 'وجهة تجريبية',
  slug: 'example-destination',
  introductionAr: 'مقدمة تعريفية للاختبار.',
  detailsAr: 'معلومات دراسية تجريبية غير منشورة.',
  status: 'DRAFT',
})

const id = created.data.data.id
await adminApi.patch(`/admin/countries/${id}`, { featured: true })
await adminApi.patch(`/admin/countries/${id}`, { status: 'PUBLISHED' })
```

Admin detail and update routes use UUIDs, while public detail routes use slugs. The first publication sets `publishedAt`; later unpublish/archive transitions preserve it. Published slugs are immutable.

Use Scalar for each resource's required fields and relationship rules. In particular, Universities require a Country, Scholarship relationships must be consistent, and publishing a Scholarship requires an HTTP(S) `officialSourceUrl`.

## Upload a Content Image

Upload the image before creating or updating the content record. Use the authenticated `adminApi`, but let the browser set the multipart boundary—do not set `Content-Type` manually for `FormData`.

```ts
const form = new FormData()
form.set('resource', 'countries')
form.set('file', selectedFile)

const uploaded = await adminApi.post('/admin/uploads/images', form)
const imageUrl = uploaded.data.data.secureUrl

await adminApi.patch(`/admin/countries/${countryId}`, {
  imageUrl,
  imageAltAr: 'وصف عربي للصورة',
})
```

Allowed `resource` values are `countries`, `universities`, `scholarships`, `services`, and `articles`. The file must be a non-animated JPEG, PNG, or WebP image of at most 4,000,000 bytes. The complete multipart body must remain at or below 4,100,000 bytes, so the Frontend should send only the required `resource` and `file` fields. The Backend verifies the actual bytes and rejects MIME mismatches, malformed files, SVG, GIF, and other formats.

HTTP `201` returns:

```json
{
  "success": true,
  "data": {
    "assetId": "provider-asset-id",
    "publicId": "tareeq-academy/countries/server-generated-id",
    "secureUrl": "https://res.cloudinary.com/example/image/upload/v1/tareeq-academy/countries/server-generated-id.webp",
    "format": "webp",
    "bytes": 183204,
    "width": 1600,
    "height": 900
  }
}
```

Use only `secureUrl` in the existing content image field. The Frontend must not receive Cloudinary credentials, construct signed uploads, or assume this endpoint changes a content record. There is no deletion or media-library workflow in Task #7.

## Student Applications and Inquiries

Public forms use `publicApi` without `withCredentials`. Always send `privacyAccepted: true`, include an empty hidden `website` field as the honeypot, and do not retain or display an application identifier—the API intentionally returns only a minimal confirmation.

University admission example:

```ts
await publicApi.post('/applications', {
  applicationType: 'UNIVERSITY_ADMISSION',
  countryId: selectedCountryId || null,
  universityId: selectedUniversityId || null,
  studyLevel: selectedStudyLevel || null,
  intendedMajor: intendedMajor || null,
  fullName,
  email,
  phone: phone || null,
  message,
  privacyAccepted: true,
  website: '',
})
```

Scholarship assistance works with or without a specific scholarship:

```ts
await publicApi.post('/applications', {
  applicationType: 'SCHOLARSHIP_ASSISTANCE',
  scholarshipId: selectedScholarshipId || null,
  countryId: selectedCountryId || null,
  universityId: selectedUniversityId || null,
  studyLevel: selectedStudyLevel || null,
  intendedMajor: intendedMajor || null,
  fullName,
  email,
  phone: phone || null,
  message,
  privacyAccepted: true,
  website: '',
})
```

When supplied, Country and University IDs must refer to published records and be mutually consistent. A Scholarship ID must identify a published, currently open opportunity and must be consistent with any supplied Country or University. Study levels currently use the same bounded text values exposed by Scholarship content; there is no separate study-level enumeration.

General inquiry example:

```ts
await publicApi.post('/inquiries', {
  fullName,
  email,
  phone: phone || null,
  subject,
  message,
  privacyAccepted: true,
  website: '',
})
```

Both endpoints return HTTP `201`:

```json
{
  "success": true,
  "data": { "message": "Submission received." }
}
```

HTTP `201` confirms that the Backend committed the submission to PostgreSQL. It does not guarantee that the Arabic confirmation email or Admin notification has already been delivered. Email delivery runs independently through a durable retryable outbox, so the Frontend must use the API response—not email arrival—as the submission result.

Bind `error.details.fields` to the matching form fields. HTTP `429` with `SUBMISSION_RATE_LIMITED` means the shared 15-minute limit was reached. Do not retry automatically. The Backend stores the consent timestamp; it never exposes submissions through public lookup endpoints.

Admin review uses `adminApi` with cookies:

```ts
const applications = await adminApi.get('/admin/applications', {
  params: { status: 'NEW', applicationType: 'SCHOLARSHIP_ASSISTANCE', sort: 'newest' },
})

await adminApi.patch(`/admin/applications/${id}/status`, {
  status: 'IN_REVIEW',
  internalNote: 'تمت مراجعة الطلب.',
})
```

The same list/detail/status pattern exists under `/admin/inquiries`. Allowed workflow statuses are `NEW`, `IN_REVIEW`, `RESOLVED`, and `CLOSED`. Internal notes are private Admin fields.

## Reusable FAQ Integration

Homepage FAQs use the explicit `GLOBAL` scope. Resource pages use their existing slug automatically; do not ask an Admin to type a slug or URL:

```ts
const homepageFaqs = await publicApi.get('/faqs', {
  params: { scope: 'GLOBAL', page: 1, limit: 5 },
})

const countryFaqs = await publicApi.get(`/countries/${countrySlug}/faqs`, {
  params: { page: 1, limit: 5 },
})
```

The same nested contract exists for `/universities/{slug}/faqs`, `/services/{slug}/faqs`, and `/scholarships/{slug}/faqs`. Public responses contain published entries only and sort by `displayOrder`, then `id`. Render the first five from page 1 and request later pages for “show more”; there is no fixed total FAQ limit. A `404 FAQ_PARENT_NOT_FOUND` means the parent is absent or not published.

Admin screens scope every request with the current resource UUID. Homepage management sends `scope: 'GLOBAL'` and omits `parentId`; resource screens send the matching scope and UUID:

```ts
const scopeByResource = {
  country: 'COUNTRY',
  university: 'UNIVERSITY',
  service: 'SERVICE',
  scholarship: 'SCHOLARSHIP',
} as const

const params = resourceType === 'homepage'
  ? { scope: 'GLOBAL' as const }
  : { scope: scopeByResource[resourceType], parentId: resourceId }

const faqs = await adminApi.get('/admin/faqs', {
  params: { ...params, page: 1, limit: 50 },
})

await adminApi.post('/admin/faqs', {
  ...params,
  questionAr,
  answerAr,
  questionEn: questionEn || null,
  answerEn: answerEn || null,
  status: 'DRAFT',
})

await adminApi.patch(`/admin/faqs/${faqId}`, {
  questionAr,
  answerAr,
  status: 'PUBLISHED',
})

await adminApi.patch(`/admin/faqs/${faqId}`, { status: 'ARCHIVED' })
```

Arabic question and answer are required. English question and answer are optional but must be supplied or cleared together. Scope and parent are immutable after creation; create a new entry if the content belongs elsewhere. There is no DELETE operation, and draft or archived entries must never be rendered as published.

Reordering is a strict, atomic full-set operation. Submit every non-archived FAQ ID for the current parent exactly once in the desired order:

```ts
await adminApi.patch('/admin/faqs/order', {
  ...params,
  orderedIds: activeFaqs.map((faq) => faq.id),
})
```

On `409 FAQ_ORDER_SET_MISMATCH`, refetch the scoped Admin list and retry from the new active set. Never combine IDs from another resource or include archived IDs. This contract prevents unrelated FAQs from appearing or being reordered together.

## University Programs and Advanced Filters

The existing University collection accepts additive P1/P2 filters while preserving every existing parameter:

```ts
const filters = {
  country: 'romania',
  major: 'medicine',
  studyLevel: 'BACHELORS',
  language: 'ENGLISH',
  city: 'bucharest',
  universityType: 'PUBLIC',
  page: 1,
  limit: 12,
}

const [universities, options] = await Promise.all([
  publicApi.get('/universities', { params: filters }),
  publicApi.get('/universities/filter-options', { params: filters }),
])
```

`major`, `studyLevel`, and `language` must match the same published program. A University is never returned by combining a Major from one program with a level or language from another. City and type apply at University level. Without P1 filters, published Universities that have no normalized program records continue to appear. Render an ordinary empty state when `data.pagination.total` is zero.

Use the same filter state for related Scholarships, but map University fields to their namespaced Scholarship parameters. The two collections paginate independently; never pass the IDs from the current University page:

```ts
const universityFilters = {
  country: 'romania',
  major: 'medicine',
  studyLevel: 'BACHELORS',
  language: 'ENGLISH',
  city: 'bucharest',
  universityType: 'PUBLIC',
}

const [universities, scholarships] = await Promise.all([
  publicApi.get('/universities', {
    params: { ...universityFilters, page: universityPage, limit: 12, sort: 'newest' },
  }),
  publicApi.get('/scholarships', {
    params: {
      universityCountry: universityFilters.country,
      universityMajor: universityFilters.major,
      universityStudyLevel: universityFilters.studyLevel,
      universityLanguage: universityFilters.language,
      universityCity: universityFilters.city,
      universityType: universityFilters.universityType,
      applicationStatus: 'OPEN',
      page: scholarshipPage,
      limit: 6,
      sort: 'deadline',
    },
  }),
])
```

The Scholarship response total counts distinct Scholarships associated with every matching University, not only the 12 Universities on `universityPage`. Any University Directory parameter requires an associated published University. `universityMajor`, `universityStudyLevel`, and `universityLanguage` match the same published Program, so several matching Programs never duplicate one Scholarship.

Keep similarly named fields distinct: `country`, `studyLevel`, `search`, and `featured` filter Scholarship fields; `universityCountry`, `universityStudyLevel`, `universitySearch`, and `universityFeatured` filter the associated University or its Programs. The legacy `university` parameter still selects one exact University slug. All supplied conditions use AND semantics. `applicationStatus` filters the effective state, so a published Scholarship with stored `OPEN` and a passed deadline is returned by `applicationStatus=CLOSED`.

Filter-option counts are distinct matching-University counts, not program counts. Each facet ignores its own selected value while applying every other active filter. This lets the UI show alternative values without inflating counts when a University has several programs. Unsupported values are absent. Controlled study levels are `FOUNDATION`, `DIPLOMA`, `BACHELORS`, `MASTERS`, and `PHD`; teaching-language values come from the documented enum.

Load verified public offerings independently from the University detail:

```ts
const programs = await publicApi.get(`/universities/${universitySlug}/programs`, {
  params: { search, studyLevel, language, faculty, page: 1, limit: 12 },
})
```

Only published programs under a published University are returned. Each item includes its exact Arabic/optional English program title, normalized Major, optional localized faculty, study level, teaching languages, optional paired duration fields, HTTPS official source, verification time, and first publication time. `tuition` is the newest academic-year schedule or `null`; `tuitionFees` contains all explicit schedules in descending academic-year order. Amounts are decimal strings and may be exactly `"0"`; never substitute zero when `tuition` is null.

For Admin data entry, load or create controlled catalogs, then create a program using UUIDs already held by the edit page:

```ts
const majors = await adminApi.get('/admin/academic-majors', { params: { search, page: 1, limit: 50 } })
const cities = await adminApi.get('/admin/cities', { params: { countryId, page: 1, limit: 50 } })

await adminApi.patch(`/admin/universities/${universityId}`, {
  cityId: selectedCityId || null,
  universityType: selectedType || null,
})

const created = await adminApi.post(`/admin/universities/${universityId}/programs`, {
  academicMajorId,
  nameAr: 'بكالوريوس الطب والجراحة',
  nameEn: 'Bachelor of Medicine and Surgery',
  facultyNameAr: 'كلية الطب',
  facultyNameEn: 'Faculty of Medicine',
  durationValue: 6,
  durationUnit: 'YEARS',
  studyLevel: 'BACHELORS',
  languages: ['ENGLISH'],
  tuition: {
    amount: '12000.00',
    currency: 'EUR',
    billingPeriod: 'YEAR',
    academicYear: '2026/2027',
  },
  status: 'DRAFT',
  officialSourceUrl,
  verifiedAt: verifiedAt.toISOString(),
})

await adminApi.patch(`/admin/university-programs/${created.data.data.id}`, {
  languages: ['ENGLISH', 'ROMANIAN'],
  status: 'PUBLISHED',
})
```

Official sources must use HTTPS, verification times cannot be future values, and at least one language is required. Duration value/unit must be supplied or cleared together. Supplying a tuition schedule in a later PATCH upserts only that `academicYear`; older schedules remain available. Currency is an uppercase ISO code, billing period is `YEAR`, `SEMESTER`, or `FULL_PROGRAM`, and the academic year is consecutive `YYYY/YYYY`. Archive with `status: 'ARCHIVED'`; there is no program DELETE operation. Existing `cityAr` and `cityEn` remain the backward-compatible display fallback when `cityId` is null. Do not infer a normalized City, University type, Major, level, language, tuition, or currency from historical prose.

## University Details Page Tabs

The Overview tab continues to use `GET /universities/{slug}` and the Programs tab uses the program collection above. Load the remaining tabs independently:

```ts
const [admission, gallery, faqs, scholarships] = await Promise.all([
  publicApi.get(`/universities/${universitySlug}/admission-requirements`),
  publicApi.get(`/universities/${universitySlug}/gallery`),
  publicApi.get(`/universities/${universitySlug}/faqs`, { params: { page: 1, limit: 5 } }),
  publicApi.get('/scholarships', { params: { university: universitySlug, page: 1, limit: 3 } }),
])
```

Admission requirements return three arrays: `university`, `studyLevels`, and `programs`. Render them under their explicit scope; do not copy University-level text into every program. Empty arrays are valid. Program-scoped rows include their program UUID and summary. Public results are published-only and retain official source/verification fields.

Gallery results are `data.items`, ordered by `displayOrder` and stable ID. An empty gallery is valid and does not affect the existing University `imageUrl` cover. FAQ behavior is unchanged: University association is strict, only published entries are public, the default limit is five, and later pages load the remainder.

Related scholarships require no new endpoint. `GET /scholarships?university={universitySlug}&page=1&limit=3` returns published associated records, a total, card fields, and the existing authoritative `effectiveApplicationStatus`. Increment `page` for “load more.” A published scholarship remains visible when its effective state is `CLOSED`; never relabel it OPEN.

Admin admission management uses:

```ts
await adminApi.post(`/admin/universities/${universityId}/admission-requirements`, {
  scope: 'PROGRAM', // UNIVERSITY | STUDY_LEVEL | PROGRAM
  studyLevel: null,
  programId,
  contentAr,
  contentEn: contentEn || null,
  status: 'DRAFT',
  officialSourceUrl: null,
  verifiedAt: null,
})

await adminApi.patch(`/admin/university-admission-requirements/${requirementId}`, {
  status: 'PUBLISHED',
  officialSourceUrl,
  verifiedAt: verifiedAt.toISOString(),
})
```

Scope and target are immutable. Publishing requires an HTTPS source and non-future verification time. Archive instead of deleting.

For gallery management, upload separately and explicitly attach the returned secure URL:

```ts
const uploaded = await uploadUniversityImage(file) // existing /admin/uploads/images flow
const attached = await adminApi.post(`/admin/universities/${universityId}/gallery`, {
  imageUrl: uploaded.secureUrl,
  altAr: altAr || null,
  altEn: altEn || null,
  status: 'DRAFT',
})

await adminApi.patch(`/admin/university-gallery/${attached.data.data.id}`, { status: 'PUBLISHED' })
await adminApi.patch(`/admin/universities/${universityId}/gallery/order`, { orderedIds })
await adminApi.delete(`/admin/university-gallery/${galleryImageId}`)
```

Uploading alone never attaches an image. Reorder must include every non-archived association for that University. DELETE detaches only the database association; it does not delete Cloudinary data or the University cover image.

## Admin Activity Audit Logs

Only a signed-in `SUPER_ADMIN` can read the append-only audit collection:

```ts
if (me.data.data.user.role === 'SUPER_ADMIN') {
  const audit = await adminApi.get('/admin/audit-logs', {
    params: {
      page: 1,
      limit: 20,
      actorId: selectedAdminId || undefined,
      action: selectedAction || undefined,
      resourceType: selectedResourceType || undefined,
      from: fromDate?.toISOString(),
      to: toDate?.toISOString(),
    },
  })
}
```

Results are newest-first with `createdAt` and `id` as deterministic sort keys. Supported `resourceType` values also include `UNIVERSITY_ADMISSION_REQUIREMENT` and `UNIVERSITY_GALLERY_IMAGE`. University-detail actions include `university_admission_requirement.created|updated|published|archived`, `university_gallery_image.attached|updated|published|detached`, and `university_gallery.reordered` in addition to the existing content, FAQ, submission, Admin, settings, program, major, and city actions.

Audit metadata contains only safe transition context and changed field names. It never contains content values, full request bodies, student messages, contact details, internal-note text, passwords, tokens, cookies, or credentials. Treat HTTP `403` for an `ADMIN` audit request as an authorization result, not a session failure. The Admin Dashboard must not offer audit modification or deletion controls.

## Manage Existing Admin Accounts

Render these controls only when `/auth/me` reports `SUPER_ADMIN`:

```ts
const accounts = await adminApi.get('/admin/users', {
  params: { page: 1, limit: 20 },
})

await adminApi.patch(`/admin/users/${targetAdminId}`, {
  isActive: false,
})

await adminApi.patch(`/admin/users/${targetAdminId}`, {
  role: 'SUPER_ADMIN',
})
```

Send exactly one of `isActive` or `role` per update. The response exposes only `id`, `name`, `email`, `role`, and `isActive`. Never expect password hashes, session records, refresh credentials, or token material.

Self-deactivation and self-demotion return `409`. The Backend also preserves at least one active SUPER_ADMIN under concurrent requests. Deactivation revokes refresh sessions, and existing access cookies stop authorizing requests because each protected request checks current account state. A role change also takes effect without waiting for the access JWT to expire.

## Public Site Settings

The Public Website can read allowlisted organizational information without cookies:

```ts
const settings = await publicApi.get('/site-settings')
```

Before the singleton is initialized, every field and `updatedAt` is `null`. Fields are `academyNameAr`, `academyNameEn`, `contactEmail`, `contactPhone`, `addressAr`, `addressEn`, `facebookUrl`, `instagramUrl`, `linkedinUrl`, `youtubeUrl`, and `updatedAt`.

A SUPER_ADMIN can update or clear selected fields:

```ts
await adminApi.patch('/admin/site-settings', {
  contactEmail: 'contact@example.com',
  facebookUrl: 'https://www.facebook.com/tareeqacademy',
  addressEn: null,
})
```

Only allowlisted fields are accepted. Social links must use HTTPS and the documented provider domain. Do not build UI for arbitrary settings, environment variables, credentials, API keys, or infrastructure configuration.

## Anonymous Analytics Integration

Only emit analytics after the Public Website has applied its consent policy. The Backend does not set an analytics cookie and does not infer consent. Generate a random `visitorId` UUID for the consented browser, a new random `sessionId` UUID for each browser session, and a unique `eventId` UUID for every event. Do not derive identifiers from IP addresses, user agents, device traits, account data, or other fingerprinting inputs.

```ts
await publicApi.post('/analytics/events', {
  eventId: crypto.randomUUID(),
  visitorId,
  sessionId,
  type: 'PAGE_VIEW',
  path: '/scholarships/romania-government',
  referrerHost: 'www.google.com',
  referrerPath: '/search',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'fall-scholarships',
  occurredAt: new Date().toISOString(),
})
```

Supported types are `PAGE_VIEW`, `CTA_CLICK`, `ENGAGEMENT`, `APPLICATION_SUBMITTED`, and `INQUIRY_SUBMITTED`. CTA events require one of `APPLY_NOW`, `REQUEST_CONSULTATION`, `CONTACT_US`, `VIEW_UNIVERSITY`, `VIEW_SCHOLARSHIP`, or `VIEW_SERVICE`. Engagement events require `SCROLL_50`, `SCROLL_90`, `ACTIVE_30_SECONDS`, or `ACTIVE_60_SECONDS`.

Send relative paths without query strings or fragments. Parse referrers in the browser and send only the hostname and optional path. Never send names, emails, phones, form values, messages, full URLs, arbitrary metadata, or identifiers from URL queries. A `202` response means the allowlisted event was accepted; `data.duplicate=true` means that `eventId` was already stored. Client-reported conversion events should be emitted only after the corresponding submission API returned `201`, but they are still anonymous browser reports rather than proof of database persistence.

SUPER_ADMIN dashboards can query:

```ts
const summary = await adminApi.get('/admin/analytics/summary', {
  params: { from: '2026-10-01', to: '2026-10-31', granularity: 'day', topLimit: 10 },
})

const journeys = await adminApi.get('/admin/analytics/journeys', {
  params: { from: '2026-10-01', to: '2026-10-31', page: 1, limit: 10 },
})
```

Ranges are inclusive UTC calendar dates and may span at most 366 days. Summary responses explicitly separate `clientReportedConversions` from `serverVerifiedConversions`; do not merge these labels in the UI. Client conversions are deduplicated by anonymous session, while server-verified totals come from application and inquiry rows and cannot be attributed to a journey. Journey steps are capped at 100 and expose only the event allowlist.

Traffic-source rows group page views by the event's UTM/referrer attribution. If the frontend changes attribution values during one session, that session can appear in more than one source row, so source-row session totals are not guaranteed to sum to the overall session count.

## Responses and Validation

Success responses use one envelope:

```json
{
  "success": true,
  "data": {}
}
```

Collections include `data.items` and `data.pagination`. Content and submission pagination defaults to `page=1&limit=12` with a maximum of 50. Public FAQ pagination defaults to `page=1&limit=5`; Admin FAQ pagination defaults to `page=1&limit=50`; both have a maximum of 100. Admin-account pagination defaults to `page=1&limit=20` with a maximum of 50. Audit pagination defaults to `page=1&limit=20` with a maximum of 100.

Field-level validation errors are safe to bind to forms:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": {
      "fields": {
        "titleAr": ["Invalid input: expected string, received undefined"]
      }
    }
  }
}
```

```ts
import axios from 'axios'

export function apiError(error: unknown) {
  if (!axios.isAxiosError(error)) return null
  return {
    code: error.response?.data?.error?.code,
    message: error.response?.data?.error?.message,
    fields: error.response?.data?.error?.details?.fields,
    requestId: error.response?.headers['x-request-id'],
  }
}
```

Important codes include `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_SESSION`, `CSRF_VALIDATION_FAILED`, `CONTENT_NOT_FOUND`, `RELATIONSHIP_INVALID`, `COUNTRY_UNAVAILABLE`, `UNIVERSITY_UNAVAILABLE`, `SCHOLARSHIP_UNAVAILABLE`, `APPLICATION_NOT_FOUND`, `INQUIRY_NOT_FOUND`, `SUBMISSION_RATE_LIMITED`, `PUBLICATION_REQUIREMENTS_NOT_MET`, `SLUG_CONFLICT`, and `PUBLISHED_SLUG_IMMUTABLE`.

## Article Editor Contract

Article bodies are flat, plain-text blocks rather than native TipTap/ProseMirror JSON:

```json
[
  { "type": "heading2", "text": "عنوان القسم" },
  { "type": "paragraph", "text": "فقرة نصية آمنة." }
]
```

Allowed types are `paragraph`, `heading2`, `heading3`, `bulleted-list`, `numbered-list`, and `quote`. A restricted TipTap editor needs a small adapter at its API boundary. Unsupported marks, embedded media, nested lists, and arbitrary HTML cannot be preserved by the current contract.

### Related Scholarship selection

Article Admin detail responses include the ordered `scholarshipIds` array. Send it on create or update to replace the complete selection in exactly that order:

```json
{
  "scholarshipIds": [
    "9f414dec-fcbc-49dd-994f-086d2ef40e1f",
    "3cc47225-ad1b-42d3-88a7-f8fac69af82c"
  ]
}
```

- Omit both `scholarshipIds` and `scholarshipId` during an unrelated PATCH to preserve all links.
- Send `scholarshipIds: []` to clear all links.
- IDs must be unique UUIDs for existing Scholarships; the array order is the public card order.
- Legacy clients may keep sending only nullable `scholarshipId`, which maps to zero or one link.
- If both fields are sent, `scholarshipId` must equal the first array entry; `scholarshipId: null` is valid only with an empty array.

The public Article detail response contains a derived, read-only `relatedScholarships` collection. Do not derive public cards from Admin selections: the API excludes DRAFT and ARCHIVED Scholarships while retaining published CLOSED opportunities.

```json
{
  "success": true,
  "data": {
    "slug": "study-in-germany",
    "scholarshipId": "9f414dec-fcbc-49dd-994f-086d2ef40e1f",
    "relatedScholarships": [
      {
        "id": "9f414dec-fcbc-49dd-994f-086d2ef40e1f",
        "slug": "daad-scholarship",
        "titleAr": "منحة داد",
        "imageUrl": "https://res.cloudinary.com/example/image/upload/daad.webp",
        "country": {
          "id": "f87b99b7-38a3-4a4a-a085-411df5e5549e",
          "slug": "germany",
          "nameAr": "ألمانيا"
        },
        "effectiveApplicationStatus": "OPEN"
      }
    ]
  }
}
```

Render the returned order directly. The collection can be empty; `country` and `imageUrl` can be `null`. Article list responses intentionally do not include `scholarshipIds` or `relatedScholarships`.

## Postman and Detailed Reference

The repository includes:

- `docs/postman/tareeq-api.postman_collection.json` — all 81 operations.
- `docs/postman/tareeq-api.read-only-smoke.postman_collection.json` — Health plus five safe public list requests.
- Local and Vercel Postman environments. The Vercel environment uses the production custom API and Admin origins.

The complete Collection labels state-changing operations `[MANUAL]`. Do not run them through a production Collection Runner. Let Postman manage cookies; do not extract tokens.

Use Scalar for required fields, schemas, examples, role/security indicators, and documented errors. Use `X-Request-Id` when reporting an unexpected server response.
