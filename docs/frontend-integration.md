# Frontend Integration Guide

## Quick Start — Connect Your Frontend

Production uses these shared-site HTTPS domains:

| Application | URL | API behavior |
| --- | --- | --- |
| Public Website | `https://tareeq-academy.com` | Reads published content without cookies |
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

- Public content `GET` requests require no authentication cookies. Browser requests are allowed from the configured `PUBLIC_ALLOWED_ORIGINS`; server-to-server requests are not governed by browser CORS.
- Admin and Authentication requests use exact trusted origins. Set `withCredentials: true` so the browser stores and sends the API host's cookies.
- Login credentials come from authorized users. The Frontend learns the authoritative role from `GET /auth/me`.
- Access and refresh credentials remain in host-only HttpOnly cookies. Never copy them into `localStorage`, `sessionStorage`, JavaScript state, or Authorization headers.
- CSRF origin checks remain active for state-changing Authentication and Admin requests. Public CORS does not grant Admin permission.
- Future public mutation endpoints require a separate security decision; the current public CORS policy is read-only.

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
| Manage administrator accounts | No | No endpoint | No endpoint |

`ADMIN` and `SUPER_ADMIN` currently have the same Content Management permissions. There are no dedicated SUPER_ADMIN management endpoints.

The approved API contains exactly 36 operations:

| Group | Operations | Access |
| --- | ---: | --- |
| System | 1 | Public health check |
| Authentication | 5 | Login plus cookie-session operations |
| Public Content | 10 | List and slug detail for five resources |
| Admin Content | 20 | List, UUID detail, create, and update for five resources |

Resources are `countries`, `universities`, `scholarships`, `services`, and `articles`.

```text
GET  /health

POST /auth/login                 GET  /auth/me
POST /auth/refresh               POST /auth/logout
POST /auth/change-password

GET  /{resource}                 GET   /{resource}/{slug}
GET  /admin/{resource}           GET   /admin/{resource}/{id}
POST /admin/{resource}           PATCH /admin/{resource}/{id}
```

All paths above are relative to `https://api.tareeq-academy.com/api/v1`. Publication changes use the normal Admin `PATCH`; there is no separate publish endpoint and no DELETE operation.

Authentication endpoints are implemented even when an anonymous request correctly returns `401`. For example, `GET /auth/me` requires a valid access cookie.

Applications, inquiries, uploads, analytics, student accounts, and Admin account-management APIs are not implemented.

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

## Responses and Validation

Success responses use one envelope:

```json
{
  "success": true,
  "data": {}
}
```

Collections include `data.items` and `data.pagination`. Pagination defaults to `page=1&limit=12`; `limit` must be 1–50.

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

Important codes include `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_SESSION`, `CSRF_VALIDATION_FAILED`, `CONTENT_NOT_FOUND`, `RELATIONSHIP_INVALID`, `PUBLICATION_REQUIREMENTS_NOT_MET`, `SLUG_CONFLICT`, and `PUBLISHED_SLUG_IMMUTABLE`.

## Article Editor Contract

Article bodies are flat, plain-text blocks rather than native TipTap/ProseMirror JSON:

```json
[
  { "type": "heading2", "text": "عنوان القسم" },
  { "type": "paragraph", "text": "فقرة نصية آمنة." }
]
```

Allowed types are `paragraph`, `heading2`, `heading3`, `bulleted-list`, `numbered-list`, and `quote`. A restricted TipTap editor needs a small adapter at its API boundary. Unsupported marks, embedded media, nested lists, and arbitrary HTML cannot be preserved by the current contract.

## Postman and Detailed Reference

The repository includes:

- `docs/postman/tareeq-api.postman_collection.json` — all 36 operations.
- `docs/postman/tareeq-api.read-only-smoke.postman_collection.json` — Health plus five safe public list requests.
- Local and Vercel Postman environments. The Vercel environment uses the production custom API and Admin origins.

The complete Collection labels state-changing operations `[MANUAL]`. Do not run them through a production Collection Runner. Let Postman manage cookies; do not extract tokens.

Use Scalar for required fields, schemas, examples, role/security indicators, and documented errors. Use `X-Request-Id` when reporting an unexpected server response.
