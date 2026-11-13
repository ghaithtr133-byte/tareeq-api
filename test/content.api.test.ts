import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import type { ContentRuntime } from '../src/content/runtime.js'
import { ContentService } from '../src/content/service.js'
import { impactItem } from '../src/content/deletion-impact.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryContentRepository } from './helpers/in-memory-content-repository.js'

const ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const JWT_SECRET = 'content-api-test-secret-that-is-longer-than-thirty-two-characters'
const FIXED_NOW = new Date('2026-10-19T12:00:00.000Z')
const ADMIN_ID = 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20'
const SUPER_ADMIN_ID = '11111111-1111-4111-8111-111111111111'

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
  imageUrl: 'https://example.invalid/country.webp',
  imageAltAr: 'صورة للدراسة في ألمانيا',
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
  let contentRepository: InMemoryContentRepository
  let contentService: ContentService

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superAdminToken = await signAccessToken(
      { id: SUPER_ADMIN_ID, role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
  })

  beforeEach(() => {
    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({
      id: ADMIN_ID,
      name: 'Content Admin',
      email: 'content-admin@example.invalid',
      passwordHash: '$argon2id$test-only',
      role: 'ADMIN',
      isActive: true,
    })
    authRepository.addUser({
      id: SUPER_ADMIN_ID,
      name: 'Super Admin',
      email: 'super-admin@example.invalid',
      passwordHash: '$argon2id$test-only',
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(authRepository, JWT_SECRET),
    }
    contentRepository = new InMemoryContentRepository()
    contentService = new ContentService(
      contentRepository,
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

  it('labels recognized published Scholarship facets and leaves unknown values unlabeled', async () => {
    const create = (slug: string, studyLevel: string, fundingType: string, status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') => contentService.create('scholarships', {
      titleAr: slug, slug, studyLevel, fundingType, summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف',
      officialSourceUrl: 'https://example.invalid/source', status,
    }, ADMIN_ID)
    await create('government-scholarship', 'ASSOCIATE_BACHELOR_MASTER_PHD', 'GOVERNMENT_FUNDED')
    await contentRepository.create('scholarships', {
      titleAr: 'stipend-scholarship', slug: 'stipend-scholarship', studyLevel: 'MASTER', fundingType: 'TUITION_AND_STIPEND', summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/source', status: 'PUBLISHED', publishedAt: FIXED_NOW,
    }, { actorAdminId: ADMIN_ID, action: 'test.legacy.created', resourceType: 'SCHOLARSHIP', metadata: {} })
    await contentRepository.create('scholarships', {
      titleAr: 'unknown-scholarship', slug: 'unknown-scholarship', studyLevel: 'test', fundingType: 'test', summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/source', status: 'PUBLISHED', publishedAt: FIXED_NOW,
    }, { actorAdminId: ADMIN_ID, action: 'test.legacy.created', resourceType: 'SCHOLARSHIP', metadata: {} })
    await contentRepository.create('scholarships', {
      titleAr: 'draft-scholarship', slug: 'draft-scholarship', studyLevel: 'MASTER', fundingType: 'GOVERNMENT_FUNDED', summaryAr: null, requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    }, { actorAdminId: ADMIN_ID, action: 'test.legacy.created', resourceType: 'SCHOLARSHIP', metadata: {} })
    await expect(app.request('/api/v1/scholarships/filter-options')).resolves.toMatchObject({ status: 200 })
    const result = await contentService.scholarshipFilterOptions()
    expect(result.studyLevels).toEqual(expect.arrayContaining([
      { value: 'ASSOCIATE_BACHELOR_MASTER_PHD', labelAr: 'دبلوم مشارك، بكالوريوس، ماجستير ودكتوراه', count: 1 },
      { value: 'MASTER', labelAr: 'ماجستير', count: 1 },
      { value: 'test', labelAr: null, count: 1 },
    ]))
    expect(result.fundingTypes).toEqual(expect.arrayContaining([
      { value: 'GOVERNMENT_FUNDED', labelAr: 'ممولة حكومياً', count: 1 },
      { value: 'TUITION_AND_STIPEND', labelAr: 'رسوم دراسية ومخصصات', count: 1 },
      { value: 'test', labelAr: null, count: 1 },
    ]))
  })

  it('preserves unseeded legacy Scholarship codes on unrelated updates while rejecting new unknown or inactive selections', async () => {
    const legacy = await contentRepository.create('scholarships', {
      titleAr: 'منحة قديمة', slug: 'legacy-demo-only', studyLevel: 'test', fundingType: 'DEMO_ONLY', summaryAr: null, requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'PUBLISHED', publishedAt: FIXED_NOW,
    }, { actorAdminId: ADMIN_ID, action: 'test.legacy.created', resourceType: 'SCHOLARSHIP', metadata: {} })
    expect((await adminRequest(`/api/v1/admin/scholarships/${legacy.id}`, 'PATCH', { descriptionAr: 'وصف محدث' })).status).toBe(200)
    const unknown = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة غير معروفة', slug: 'new-unknown-option', studyLevel: 'test', fundingType: 'DEMO_ONLY', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    })
    expect(unknown.status).toBe(400)
    const inactive = contentRepository.scholarshipOptions.find((option) => option.type === 'FUNDING_TYPE' && option.code === 'FULL')!
    inactive.isActive = false
    const inactiveSelection = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة غير نشطة', slug: 'new-inactive-option', studyLevel: 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    })
    expect(inactiveSelection.status).toBe(400)
  })

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

  it('exposes the complete-set Country reorder route before the dynamic ID route', async () => {
    const first = await createCountry(countryInput('first-country'))
    const second = await createCountry(countryInput('second-country'))
    const orderedIds = [second.body.data.id, first.body.data.id]

    const unauthenticated = await app.request('/api/v1/admin/countries/order', {
      method: 'PATCH',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
    expect(unauthenticated.status).toBe(401)

    const reordered = await adminRequest('/api/v1/admin/countries/order', 'PATCH', { orderedIds })
    expect(reordered.status).toBe(200)
    await expect(reordered.json()).resolves.toMatchObject({
      success: true,
      data: { items: [
        { id: second.body.data.id, displayOrder: 0 },
        { id: first.body.data.id, displayOrder: 1 },
      ] },
    })
    expect(contentRepository.audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorAdminId: ADMIN_ID,
        action: 'content.countries.reordered',
        resourceType: 'COUNTRY',
        resourceId: second.body.data.id,
        metadata: { count: 2 },
      }),
    ]))

    const incomplete = await adminRequest('/api/v1/admin/countries/order', 'PATCH', {
      orderedIds: [first.body.data.id],
    })
    expect(incomplete.status).toBe(409)
    await expect(incomplete.json()).resolves.toMatchObject({ error: { code: 'ORDER_SET_MISMATCH' } })

    const duplicate = await adminRequest('/api/v1/admin/countries/order', 'PATCH', {
      orderedIds: [first.body.data.id, first.body.data.id],
    })
    expect(duplicate.status).toBe(400)
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    const openApi = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, { patch?: { security?: unknown[]; responses?: Record<string, unknown> } }>
    }
    for (const resource of ['countries', 'universities', 'scholarships', 'services', 'articles']) {
      const operation = openApi.paths[`/api/v1/admin/${resource}/order`]?.patch
      expect(operation?.security).toEqual([{ accessCookie: [] }])
      expect(operation?.responses).toHaveProperty('200')
      expect(operation?.responses).toHaveProperty('409')
    }
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
      countryId: country.body.data.id, cityAr: 'برلين', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    })
    expect(university.status).toBe(201)
    const publicResponse = await app.request('/api/v1/universities/berlin-university')
    expect(publicResponse.status).toBe(200)
    await expect(publicResponse.json()).resolves.toMatchObject({ data: { countryId: country.body.data.id } })
  })

  it('requires a non-empty summary only when Scholarships and Universities enter publication', async () => {
    const country = await createCountry({ ...countryInput('summary-policy-country'), status: 'PUBLISHED' })
    const universityDraft = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة مسودة الملخص', officialName: 'Summary Draft University', slug: 'summary-draft-university',
      countryId: country.body.data.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'DRAFT',
    })
    expect(universityDraft.status).toBe(201)
    const universityId = (await universityDraft.json() as { data: { id: string } }).data.id
    const universityMissingSummary = await adminRequest(`/api/v1/admin/universities/${universityId}`, 'PATCH', { status: 'PUBLISHED' })
    expect(universityMissingSummary.status).toBe(400)
    await expect(universityMissingSummary.json()).resolves.toMatchObject({
      error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET', details: { fields: { summaryAr: expect.any(Array) } } },
    })
    expect((await adminRequest(`/api/v1/admin/universities/${universityId}`, 'PATCH', { summaryAr: 'ملخص الجامعة', status: 'PUBLISHED' })).status).toBe(200)

    const scholarshipDraft = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة مسودة الملخص', slug: 'summary-draft-scholarship', studyLevel: 'BACHELORS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/summary-draft', status: 'DRAFT',
    })
    expect(scholarshipDraft.status).toBe(201)
    const scholarshipId = (await scholarshipDraft.json() as { data: { id: string } }).data.id
    expect((await adminRequest(`/api/v1/admin/scholarships/${scholarshipId}`, 'PATCH', { status: 'PUBLISHED' })).status).toBe(400)
    expect((await adminRequest(`/api/v1/admin/scholarships/${scholarshipId}`, 'PATCH', { summaryAr: 'ملخص المنحة', status: 'PUBLISHED' })).status).toBe(200)

    const directPublishedUniversity = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة دون ملخص', officialName: 'No Summary University', slug: 'no-summary-university',
      countryId: country.body.data.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'PUBLISHED',
    })
    expect(directPublishedUniversity.status).toBe(400)
    await expect(directPublishedUniversity.json()).resolves.toMatchObject({
      error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET', details: { fields: { summaryAr: expect.any(Array) } } },
    })
    const directPublishedScholarship = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة دون ملخص', slug: 'no-summary-scholarship', studyLevel: 'BACHELORS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/no-summary', status: 'PUBLISHED',
    })
    expect(directPublishedScholarship.status).toBe(400)
    await expect(directPublishedScholarship.json()).resolves.toMatchObject({
      error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET', details: { fields: { summaryAr: expect.any(Array) } } },
    })
    const whitespaceSummary = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة ملخص فارغ', slug: 'whitespace-summary-scholarship', studyLevel: 'BACHELORS', fundingType: 'FULL',
      summaryAr: '   ', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/whitespace-summary', status: 'PUBLISHED',
    })
    expect(whitespaceSummary.status).toBe(400)
    await expect(whitespaceSummary.json()).resolves.toMatchObject({
      error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET', details: { fields: { summaryAr: expect.any(Array) } } },
    })

    const legacyPublished = await contentRepository.create('universities', {
      nameAr: 'جامعة قديمة', officialName: 'Legacy University', slug: 'legacy-summary-university',
      countryId: country.body.data.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'PUBLISHED', publishedAt: FIXED_NOW,
    }, { actorAdminId: ADMIN_ID, action: 'test.legacy.created', resourceType: 'UNIVERSITY', metadata: {} })
    expect((await adminRequest(`/api/v1/admin/universities/${legacyPublished.id}`, 'PATCH', { officialWebsite: 'https://example.invalid/legacy' })).status).toBe(200)
  })

  it('supports assigned ISO country codes, independent University logos, and public relationship summaries', async () => {
    const country = await createCountry({ ...countryInput(), countryCode: 'de', status: 'PUBLISHED' })
    const university = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-logo-university', countryId: country.body.data.id,
      cityAr: 'برلين', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', logoUrl: 'https://example.invalid/logo.webp', logoAltAr: 'شعار الجامعة', status: 'PUBLISHED',
    })
    expect(university.status).toBe(201)
    await expect((await app.request('/api/v1/universities/berlin-logo-university')).json()).resolves.toMatchObject({ data: { logoUrl: 'https://example.invalid/logo.webp', country: { countryCode: 'DE' } } })
    expect((await adminRequest('/api/v1/admin/countries', 'POST', { ...countryInput('invalid-code'), countryCode: 'ZZ' })).status).toBe(400)
  })

  it('enforces scholarship publication source and relationship consistency', async () => {
    const firstCountry = await createCountry({ ...countryInput('germany'), status: 'PUBLISHED' })
    const secondCountry = await createCountry({ ...countryInput('france'), nameAr: 'فرنسا', status: 'PUBLISHED' })
    const universityResponse = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-university',
      countryId: firstCountry.body.data.id, cityAr: 'برلين', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    })
    const university = await universityResponse.json() as { data: { id: string } }
    const base = {
      titleAr: 'منحة', slug: 'scholarship', studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'المتطلبات', descriptionAr: 'الوصف', countryId: firstCountry.body.data.id,
      universityId: university.data.id, imageUrl: 'https://res.cloudinary.com/example/image/upload/scholarship.webp',
      imageAltAr: 'صورة المنحة',
    }

    const noSource = await adminRequest('/api/v1/admin/scholarships', 'POST', { ...base, status: 'PUBLISHED' })
    expect(noSource.status).toBe(400)
    await expect(noSource.json()).resolves.toMatchObject({ error: { code: 'PUBLICATION_REQUIREMENTS_NOT_MET' } })

    const inconsistent = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      ...base, countryId: secondCountry.body.data.id,
    })
    expect(inconsistent.status).toBe(400)
    await expect(inconsistent.json()).resolves.toMatchObject({ error: { code: 'RELATIONSHIP_INVALID' } })

    const created = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      ...base,
      slug: 'scholarship-with-image',
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({
      data: {
        imageUrl: base.imageUrl,
        imageAltAr: base.imageAltAr,
      },
    })
  })

  it('derives a passed scholarship deadline as CLOSED without hiding or archiving it', async () => {
    const response = await adminRequest('/api/v1/admin/scholarships', 'POST', {
      titleAr: 'منحة مغلقة', slug: 'closed-scholarship', studyLevel: 'BACHELORS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة', requirementsAr: 'المتطلبات', descriptionAr: 'الوصف', applicationStatus: 'OPEN',
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

  it('paginates related University scholarships and preserves effective CLOSED status', async () => {
    const country = await createCountry({ ...countryInput('romania'), status: 'PUBLISHED' })
    const universityResponse = await adminRequest('/api/v1/admin/universities', 'POST', {
      nameAr: 'جامعة بوخارست', officialName: 'Bucharest University', slug: 'bucharest-university',
      countryId: country.body.data.id, cityAr: 'بوخارست', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    })
    const universityId = (await universityResponse.json() as { data: { id: string } }).data.id
    for (let index = 1; index <= 4; index += 1) {
      const response = await adminRequest('/api/v1/admin/scholarships', 'POST', {
        titleAr: `منحة ${index}`, slug: `related-scholarship-${index}`, studyLevel: 'BACHELORS', fundingType: 'FULL',
        summaryAr: 'ملخص المنحة', requirementsAr: 'المتطلبات', descriptionAr: 'الوصف', countryId: country.body.data.id, universityId,
        applicationStatus: 'OPEN', ...(index === 1 ? { verifiedDeadline: '2026-10-01T00:00:00.000Z' } : {}),
        officialSourceUrl: `https://example.edu/scholarships/${index}`, status: 'PUBLISHED',
      })
      expect(response.status).toBe(201)
    }
    const first = await (await app.request('/api/v1/scholarships?university=bucharest-university&page=1&limit=3')).json() as { data: { items: Array<{ effectiveApplicationStatus: string }>; pagination: { total: number } } }
    const second = await (await app.request('/api/v1/scholarships?university=bucharest-university&page=2&limit=3')).json() as { data: { items: Array<{ effectiveApplicationStatus: string }>; pagination: { total: number } } }
    expect(first.data.pagination.total).toBe(4)
    expect(second.data.items).toHaveLength(1)
    expect([...first.data.items, ...second.data.items].some(({ effectiveApplicationStatus }) => effectiveApplicationStatus === 'CLOSED')).toBe(true)
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

  it('supports zero, legacy-single, and ordered multiple Article Scholarship associations', async () => {
    const country = await createCountry({ ...countryInput(), status: 'PUBLISHED' })
    const scholarship = async (slug: string, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', deadline?: string) => {
      const response = await adminRequest('/api/v1/admin/scholarships', 'POST', {
        titleAr: `منحة ${slug}`, slug, studyLevel: 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف',
        summaryAr: 'ملخص المنحة',
        countryId: country.body.data.id, applicationStatus: 'OPEN', verifiedDeadline: deadline ?? null,
        officialSourceUrl: status === 'PUBLISHED' ? `https://example.edu/${slug}` : null, status,
      })
      expect(response.status).toBe(201)
      return (await response.json() as { data: { id: string } }).data.id
    }
    const openId = await scholarship('open-related', 'PUBLISHED', '2027-01-01T00:00:00.000Z')
    const closedId = await scholarship('closed-related', 'PUBLISHED', '2026-10-01T00:00:00.000Z')
    const draftId = await scholarship('draft-related', 'DRAFT')
    const archivedId = await scholarship('archived-related', 'ARCHIVED')
    const base = { titleAr: 'مقال', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'PUBLISHED' }

    const zero = await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'zero-related' })
    expect(zero.status).toBe(201)
    await expect((await app.request('/api/v1/articles/zero-related')).json()).resolves.toMatchObject({ data: { scholarshipId: null, relatedScholarships: [] } })

    const legacy = await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'legacy-related', scholarshipId: openId })
    expect(legacy.status).toBe(201)
    await expect(legacy.json()).resolves.toMatchObject({ data: { scholarshipId: openId, scholarshipIds: [openId] } })
    await expect((await app.request('/api/v1/articles/legacy-related')).json()).resolves.toMatchObject({ data: { scholarshipId: openId, relatedScholarships: [{ id: openId }] } })

    const multiple = await adminRequest('/api/v1/admin/articles', 'POST', {
      ...base, slug: 'multiple-related', scholarshipId: closedId,
      scholarshipIds: [closedId, draftId, openId, archivedId],
    })
    expect(multiple.status).toBe(201)
    const multipleBody = await multiple.json() as { data: { id: string; scholarshipIds: string[] } }
    expect(multipleBody.data.scholarshipIds).toEqual([closedId, draftId, openId, archivedId])

    const publicDetail = await (await app.request('/api/v1/articles/multiple-related')).json() as { data: { relatedScholarships: Array<{ id: string; effectiveApplicationStatus: string; country: { id: string } | null }> } }
    expect(publicDetail.data.relatedScholarships.map(({ id }) => id)).toEqual([closedId, openId])
    expect(publicDetail.data.relatedScholarships).toEqual([
      expect.objectContaining({ id: closedId, effectiveApplicationStatus: 'CLOSED', country: { id: country.body.data.id, slug: 'germany', nameAr: 'ألمانيا' } }),
      expect.objectContaining({ id: openId, effectiveApplicationStatus: 'OPEN' }),
    ])

    const listing = await (await app.request('/api/v1/articles')).json() as { data: { items: Array<Record<string, unknown>> } }
    expect(listing.data.items.find(({ slug }) => slug === 'multiple-related')).not.toHaveProperty('relatedScholarships')
    expect(listing.data.items.find(({ slug }) => slug === 'multiple-related')).not.toHaveProperty('scholarshipIds')

    expect((await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'duplicates', scholarshipIds: [openId, openId] })).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'malformed', scholarshipIds: ['not-a-uuid'] })).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'missing', scholarshipIds: ['22222222-2222-4222-8222-222222222222'] })).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'contradictory', scholarshipId: openId, scholarshipIds: [closedId, openId] })).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/articles', 'POST', { ...base, slug: 'contradictory-null', scholarshipId: null, scholarshipIds: [openId] })).status).toBe(400)

    expect((await adminRequest(`/api/v1/admin/articles/${multipleBody.data.id}`, 'PATCH', { summaryAr: 'ملخص محدث' })).status).toBe(200)
    await expect((await adminRequest(`/api/v1/admin/articles/${multipleBody.data.id}`)).json()).resolves.toMatchObject({ data: { scholarshipIds: [closedId, draftId, openId, archivedId] } })

    const replaced = await adminRequest(`/api/v1/admin/articles/${multipleBody.data.id}`, 'PATCH', { scholarshipIds: [openId, closedId] })
    await expect(replaced.json()).resolves.toMatchObject({ data: { scholarshipId: openId, scholarshipIds: [openId, closedId] } })
    const legacyReplaced = await adminRequest(`/api/v1/admin/articles/${multipleBody.data.id}`, 'PATCH', { scholarshipId: closedId })
    await expect(legacyReplaced.json()).resolves.toMatchObject({ data: { scholarshipId: closedId, scholarshipIds: [closedId] } })
    const cleared = await adminRequest(`/api/v1/admin/articles/${multipleBody.data.id}`, 'PATCH', { scholarshipIds: [] })
    await expect(cleared.json()).resolves.toMatchObject({ data: { scholarshipId: null, scholarshipIds: [], relatedScholarships: [] } })
  })

  it('rolls back Article association replacement when its audit write fails', async () => {
    const createScholarship = async (slug: string) => {
      const response = await adminRequest('/api/v1/admin/scholarships', 'POST', {
        titleAr: slug, slug, studyLevel: 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
      })
      return (await response.json() as { data: { id: string } }).data.id
    }
    const firstId = await createScholarship('audit-first')
    const secondId = await createScholarship('audit-second')
    const created = await adminRequest('/api/v1/admin/articles', 'POST', {
      titleAr: 'مقال', slug: 'audit-article', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], scholarshipIds: [firstId],
    })
    const articleId = (await created.json() as { data: { id: string } }).data.id
    const successfulAudit = contentRepository.audit.events.at(-1)
    expect(successfulAudit).toMatchObject({ action: 'content.article.created', metadata: { scholarshipAssociationCount: 1 } })
    expect(JSON.stringify(successfulAudit)).not.toContain(firstId)

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    contentRepository.audit.failNextWrite = true
    const failed = await adminRequest(`/api/v1/admin/articles/${articleId}`, 'PATCH', { scholarshipIds: [secondId] })
    expect(failed.status).toBe(500)
    await expect((await adminRequest(`/api/v1/admin/articles/${articleId}`)).json()).resolves.toMatchObject({ data: { scholarshipId: firstId, scholarshipIds: [firstId] } })
    log.mockRestore()
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

  it('uses persisted Admin order for every published public directory and keeps drafts private', async () => {
    await expect((await app.request('/api/v1/articles')).json()).resolves.toMatchObject({ data: { items: [] } })

    const firstCountry = await contentService.create('countries', {
      nameAr: 'البلد الأول', slug: 'ordered-country-first', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', imageUrl: 'https://example.edu/country-first.webp', imageAltAr: 'صورة البلد الأول', status: 'PUBLISHED',
    }, ADMIN_ID)
    const secondCountry = await contentService.create('countries', {
      nameAr: 'البلد الثاني', slug: 'ordered-country-second', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', imageUrl: 'https://example.edu/country-second.webp', imageAltAr: 'صورة البلد الثاني', status: 'PUBLISHED',
    }, ADMIN_ID)
    const firstUniversity = await contentService.create('universities', {
      nameAr: 'الجامعة الأولى', officialName: 'First University', slug: 'ordered-university-first', countryId: firstCountry.id,
      cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    }, ADMIN_ID)
    const secondUniversity = await contentService.create('universities', {
      nameAr: 'الجامعة الثانية', officialName: 'Second University', slug: 'ordered-university-second', countryId: firstCountry.id,
      cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    }, ADMIN_ID)
    const firstScholarship = await contentService.create('scholarships', {
      titleAr: 'المنحة الأولى', slug: 'ordered-scholarship-first', studyLevel: 'MASTERS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/ordered-first', status: 'PUBLISHED',
    }, ADMIN_ID)
    const secondScholarship = await contentService.create('scholarships', {
      titleAr: 'المنحة الثانية', slug: 'ordered-scholarship-second', studyLevel: 'MASTERS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/ordered-second', status: 'PUBLISHED',
    }, ADMIN_ID)
    const firstService = await contentService.create('services', {
      titleAr: 'الخدمة الأولى', slug: 'ordered-service-first', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    const secondService = await contentService.create('services', {
      titleAr: 'الخدمة الثانية', slug: 'ordered-service-second', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    const firstArticle = await contentService.create('articles', {
      titleAr: 'المقال الأول', slug: 'ordered-article-first', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'PUBLISHED',
    }, ADMIN_ID)
    const secondArticle = await contentService.create('articles', {
      titleAr: 'المقال الثاني', slug: 'ordered-article-second', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'PUBLISHED',
    }, ADMIN_ID)
    const draftArticle = await contentService.create('articles', {
      titleAr: 'مسودة', slug: 'ordered-article-draft', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'DRAFT',
    }, ADMIN_ID)
    await contentService.update('articles', draftArticle.id, { status: 'ARCHIVED' }, ADMIN_ID)

    const collections = [
      ['countries', firstCountry, secondCountry],
      ['universities', firstUniversity, secondUniversity],
      ['scholarships', firstScholarship, secondScholarship],
      ['services', firstService, secondService],
      ['articles', firstArticle, secondArticle],
    ] as const
    for (const [resource, first, second] of collections) {
      expect((await adminRequest(`/api/v1/admin/${resource}/order`, 'PATCH', { orderedIds: [second.id, first.id] })).status).toBe(200)
      const response = await app.request(`/api/v1/${resource}?page=1&limit=50`)
      const body = await response.json() as { data: { items: Array<{ id: string }> } }
      expect(body.data.items.map(({ id }) => id)).toEqual([second.id, first.id])
    }
    const articles = await (await app.request('/api/v1/articles?limit=50')).json() as { data: { items: Array<{ id: string }> } }
    expect(articles.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: draftArticle.id })]))
  })

  it('keeps matching Featured Scholarships first before manual and explicit sorting across pages', async () => {
    const scholarship = async (slug: string, featured: boolean, fundingType: string, verifiedDeadline: string) =>
      contentService.create('scholarships', {
        titleAr: slug, slug, studyLevel: 'MASTERS', fundingType, requirementsAr: 'متطلبات', descriptionAr: 'وصف',
        summaryAr: 'ملخص المنحة', officialSourceUrl: `https://example.edu/${slug}`, verifiedDeadline, featured, status: 'PUBLISHED',
      }, ADMIN_ID)
    const nonFeaturedFirst = await scholarship('non-featured-first', false, 'FULL', '2027-01-01T00:00:00.000Z')
    const featuredLate = await scholarship('featured-late', true, 'FULL', '2030-01-01T00:00:00.000Z')
    const featuredEarly = await scholarship('featured-early', true, 'FULL', '2028-01-01T00:00:00.000Z')
    const nonFeaturedSecond = await scholarship('non-featured-second', false, 'FULL', '2026-12-01T00:00:00.000Z')
    const filteredFeatured = await scholarship('filtered-featured', true, 'PARTIAL', '2027-01-01T00:00:00.000Z')
    const orderedIds = [nonFeaturedFirst.id, featuredLate.id, featuredEarly.id, nonFeaturedSecond.id, filteredFeatured.id]
    expect((await adminRequest('/api/v1/admin/scholarships/order', 'PATCH', { orderedIds })).status).toBe(200)

    const firstPage = await (await app.request('/api/v1/scholarships?page=1&limit=2')).json() as { data: { items: Array<{ id: string }>; pagination: { total: number; totalPages: number } } }
    const secondPage = await (await app.request('/api/v1/scholarships?page=2&limit=2')).json() as { data: { items: Array<{ id: string }> } }
    expect(firstPage.data.items.map(({ id }) => id)).toEqual([featuredLate.id, featuredEarly.id])
    expect(secondPage.data.items.map(({ id }) => id)).toEqual([filteredFeatured.id, nonFeaturedFirst.id])
    expect(firstPage.data.pagination).toMatchObject({ total: 5, totalPages: 3 })

    const deadlineOrder = await (await app.request('/api/v1/scholarships?sort=deadline&limit=50')).json() as { data: { items: Array<{ id: string }> } }
    expect(deadlineOrder.data.items.map(({ id }) => id)).toEqual([
      filteredFeatured.id, featuredEarly.id, featuredLate.id, nonFeaturedSecond.id, nonFeaturedFirst.id,
    ])

    const newestOrder = await (await app.request('/api/v1/scholarships?sort=newest&limit=50')).json() as { data: { items: Array<{ id: string }> } }
    expect(newestOrder.data.items.slice(0, 3).map(({ id }) => id)).toEqual(expect.arrayContaining([
      featuredLate.id, featuredEarly.id, filteredFeatured.id,
    ]))
    expect(newestOrder.data.items.slice(3).map(({ id }) => id)).toEqual(expect.arrayContaining([
      nonFeaturedFirst.id, nonFeaturedSecond.id,
    ]))

    const fullOnly = await (await app.request('/api/v1/scholarships?fundingType=FULL&limit=50')).json() as { data: { items: Array<{ id: string }> } }
    expect(fullOnly.data.items.map(({ id }) => id)).toEqual([
      featuredLate.id, featuredEarly.id, nonFeaturedFirst.id, nonFeaturedSecond.id,
    ])
  })

  it('places new default-order records predictably ahead of simulated legacy backfills and keeps ties stable', async () => {
    const country = await contentService.create('countries', {
      nameAr: 'بلد الترتيب', slug: 'ordering-country', introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
      imageUrl: 'https://example.edu/ordering-country.webp', imageAltAr: 'صورة بلد الترتيب', status: 'PUBLISHED',
    }, ADMIN_ID)
    const legacyFirst = await contentService.create('universities', {
      nameAr: 'جامعة قديمة أولى', officialName: 'Legacy First', slug: 'legacy-order-first', countryId: country.id,
      cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', displayOrder: 10, status: 'PUBLISHED',
    }, ADMIN_ID)
    const legacySecond = await contentService.create('universities', {
      nameAr: 'جامعة قديمة ثانية', officialName: 'Legacy Second', slug: 'legacy-order-second', countryId: country.id,
      cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', displayOrder: 10, status: 'PUBLISHED',
    }, ADMIN_ID)
    const newlyCreated = await contentService.create('universities', {
      nameAr: 'جامعة جديدة', officialName: 'New University', slug: 'new-default-order-university', countryId: country.id,
      cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    }, ADMIN_ID)

    const firstRead = await (await app.request('/api/v1/universities?limit=50')).json() as { data: { items: Array<{ id: string; displayOrder: number }> } }
    const secondRead = await (await app.request('/api/v1/universities?limit=50')).json() as { data: { items: Array<{ id: string; displayOrder: number }> } }
    expect(firstRead.data.items[0]).toMatchObject({ id: newlyCreated.id, displayOrder: 0 })
    expect(firstRead.data.items.map(({ id }) => id)).toEqual(secondRead.data.items.map(({ id }) => id))
    expect(firstRead.data.items.map(({ id }) => id)).toEqual(expect.arrayContaining([legacyFirst.id, legacySecond.id]))
  })

  it('safely hard deletes only independent non-published records and reports relationship impacts', async () => {
    const safe = await contentService.create('services', {
      titleAr: 'خدمة مستقلة', slug: 'independent-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'DRAFT',
    }, ADMIN_ID)
    expect((await app.request(`/api/v1/admin/services/${safe.id}`, { method: 'DELETE', headers: { Origin: ORIGIN } })).status).toBe(401)
    const deleted = await adminRequest(`/api/v1/admin/services/${safe.id}`, 'DELETE')
    expect(deleted.status).toBe(200)
    await expect(deleted.json()).resolves.toMatchObject({ success: true, data: { id: safe.id, impact: { outcome: 'SAFE', target: { id: safe.id, status: 'DRAFT' } } } })
    expect((await adminRequest(`/api/v1/admin/services/${safe.id}`)).status).toBe(404)
    expect(contentRepository.audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'content.services.hard_deleted', resourceId: safe.id }),
    ]))
    const safeArticle = await contentService.create('articles', {
      titleAr: 'مقال مستقل', slug: 'independent-article', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'DRAFT',
    }, ADMIN_ID)
    expect((await adminRequest(`/api/v1/admin/articles/${safeArticle.id}`, 'DELETE')).status).toBe(200)
    expect((await adminRequest(`/api/v1/admin/articles/${safeArticle.id}`)).status).toBe(404)
    const superAdminSafe = await contentService.create('services', {
      titleAr: 'خدمة مؤرشفة مستقلة', slug: 'independent-archived-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'ARCHIVED',
    }, ADMIN_ID)
    expect((await adminRequest(`/api/v1/admin/services/${superAdminSafe.id}`, 'DELETE', undefined, 'SUPER_ADMIN')).status).toBe(200)
    expect((await adminRequest('/api/v1/admin/services/not-a-uuid', 'DELETE')).status).toBe(400)
    expect((await adminRequest('/api/v1/admin/services/22222222-2222-4222-8222-222222222222', 'DELETE')).status).toBe(404)

    const published = await contentService.create('services', {
      titleAr: 'خدمة منشورة', slug: 'published-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    const publishedDelete = await adminRequest(`/api/v1/admin/services/${published.id}`, 'DELETE')
    expect(publishedDelete.status).toBe(409)
    await expect(publishedDelete.json()).resolves.toMatchObject({ error: { code: 'DELETE_REQUIRES_CONFIRMATION', details: { impact: { outcome: 'REQUIRES_CONFIRMATION', target: { id: published.id, status: 'PUBLISHED' } } } } })
    expect((await adminRequest(`/api/v1/admin/services/${published.id}`)).status).toBe(200)

    const nestedService = await contentService.create('services', {
      titleAr: 'خدمة تفاصيل', slug: 'service-with-details', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'DRAFT',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', nestedService.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 2, 'service.detailItems', 'SERVICE_DETAILS_CASCADE', { sampleIds: ['20000000-0000-4000-8000-000000000001'] }),
    ])
    const nestedDelete = await adminRequest(`/api/v1/admin/services/${nestedService.id}`, 'DELETE')
    expect(nestedDelete.status).toBe(409)
    await expect(nestedDelete.json()).resolves.toMatchObject({ error: { code: 'DELETE_REQUIRES_CONFIRMATION', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ effect: 'DELETE', relationshipPath: 'service.detailItems' })]) } } } })

    const country = await contentService.create('countries', {
      nameAr: 'بلد مرتبط', slug: 'country-with-university', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', status: 'DRAFT',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('countries', country.id, [
      impactItem('UNIVERSITY', 'BLOCK', 1, 'country.universities', 'COUNTRY_UNIVERSITIES_RESTRICT', { sampleIds: ['20000000-0000-4000-8000-000000000002'] }),
      impactItem('UNIVERSITY_PROGRAM', 'BLOCK', 1, 'country.universities.programs', 'TRANSITIVE_UNIVERSITY_PROGRAM_RESTRICT'),
    ])
    const countryDelete = await adminRequest(`/api/v1/admin/countries/${country.id}`, 'DELETE')
    expect(countryDelete.status).toBe(409)
    await expect(countryDelete.json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { outcome: 'BLOCKED', items: expect.arrayContaining([expect.objectContaining({ relationshipPath: 'country.universities' }), expect.objectContaining({ relationshipPath: 'country.universities.programs' })]) } } } })

    const university = await contentService.create('universities', {
      nameAr: 'جامعة مرتبطة', officialName: 'Related University', slug: 'university-with-program', countryId: country.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'DRAFT',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('universities', university.id, [
      impactItem('UNIVERSITY_PROGRAM', 'BLOCK', 1, 'university.programs', 'UNIVERSITY_PROGRAMS_RESTRICT'),
      impactItem('UNIVERSITY_GALLERY_IMAGE', 'BLOCK', 1, 'university.galleryImages', 'UNIVERSITY_GALLERY_RESTRICT'),
    ])
    await expect((await adminRequest(`/api/v1/admin/universities/${university.id}`, 'DELETE')).json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ resourceType: 'UNIVERSITY_PROGRAM' }), expect.objectContaining({ resourceType: 'UNIVERSITY_GALLERY_IMAGE' })]) } } } })

    const scholarship = await contentService.create('scholarships', {
      titleAr: 'منحة تفاصيل', slug: 'scholarship-with-details', studyLevel: 'MASTERS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('scholarships', scholarship.id, [
      impactItem('SCHOLARSHIP_DETAIL_ITEM', 'DELETE', 1, 'scholarship.detailItems', 'SCHOLARSHIP_DETAILS_CASCADE'),
      impactItem('STUDENT_APPLICATION', 'BLOCK', 1, 'scholarship.studentApplications', 'STUDENT_APPLICATION_HISTORY_PROTECTED'),
    ])
    await expect((await adminRequest(`/api/v1/admin/scholarships/${scholarship.id}`, 'DELETE')).json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ resourceType: 'SCHOLARSHIP_DETAIL_ITEM' }), expect.objectContaining({ code: 'STUDENT_APPLICATION_HISTORY_PROTECTED' })]) } } } })

    const uncertain = await contentService.create('services', {
      titleAr: 'خدمة غير مؤكدة', slug: 'unknown-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'ARCHIVED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', uncertain.id, [], false)
    await expect((await adminRequest(`/api/v1/admin/services/${uncertain.id}`, 'DELETE')).json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ effect: 'UNKNOWN', code: 'RELATIONSHIP_ANALYSIS_INCOMPLETE' })]) } } } })

    const demo = await contentService.create('services', {
      titleAr: 'خدمة تجريبية', slug: 'demo-e2e-protected-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'ARCHIVED',
    }, ADMIN_ID)
    await expect((await adminRequest(`/api/v1/admin/services/${demo.id}`, 'DELETE')).json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ code: 'DEMO_FIXTURE_PROTECTED' })]) } } } })
    const demoArticle = await contentService.create('articles', {
      titleAr: 'مقال تجريبي', slug: 'demo-e2e-protected-article', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'ARCHIVED',
    }, ADMIN_ID)
    await expect((await adminRequest(`/api/v1/admin/articles/${demoArticle.id}`, 'DELETE')).json()).resolves.toMatchObject({ error: { code: 'DELETE_BLOCKED', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ code: 'DEMO_FIXTURE_PROTECTED' })]) } } } })

    const rollback = await contentService.create('services', {
      titleAr: 'خدمة تدقيق', slug: 'audit-rollback-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'DRAFT',
    }, ADMIN_ID)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    contentRepository.audit.failNextWrite = true
    expect((await adminRequest(`/api/v1/admin/services/${rollback.id}`, 'DELETE')).status).toBe(500)
    expect((await adminRequest(`/api/v1/admin/services/${rollback.id}`)).status).toBe(200)
    log.mockRestore()
  })

  it('requires a fresh SUPER_ADMIN challenge before explicitly confirmed hard deletion', async () => {
    const confirmable = await contentService.create('services', {
      titleAr: 'خدمة مؤكدة', slug: 'confirmed-service-delete', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', confirmable.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 2, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])

    const adminPreflight = await adminRequest(`/api/v1/admin/services/${confirmable.id}`, 'DELETE')
    expect(adminPreflight.status).toBe(409)
    await expect(adminPreflight.json()).resolves.toMatchObject({ error: { code: 'DELETE_REQUIRES_CONFIRMATION', details: { impact: { outcome: 'REQUIRES_CONFIRMATION' } } } })

    const superPreflight = await adminRequest(`/api/v1/admin/services/${confirmable.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    expect(superPreflight.status).toBe(409)
    const superPreflightBody = await superPreflight.json() as { error: { details: { confirmation: { challengeId: string; expiresAt: string } } } }
    expect(superPreflightBody.error.details.confirmation.challengeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(superPreflightBody.error.details.confirmation.expiresAt).toBe('2026-10-19T12:05:00.000Z')

    const forbidden = await adminRequest(
      `/api/v1/admin/services/${confirmable.id}/hard-delete/confirm`,
      'POST',
      { challengeId: superPreflightBody.error.details.confirmation.challengeId },
    )
    expect(forbidden.status).toBe(403)
    expect((await adminRequest(
      `/api/v1/admin/services/${confirmable.id}/hard-delete/confirm`,
      'POST',
      { challengeId: 'not-a-uuid' },
      'SUPER_ADMIN',
    )).status).toBe(400)

    const confirmed = await adminRequest(
      `/api/v1/admin/services/${confirmable.id}/hard-delete/confirm`,
      'POST',
      { challengeId: superPreflightBody.error.details.confirmation.challengeId },
      'SUPER_ADMIN',
    )
    expect(confirmed.status).toBe(200)
    await expect(confirmed.json()).resolves.toMatchObject({ success: true, data: { id: confirmable.id, impact: { outcome: 'REQUIRES_CONFIRMATION' } } })
    expect((await adminRequest(`/api/v1/admin/services/${confirmable.id}`)).status).toBe(404)
    expect(contentRepository.audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorAdminId: SUPER_ADMIN_ID, action: 'content.services.hard_deleted', resourceId: confirmable.id, metadata: expect.objectContaining({ deletionMode: 'CONFIRMED' }) }),
    ]))

    const country = await contentService.create('countries', {
      nameAr: 'بلد للحذف', slug: 'confirmed-country-delete', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', imageUrl: 'https://example.invalid/confirmed-country.webp', imageAltAr: 'صورة بلد للحذف', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('countries', country.id, [
      impactItem('COUNTRY_STUDY_GUIDE_SECTION', 'DELETE', 1, 'country.studyGuideSections', 'COUNTRY_GUIDES_EXPLICIT_DELETE'),
      impactItem('ARTICLE', 'UNLINK', 1, 'country.articles', 'COUNTRY_ARTICLES_UNLINK'),
    ])
    const countryPreflight = await adminRequest(`/api/v1/admin/countries/${country.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const countryChallenge = (await countryPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    expect((await adminRequest(`/api/v1/admin/countries/${country.id}/hard-delete/confirm`, 'POST', { challengeId: countryChallenge }, 'SUPER_ADMIN')).status).toBe(200)

    const universityParent = await contentService.create('countries', {
      nameAr: 'بلد الجامعة', slug: 'university-delete-country', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', imageUrl: 'https://example.invalid/university-country.webp', imageAltAr: 'صورة بلد الجامعة', status: 'PUBLISHED',
    }, ADMIN_ID)
    const university = await contentService.create('universities', {
      nameAr: 'جامعة للحذف', officialName: 'Delete University', slug: 'confirmed-university-delete', countryId: universityParent.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('universities', university.id, [
      impactItem('UNIVERSITY_PROGRAM', 'DELETE', 1, 'university.programs', 'UNIVERSITY_PROGRAMS_EXPLICIT_DELETE'),
      impactItem('SCHOLARSHIP', 'UNLINK', 1, 'university.scholarships', 'UNIVERSITY_SCHOLARSHIPS_UNLINK'),
    ])
    const universityPreflight = await adminRequest(`/api/v1/admin/universities/${university.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const universityChallenge = (await universityPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    expect((await adminRequest(`/api/v1/admin/universities/${university.id}/hard-delete/confirm`, 'POST', { challengeId: universityChallenge }, 'SUPER_ADMIN')).status).toBe(200)

    const scholarship = await contentService.create('scholarships', {
      titleAr: 'منحة للحذف', slug: 'confirmed-scholarship-delete', studyLevel: 'MASTERS', fundingType: 'FULL', summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/confirmed-delete', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('scholarships', scholarship.id, [
      impactItem('SCHOLARSHIP_DETAIL_ITEM', 'DELETE', 1, 'scholarship.detailItems', 'SCHOLARSHIP_DETAILS_EXPLICIT_DELETE'),
      impactItem('ARTICLE_SCHOLARSHIP', 'UNLINK', 1, 'scholarship.relatedArticles', 'SCHOLARSHIP_ARTICLE_LINKS_UNLINK'),
    ])
    const scholarshipPreflight = await adminRequest(`/api/v1/admin/scholarships/${scholarship.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const scholarshipChallenge = (await scholarshipPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    expect((await adminRequest(`/api/v1/admin/scholarships/${scholarship.id}/hard-delete/confirm`, 'POST', { challengeId: scholarshipChallenge }, 'SUPER_ADMIN')).status).toBe(200)

    const article = await contentService.create('articles', {
      titleAr: 'مقال للحذف', slug: 'confirmed-article-delete', summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('articles', article.id, [
      impactItem('ARTICLE_SCHOLARSHIP', 'DELETE', 1, 'article.relatedScholarships', 'ARTICLE_SCHOLARSHIP_LINKS_EXPLICIT_DELETE'),
    ])
    const articlePreflight = await adminRequest(`/api/v1/admin/articles/${article.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    expect(articlePreflight.status).toBe(409)
    const articleChallenge = (await articlePreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    expect((await adminRequest(`/api/v1/admin/articles/${article.id}/hard-delete/confirm`, 'POST', { challengeId: articleChallenge }, 'SUPER_ADMIN')).status).toBe(200)
    expect((await adminRequest(`/api/v1/admin/articles/${article.id}`)).status).toBe(404)
    expect(contentRepository.audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorAdminId: SUPER_ADMIN_ID, action: 'content.articles.hard_deleted', resourceId: article.id }),
    ]))

    const stale = await contentService.create('services', {
      titleAr: 'خدمة متغيرة', slug: 'stale-confirmed-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', stale.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 1, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])
    const stalePreflight = await adminRequest(`/api/v1/admin/services/${stale.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const staleChallenge = (await stalePreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    contentRepository.setDeletionImpact('services', stale.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 2, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])
    const staleConfirm = await adminRequest(`/api/v1/admin/services/${stale.id}/hard-delete/confirm`, 'POST', { challengeId: staleChallenge }, 'SUPER_ADMIN')
    expect(staleConfirm.status).toBe(409)
    await expect(staleConfirm.json()).resolves.toMatchObject({ error: { code: 'DELETE_REQUIRES_CONFIRMATION', details: { impact: { items: expect.arrayContaining([expect.objectContaining({ count: 2 })]) }, confirmation: { challengeId: expect.any(String) } } } })
    expect((await adminRequest(`/api/v1/admin/services/${stale.id}`)).status).toBe(200)

    const expired = await contentService.create('services', {
      titleAr: 'خدمة منتهية', slug: 'expired-confirmed-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'ARCHIVED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', expired.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 1, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])
    const expiredPreflight = await adminRequest(`/api/v1/admin/services/${expired.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const expiredChallenge = (await expiredPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    contentRepository.expireDeletionChallenge(expiredChallenge)
    expect((await adminRequest(`/api/v1/admin/services/${expired.id}/hard-delete/confirm`, 'POST', { challengeId: expiredChallenge }, 'SUPER_ADMIN')).status).toBe(409)
    expect((await adminRequest(`/api/v1/admin/services/${expired.id}`)).status).toBe(200)

    const concurrent = await contentService.create('services', {
      titleAr: 'خدمة متزامنة', slug: 'concurrent-confirmed-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', concurrent.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 1, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])
    const concurrentPreflight = await adminRequest(`/api/v1/admin/services/${concurrent.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const concurrentChallenge = (await concurrentPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    const concurrentResults = await Promise.all([
      adminRequest(`/api/v1/admin/services/${concurrent.id}/hard-delete/confirm`, 'POST', { challengeId: concurrentChallenge }, 'SUPER_ADMIN'),
      adminRequest(`/api/v1/admin/services/${concurrent.id}/hard-delete/confirm`, 'POST', { challengeId: concurrentChallenge }, 'SUPER_ADMIN'),
    ])
    expect(concurrentResults.map(({ status }) => status).sort()).toEqual([200, 404])
    expect((await adminRequest(`/api/v1/admin/services/${concurrent.id}`)).status).toBe(404)

    const rollback = await contentService.create('services', {
      titleAr: 'خدمة تراجع', slug: 'confirmed-rollback-service', summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED',
    }, ADMIN_ID)
    contentRepository.setDeletionImpact('services', rollback.id, [
      impactItem('SERVICE_DETAIL_ITEM', 'DELETE', 1, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
    ])
    const rollbackPreflight = await adminRequest(`/api/v1/admin/services/${rollback.id}`, 'DELETE', undefined, 'SUPER_ADMIN')
    const rollbackChallenge = (await rollbackPreflight.json() as { error: { details: { confirmation: { challengeId: string } } } }).error.details.confirmation.challengeId
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    contentRepository.audit.failNextWrite = true
    expect((await adminRequest(`/api/v1/admin/services/${rollback.id}/hard-delete/confirm`, 'POST', { challengeId: rollbackChallenge }, 'SUPER_ADMIN')).status).toBe(500)
    expect((await adminRequest(`/api/v1/admin/services/${rollback.id}`)).status).toBe(200)
    log.mockRestore()
  })

  it('documents all 45 content operations and exposes five hard-delete confirmation routes', async () => {
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
      expect(document.paths[`/api/v1/admin/${resource}/{id}`]?.delete).toBeDefined()
      expect(document.paths[`/api/v1/admin/${resource}/{id}/hard-delete/confirm`]?.post).toBeDefined()
      const label = resource[0]?.toUpperCase() + resource.slice(1)
      expect(document.paths[`/api/v1/${resource}`]?.get?.tags).toEqual([`Public — ${label}`])
      expect(document.paths[`/api/v1/admin/${resource}`]?.post?.tags).toEqual([`Admin — ${label}`])
    }
  })
})
