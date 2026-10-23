import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import type { ContentRuntime } from '../src/content/runtime.js'
import { ContentService } from '../src/content/service.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryContentRepository } from './helpers/in-memory-content-repository.js'

const ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const JWT_SECRET = 'content-api-test-secret-that-is-longer-than-thirty-two-characters'
const FIXED_NOW = new Date('2026-10-19T12:00:00.000Z')
const ADMIN_ID = 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20'

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

const countryInput = (slug = 'germany') => ({
  nameAr: 'ألمانيا',
  nameEn: 'Germany',
  slug,
  introductionAr: 'مقدمة عن الدراسة في ألمانيا',
  detailsAr: 'تفاصيل الدراسة في ألمانيا',
  featured: false,
  displayOrder: 10,
  status: 'DRAFT',
})

const serviceInput = (slug: string, displayOrder = 0) => ({
  titleAr: `خدمة ${slug}`,
  slug,
  summaryAr: 'ملخص الخدمة',
  descriptionAr: 'تفاصيل الخدمة',
  displayOrder,
  status: 'PUBLISHED',
})

describe('content management APIs', () => {
  let app: ReturnType<typeof createApp>
  let adminToken: string
  let superAdminToken: string

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superAdminToken = await signAccessToken(
      { id: '11111111-1111-4111-8111-111111111111', role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
  })

  beforeEach(() => {
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(new InMemoryAuthRepository(), JWT_SECRET),
    }
    const contentService = new ContentService(
      new InMemoryContentRepository(),
      () => new Date(FIXED_NOW),
    )
    const contentRuntime: ContentRuntime = { getService: () => contentService }
    app = createApp({ authRuntime, contentRuntime })
  })

  const adminRequest = (
    path: string,
    method = 'GET',
    body?: unknown,
    role: AdminRole = 'ADMIN',
  ) => app.request(path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superAdminToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const createCountry = async (input: Record<string, unknown> = countryInput()) => {
    const response = await adminRequest('/api/v1/admin/countries', 'POST', input)
    const body = await response.json() as { data: { id: string; slug: string; publishedAt: string | null } }
    return { response, body }
  }

  it('rejects unauthenticated Admin access and accepts both approved roles', async () => {
    const unauthenticated = await app.request('/api/v1/admin/countries')
    expect(unauthenticated.status).toBe(401)
    await expect(unauthenticated.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    })

    expect((await adminRequest('/api/v1/admin/countries')).status).toBe(200)
    expect((await adminRequest('/api/v1/admin/countries', 'GET', undefined, 'SUPER_ADMIN')).status).toBe(200)
  })

  it('separates public read CORS from credentialed Admin CORS and CSRF trust', async () => {
    for (const resource of ['countries', 'universities', 'scholarships', 'services', 'articles']) {
      const response = await app.request(`/api/v1/${resource}`, {
        headers: { Origin: PUBLIC_ORIGIN },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    }

    const readPreflight = await app.request('/api/v1/countries', {
      method: 'OPTIONS',
      headers: {
        Origin: PUBLIC_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(readPreflight.status).toBe(204)
    expect(readPreflight.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    expect(readPreflight.headers.get('access-control-allow-methods')).toContain('GET')
    expect(readPreflight.headers.get('access-control-allow-methods')).not.toContain('POST')
    expect(readPreflight.headers.get('access-control-allow-credentials')).toBeNull()

    const publicMutation = await app.request('/api/v1/countries', {
      method: 'POST',
      headers: {
        Origin: PUBLIC_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(publicMutation.status).toBe(404)
    expect(publicMutation.headers.get('access-control-allow-origin')).toBeNull()

    const untrustedPublicRead = await app.request('/api/v1/countries', {
      headers: { Origin: 'https://untrusted.invalid' },
    })
    expect(untrustedPublicRead.status).toBe(200)
    expect(untrustedPublicRead.headers.get('access-control-allow-origin')).toBeNull()

    const adminRead = await adminRequest('/api/v1/admin/countries')
    expect(adminRead.status).toBe(200)
    expect(adminRead.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(adminRead.headers.get('access-control-allow-credentials')).toBe('true')

    const publicOriginAdminMutation = await app.request('/api/v1/admin/countries', {
      method: 'POST',
      headers: {
        Origin: PUBLIC_ORIGIN,
        Cookie: `${ACCESS_COOKIE_NAME}=${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(countryInput()),
    })
    expect(publicOriginAdminMutation.status).toBe(403)
    expect(publicOriginAdminMutation.headers.get('access-control-allow-origin')).toBeNull()
    await expect(publicOriginAdminMutation.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED' },
    })
  })

  it('creates drafts, publishes them, preserves publication time and published slugs, and supports unpublish/archive', async () => {
    const created = await createCountry()
    expect(created.response.status).toBe(201)
    expect(created.body.data.publishedAt).toBeNull()

    expect((await app.request('/api/v1/countries/germany')).status).toBe(404)
    expect((await adminRequest(`/api/v1/admin/countries/${created.body.data.id}`)).status).toBe(200)

    const published = await adminRequest(
      `/api/v1/admin/countries/${created.body.data.id}`,
      'PATCH',
      { status: 'PUBLISHED' },
    )
    const publishedBody = await published.json() as { data: { publishedAt: string } }
    expect(published.status).toBe(200)
    expect(publishedBody.data.publishedAt).toBe(FIXED_NOW.toISOString())
    const publicCountry = await app.request('/api/v1/countries/germany')
    expect(publicCountry.status).toBe(200)
    expect(publicCountry.headers.get('X-Request-Id')).toBeTruthy()
    const publicCountryBody = await publicCountry.json() as { data: Record<string, unknown> }
    expect(publicCountryBody.data).not.toHaveProperty('status')
    expect(publicCountryBody.data).not.toHaveProperty('createdAt')
    expect(publicCountryBody.data).not.toHaveProperty('updatedAt')

    const renamed = await adminRequest(
      `/api/v1/admin/countries/${created.body.data.id}`,
      'PATCH',
      { slug: 'renamed-germany' },
    )
    expect(renamed.status).toBe(409)
    await expect(renamed.json()).resolves.toMatchObject({ error: { code: 'PUBLISHED_SLUG_IMMUTABLE' } })

    const unpublished = await adminRequest(
      `/api/v1/admin/countries/${created.body.data.id}`,
      'PATCH',
      { status: 'DRAFT' },
    )
    expect((await unpublished.json() as { data: { publishedAt: string } }).data.publishedAt).toBe(FIXED_NOW.toISOString())
    expect((await app.request('/api/v1/countries/germany')).status).toBe(404)

    expect((await adminRequest(
      `/api/v1/admin/countries/${created.body.data.id}`,
      'PATCH',
      { status: 'ARCHIVED' },
    )).status).toBe(200)
    expect((await app.request('/api/v1/countries/germany')).status).toBe(404)
    const archived = await adminRequest('/api/v1/admin/countries?status=ARCHIVED')
    await expect(archived.json()).resolves.toMatchObject({ data: { pagination: { total: 1 } } })
  })

  it('returns actionable validation, duplicate-slug, invalid-UUID, and unknown-ID errors', async () => {
    const invalid = await adminRequest('/api/v1/admin/countries', 'POST', { slug: 'Invalid Slug' })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: { nameAr: expect.any(Array) } } },
    })

    await createCountry()
    const duplicate = await adminRequest('/api/v1/admin/countries', 'POST', countryInput())
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: 'SLUG_CONFLICT' } })

    expect((await adminRequest('/api/v1/admin/countries/not-a-uuid')).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/countries/22222222-2222-4222-8222-222222222222')).status).toBe(404)
  })

  it('requires a valid Country for universities and retrieves related content', async () => {
    const invalid = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة', officialName: 'University', slug: 'university',
      countryId: '22222222-2222-4222-8222-222222222222', cityAr: 'مدينة', overviewAr: 'نظرة عامة',
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'RELATIONSHIP_INVALID' } })

    const country = await createCountry({ ...countryInput(), status: 'PUBLISHED' })
    const university = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-university',
      countryId: country.body.data.id, cityAr: 'برلين', overviewAr: 'نظرة عامة', status: 'PUBLISHED',
    })
    expect(university.status).toBe(201)
    const publicResponse = await app.request('/api/v1/universities/berlin-university')
    expect(publicResponse.status).toBe(200)
    await expect(publicResponse.json()).resolves.toMatchObject({ data: { countryId: country.body.data.id } })
  })

  it('enforces scholarship publication source and relationship consistency', async () => {
    const firstCountry = await createCountry({ ...countryInput('germany'), status: 'PUBLISHED' })
    const secondCountry = await createCountry({ ...countryInput('france'), nameAr: 'فرنسا', status: 'PUBLISHED' })
    const universityResponse = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-university',
      countryId: firstCountry.body.data.id, cityAr: 'برلين', overviewAr: 'نظرة عامة', status: 'PUBLISHED',
    })
    const university = await universityResponse.json() as { data: { id: string } }
    const base = {
      titleAr: 'منحة', slug: 'scholarship', studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'المتطلبات', descriptionAr: 'الوصف', countryId: firstCountry.body.data.id,
      universityId: university.data.id,
    }

    const noSource = await adminRequest('/api/v1/admin/scholarships', 'POST', { ...base, status: 'PUBLISHED' })
    expect(noSource.status).toBe(400)
    await expect(noSource.json()).resolves.toMatchObject({ error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET' } })

    const inconsistent = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      ...base, countryId: secondCountry.body.data.id,
    })
    expect(inconsistent.status).toBe(400)
    await expect(inconsistent.json()).resolves.toMatchObject({ error: { code: 'RELATIONSHIP_INVALID' } })
  })

  it('derives a passed scholarship deadline as CLOSED without hiding or archiving it', async () => {
    const response = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة مغلقة', slug: 'closed-scholarship', studyLevel: 'BACHELORS', fundingType: 'FULL',
      requirementsAr: 'المتطلبات', descriptionAr: 'الوصف', applicationStatus: 'OPEN',
      verifiedDeadline: '2026-10-18T23:59:59.000Z', officialSourceUrl: 'https://example.edu/scholarship',
      status: 'PUBLISHED',
    })
    expect(response.status).toBe(201)

    const publicResponse = await app.request('/api/v1/scholarships/closed-scholarship')
    expect(publicResponse.status).toBe(200)
    await expect(publicResponse.json()).resolves.toMatchObject({
      data: { effectiveApplicationStatus: 'CLOSED' },
    })
    const filtered = await app.request('/api/v1/scholarships?applicationStatus=CLOSED')
    await expect(filtered.json()).resolves.toMatchObject({ data: { pagination: { total: 1 } } })
    const adminBody = await response.json() as { data: { status: string } }
    expect(adminBody.data.status).toBe('PUBLISHED')
  })

  it('validates and stores safe structured article blocks with optional relationships', async () => {
    const country = await createCountry({ ...countryInput(), status: 'PUBLISHED' })
    const invalid = await adminRequest('/api/v1/admin/articles', 'POST', {
      titleAr: 'مقال', slug: 'article', summaryAr: 'ملخص', bodyAr: [{ type: 'html', text: '<script>' }],
    })
    expect(invalid.status).toBe(400)

    const valid = await adminRequest('/api/v1/admin/articles', 'POST', {
      titleAr: 'مقال', slug: 'article', summaryAr: 'ملخص',
      bodyAr: [{ type: 'paragraph', text: 'نص آمن يعرض كنص عادي' }],
      countryId: country.body.data.id, status: 'PUBLISHED',
    })
    expect(valid.status).toBe(201)
    expect((await app.request('/api/v1/articles/article')).status).toBe(200)
    const related = await app.request('/api/v1/articles?country=germany')
    await expect(related.json()).resolves.toMatchObject({ data: { pagination: { total: 1 } } })
  })

  it('paginates, filters featured records, and applies deterministic manual ordering', async () => {
    await adminRequest('/api/v1/admin/services', 'POST', { ...serviceInput('second', 20), featured: false })
    await adminRequest('/api/v1/admin/services', 'POST', { ...serviceInput('first', 10), featured: true })

    const response = await app.request('/api/v1/services?featured=true&page=1&limit=1&sort=manual')
    const body = await response.json() as {
      data: { items: Array<{ slug: string }>; pagination: { page: number; limit: number; total: number; totalPages: number } }
    }
    expect(body.data.items.map((item) => item.slug)).toEqual(['first'])
    expect(body.data.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 })
    const defaults = await app.request('/api/v1/services')
    await expect(defaults.json()).resolves.toMatchObject({
      data: { pagination: { page: 1, limit: 12, total: 2, totalPages: 1 } },
    })
    expect((await app.request('/api/v1/services?limit=51')).status).toBe(400)
    expect((await app.request('/api/v1/services?page=0')).status).toBe(400)
  })

  it('documents all 30 content operations and exposes no DELETE content operation', async () => {
    const response = await app.request('/openapi.json')
    const document = await response.json() as {
      paths: Record<string, Record<string, { tags?: string[] }>>
    }
    for (const resource of ['countries', 'universities', 'scholarships', 'services', 'articles']) {
      expect(document.paths[`/api/v1/${resource}`]?.get).toBeDefined()
      expect(document.paths[`/api/v1/${resource}/{slug}`]?.get).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}`]?.get).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}`]?.post).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}/{id}`]?.get).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}/{id}`]?.patch).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}/{id}`]?.delete).toBeUndefined()
      const label = resource[0]?.toUpperCase() + resource.slice(1)
      expect(document.paths[`/api/v1/${resource}`]?.get?.tags).toEqual([`Public — ${label}`])
      expect(document.paths[`/api/v1/admin/${resource}`]?.post?.tags).toEqual(['Admin — Content Management'])
    }
  })
})
