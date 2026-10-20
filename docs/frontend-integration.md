# Frontend Integration Guide

This guide covers practical integration for the public website and Admin Dashboard. Use Scalar at `/docs` for the complete per-field schemas, validation rules, status codes, and examples generated from the Backend source.

## API configuration

All business endpoints use the `/api/v1` prefix. Configure each Next.js application with its Backend origin; do not include a real production domain in source control.

```dotenv
# Local Frontend development
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1

# Deployed Frontend example
# NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.example/api/v1
```

`NEXT_PUBLIC_API_BASE_URL` is public configuration, so it must contain only an HTTP API URL—never `DATABASE_URL`, `DIRECT_DATABASE_URL`, `JWT_SECRET`, or bootstrap credentials. The Project Owner configures the deployed value in the Frontend hosting environment.

The public website may call published-content endpoints from the browser or from Next.js server rendering. Public GET requests do not need cookies. The Admin Dashboard uses browser requests with credentials so the browser can receive and send Backend-owned HttpOnly cookies.

```ts
import axios, { AxiosError } from 'axios'

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL
if (!baseURL) throw new Error('NEXT_PUBLIC_API_BASE_URL is required')

export const publicApi = axios.create({ baseURL })

export const adminApi = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})
```

`withCredentials` is required for cross-origin browser authentication calls. It is unnecessary for public read-only requests. Never copy access or refresh credentials into JavaScript storage; successful auth responses contain user data, not JWTs.

## Postman collections

Import `docs/postman/tareeq-api.postman_collection.json` for all 36 documented operations, then import either the Local or Vercel environment from the same directory and select it in Postman. Both environments use `baseUrl`; update only the sanitized placeholders you need. The full Collection includes clearly labeled manual POST/PATCH and authentication operations, so do not run the full Collection against production.

For automated or routine checks, import `tareeq-api.read-only-smoke.postman_collection.json`. It contains only Health and the five public list requests and cannot modify data. The Local environment targets `http://localhost:3000`; the Vercel environment targets `https://tareeq-api.vercel.app`.

Authentication uses Backend-owned HttpOnly cookies. Set the environment's Admin email/password locally, manually run Login with an authorized account, let Postman retain cookies for the API host, call `/auth/me`, refresh when needed, use Admin requests, and finish with Logout. Do not extract tokens or create Bearer/localStorage workflows. Postman cookie success does not prove browser CORS or SameSite behavior.

Regenerate and verify repository artifacts with `npm run postman:generate` and `npm run postman:check`. Scalar at `{{baseUrl}}/docs` remains the complete interactive contract reference.

## Response envelopes

A single record uses the standard success envelope:

```json
{
  "success": true,
  "data": {
    "id": "b2b21ee5-f955-46ca-972f-6b6b81aa4a3d",
    "slug": "example-record"
  }
}
```

A collection nests pagination beside `items`:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 12,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

Errors use a stable code and safe details:

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

Content request validation uses `details.fields`. Existing authentication-schema validation may return a Zod issue array in `details`; do not assume every error has field keys. No rate limiter or `429` contract is implemented in Task #3.

```ts
type ApiErrorBody = {
  success: false
  error: {
    code: string
    message: string
    details: { fields?: Record<string, string[]> } | unknown[]
  }
}

export function readApiError(error: unknown) {
  if (!axios.isAxiosError<ApiErrorBody>(error)) {
    return { code: 'CLIENT_ERROR', message: 'Request failed.', fields: undefined }
  }

  const body = error.response?.data
  const details = body?.error.details
  const fields =
    details && !Array.isArray(details) && 'fields' in details
      ? details.fields
      : undefined

  return {
    code: body?.error.code ?? 'NETWORK_ERROR',
    message: body?.error.message ?? 'The API could not be reached.',
    fields,
    requestId: error.response?.headers['x-request-id'],
  }
}
```

Handle machine codes such as `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_SESSION`, `FORBIDDEN`, `CSRF_VALIDATION_FAILED`, `CONTENT_NOT_FOUND`, `RELATIONSHIP_INVALID`, `PUBLICATION_REQUIREMENTS_NOT_MET`, `SLUG_CONFLICT`, and `PUBLISHED_SLUG_IMMUTABLE`. Unexpected failures use `INTERNAL_SERVER_ERROR` without stack traces or SQL details. Include `X-Request-Id` in a support report.

## Browser cookies, CORS, and CSRF

- The Backend sets host-only, HttpOnly access and refresh cookies. Frontend JavaScript cannot read them.
- The access JWT lasts 15 minutes. The rotating refresh session lasts seven days.
- Cookies use `SameSite=Lax`; production cookies are `Secure`.
- Authenticated POST/PATCH requests must come from an exact origin in Backend `AUTH_ALLOWED_ORIGINS` (or the same Backend origin). Browser-generated `Origin` is checked for CSRF protection.
- Credentialed CORS cannot use `*`.
- Same-site custom domains are the expected production topology. Cross-site Vercel Preview domains may not receive `SameSite=Lax` cookies reliably.
- A Next.js server or middleware on a separate host cannot read cookies scoped to the API host. Public server-rendered GETs need no cookie; authenticated Admin workflows should use the browser cookie flow unless Leadership approves a different architecture.

## Authentication workflow

### Login

```ts
const response = await adminApi.post('/auth/login', {
  email: 'admin@example.com',
  password: 'ExamplePassword123',
})
```

Successful status: `200`. The Backend sets `tareeq_access` and `tareeq_refresh` through `Set-Cookie`; JavaScript receives only:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "a4a2ec6a-c2e0-48ca-99e4-d11353120b20",
      "name": "Admin Name",
      "email": "admin@example.com",
      "role": "ADMIN"
    }
  }
}
```

Invalid credentials or an inactive account return `401 INVALID_CREDENTIALS`.

### Current user

```ts
const { data } = await adminApi.get('/auth/me')
```

`GET /auth/me` returns the same `data.user` shape while the access cookie is valid. Missing, expired, or invalid access credentials return `401 AUTHENTICATION_REQUIRED`.

### Refresh

When an API call returns `AUTHENTICATION_REQUIRED`, the Admin application may make one controlled refresh attempt:

```ts
await adminApi.post('/auth/refresh')
```

Successful status: `200`; both cookies rotate and the response contains `data.user`. A missing, expired, reused, revoked, or inactive-account refresh session returns `401 INVALID_REFRESH_SESSION`. Avoid multiple simultaneous refresh attempts because refresh credentials are single-use.

The access JWT may remain valid for up to its 15-minute expiry after logout, password change, refresh-session revocation, or account deactivation. This is the approved V1 limitation; it is not an indefinite session.

### Logout and password change

```ts
await adminApi.post('/auth/logout')

await adminApi.post('/auth/change-password', {
  currentPassword: 'CurrentPassword123',
  newPassword: 'ChangedPassword456',
})
```

Both return `200` with `{ "success": true, "data": {} }`. Logout revokes the current refresh session when present and clears cookies. Password change updates the password, revokes refresh sessions, clears cookies, and requires a new login.

The only roles are `ADMIN` and `SUPER_ADMIN`. Both roles can manage Task #3 content. No Admin account-management endpoints are part of this API.

## Public content

Public detail routes use slugs and expose only `PUBLISHED` records:

```text
GET /countries                 GET /countries/:slug
GET /universities              GET /universities/:slug
GET /scholarships              GET /scholarships/:slug
GET /services                  GET /services/:slug
GET /articles                  GET /articles/:slug
```

Collections default to `page=1&limit=12`; `limit` must be 1–50. Invalid query values return `400 VALIDATION_ERROR` rather than being clamped.

Practical examples:

```ts
// Homepage sections
const [countries, scholarships, services, articles] = await Promise.all([
  publicApi.get('/countries', { params: { featured: true, limit: 6, sort: 'manual' } }),
  publicApi.get('/scholarships', { params: { featured: true, limit: 6, sort: 'newest' } }),
  publicApi.get('/services', { params: { featured: true, sort: 'manual' } }),
  publicApi.get('/articles', { params: { featured: true, limit: 6, sort: 'newest' } }),
])

// Country listing and detail
await publicApi.get('/countries', { params: { search: 'ألمانيا', page: 1, limit: 12 } })
await publicApi.get('/countries/germany')

// Universities by Country slug
await publicApi.get('/universities', {
  params: { country: 'germany', featured: true, sort: 'name' },
})

// Scholarship discovery
await publicApi.get('/scholarships', {
  params: {
    country: 'germany',
    university: 'example-university',
    studyLevel: 'MASTERS',
    fundingType: 'FULL',
    applicationStatus: 'OPEN',
    search: 'هندسة',
    page: 1,
    limit: 12,
    sort: 'deadline',
  },
})

// Article list/detail and related-country filter
await publicApi.get('/articles', {
  params: { country: 'germany', search: 'الدراسة', page: 1, sort: 'newest' },
})
await publicApi.get('/articles/study-guide')
```

Supported query names are exactly:

| Resource | Filters and sorting |
| --- | --- |
| Countries | `search`, `featured`, `sort=manual\|newest` |
| Universities | `search`, `country`, `featured`, `sort=newest\|name` |
| Scholarships | `search`, `country`, `university`, `studyLevel`, `fundingType`, `applicationStatus=OPEN\|CLOSED`, `featured`, `sort=newest\|deadline` |
| Services | `featured`, `sort=manual\|newest` |
| Articles | `search`, `country`, `featured`, `sort=newest` |

`DRAFT` and `ARCHIVED` records are absent from both lists and public slug lookups. Unavailable public slugs return `404 CONTENT_NOT_FOUND`.

Scholarship editorial publication and application availability are independent. A published scholarship remains visible when `applicationStatus` is `CLOSED`. If `verifiedDeadline` is before the current UTC instant, `effectiveApplicationStatus` is `CLOSED` even if stored `applicationStatus` is `OPEN`; the record is not automatically archived.

## Admin content

Each resource follows the same authenticated pattern:

```text
GET    /admin/{resource}
GET    /admin/{resource}/:id
POST   /admin/{resource}
PATCH  /admin/{resource}/:id
```

`resource` is one of `countries`, `universities`, `scholarships`, `services`, or `articles`. Admin detail/update parameters are UUIDs, not slugs. Admin collections accept the relevant public filters plus `status=DRAFT|PUBLISHED|ARCHIVED`.

```ts
// Load drafts for an editing table
const drafts = await adminApi.get('/admin/articles', {
  params: { status: 'DRAFT', page: 1, limit: 12, sort: 'newest' },
})

// Load one editable record
const record = await adminApi.get(
  '/admin/countries/b2b21ee5-f955-46ca-972f-6b6b81aa4a3d',
)
```

### Complete create and publish example

Create a neutral draft country:

```ts
const created = await adminApi.post('/admin/countries', {
  nameAr: 'وجهة تجريبية',
  nameEn: 'Example Destination',
  slug: 'example-destination',
  introductionAr: 'مقدمة تعريفية للاختبار.',
  detailsAr: 'معلومات دراسية تجريبية غير منشورة.',
  featured: false,
  displayOrder: 100,
  status: 'DRAFT',
})

const id = created.data.data.id
```

Successful creation returns `201`. Publish the same record:

```ts
const published = await adminApi.patch(`/admin/countries/${id}`, {
  status: 'PUBLISHED',
})
```

Successful update returns `200`; the first transition to `PUBLISHED` sets `publishedAt`. Later transitions retain that first timestamp:

```ts
await adminApi.patch(`/admin/countries/${id}`, { status: 'DRAFT' })     // unpublish
await adminApi.patch(`/admin/countries/${id}`, { status: 'ARCHIVED' }) // archive
```

Publication rules:

- Arabic required fields must be present; English fields are optional.
- Slugs are unique per content type and use lowercase letters, numbers, and hyphens.
- Once `publishedAt` exists, changing the slug returns `409 PUBLISHED_SLUG_IMMUTABLE`.
- Duplicate slugs return `409 SLUG_CONFLICT`.
- A University requires a valid `countryId`.
- If a Scholarship has both `countryId` and `universityId`, the University must belong to that Country.
- A Scholarship cannot become `PUBLISHED` without an HTTP(S) `officialSourceUrl`; editorial staff remain responsible for source authenticity.
- Article relationship IDs are optional but must reference existing records when supplied.
- Task #3 has no DELETE operation. Archiving preserves the record.

Use Scalar for the complete required fields of every model before constructing forms.

## Article body and TipTap

`bodyAr` is required and `bodyEn` is optional. Each is an array of plain-text blocks:

```json
[
  { "type": "heading2", "text": "عنوان القسم" },
  { "type": "paragraph", "text": "فقرة نصية آمنة." },
  { "type": "bulleted-list", "text": "عنصر قائمة واحد" },
  { "type": "quote", "text": "اقتباس قصير" }
]
```

Allowed `type` values are:

```text
paragraph
heading2
heading3
bulleted-list
numbered-list
quote
```

Every block must contain a non-empty `text` string of at most 10,000 characters. A body must contain 1–500 blocks. Unknown keys are rejected because each block is strict. Arbitrary HTML, scripts, embedded media, inline nodes, and marks are not represented. Render `text` through normal escaped React text output; never pass it to `dangerouslySetInnerHTML`.

### TipTap compatibility assessment: adapter required

The Backend format is not native TipTap/ProseMirror JSON. TipTap normally emits a document tree:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Example", "marks": [{ "type": "bold" }] }
      ]
    }
  ]
}
```

The Backend expects an array rather than a `doc`, uses one plain `text` value per block rather than nested text nodes, uses `heading2`/`heading3` instead of `heading` plus `attrs.level`, and represents list entries as flat blocks instead of nested `bulletList`/`orderedList` → `listItem` → `paragraph` nodes.

The Admin Frontend should own a small adapter at the editor/API boundary:

1. Convert the supported TipTap document nodes into Backend blocks before POST/PATCH.
2. Convert Backend blocks into a restricted TipTap document when loading an editor.
3. Configure the editor to expose only the six supported block concepts and plain text.
4. Reject or warn before saving unsupported content.

Bold, italic, links, code, hard breaks, images, nested lists, multiple styled spans, and other marks/nodes cannot be preserved by the current contract; flattening them loses formatting. Integration can proceed with a restricted editor and adapter. If preserving those features becomes a requirement, it needs a separately approved Article contract decision rather than a silent Frontend or Backend expansion.

## Detailed reference and manual Scalar check

- OpenAPI JSON: `${BACKEND_ORIGIN}/openapi.json`
- Scalar UI: `${BACKEND_ORIGIN}/docs`
- Health: `${BACKEND_ORIGIN}/api/v1/health`

The Project Owner can manually confirm Scalar by opening `/docs`, checking the System, Authentication, public content, and Admin content tags, expanding a representative GET/POST/PATCH operation, and confirming its parameters, schemas, examples, security indicator, and documented responses. Do not execute destructive or real-data requests from Scalar.
