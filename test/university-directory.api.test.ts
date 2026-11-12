import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import type { ContentRuntime } from '../src/content/runtime.js'
import { ContentService } from '../src/content/service.js'
import type { UniversityDirectoryRuntime } from '../src/university-directory/runtime.js'
import { UniversityDirectoryService } from '../src/university-directory/service.js'
import { InMemoryAuditRepository } from './helpers/in-memory-audit-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryContentRepository } from './helpers/in-memory-content-repository.js'
import { InMemoryUniversityDirectoryRepository } from './helpers/in-memory-university-directory-repository.js'

const ADMIN_ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ID = '11111111-1111-4111-8111-111111111111'
const COUNTRY_ID = 'c0000000-0000-4000-8000-000000000001'
const JWT_SECRET = 'university-directory-test-secret-longer-than-thirty-two'
const NOW = new Date('2026-11-02T12:00:00.000Z')

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused', jwtSecret: JWT_SECRET,
  allowedOrigins: [ADMIN_ORIGIN], publicAllowedOrigins: [PUBLIC_ORIGIN], isProduction: false,
}

describe('University Programs and advanced directory filters', () => {
  let app: ReturnType<typeof createApp>
  let directoryRepository: InMemoryUniversityDirectoryRepository
  let directoryService: UniversityDirectoryService
  let contentService: ContentService
  let audit: InMemoryAuditRepository
  let adminToken: string
  let superToken: string
  let bucharestId: string
  let clujId: string
  let medicineId: string
  let engineeringId: string
  let universityOneId: string
  let universityTwoId: string
  let legacyUniversityId: string
  let draftUniversityId: string
  let medicineBachelorsId: string
  let bucharestOpenId: string
  let bucharestExpiredId: string
  let bucharestBoundaryId: string
  let clujOpenId: string
  let clujClosedId: string
  let draftUniversityScholarshipId: string
  let draftScholarshipId: string
  let archivedScholarshipId: string

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superToken = await signAccessToken({ id: SUPER_ID, role: 'SUPER_ADMIN' }, JWT_SECRET)
  })

  beforeEach(async () => {
    audit = new InMemoryAuditRepository(() => new Date(NOW))
    directoryRepository = new InMemoryUniversityDirectoryRepository(audit, () => new Date(NOW))
    const contentRepository = new InMemoryContentRepository(audit, directoryRepository)
    contentService = new ContentService(contentRepository, () => new Date(NOW))
    directoryService = new UniversityDirectoryService(directoryRepository, () => new Date(NOW))
    directoryRepository.addCountry(COUNTRY_ID)

    const country = await contentService.create('countries', {
      id: COUNTRY_ID, nameAr: 'رومانيا', nameEn: 'Romania', slug: 'romania', introductionAr: 'مقدمة', detailsAr: 'تفاصيل', imageUrl: 'https://example.invalid/romania.webp', imageAltAr: 'صورة رومانيا', status: 'PUBLISHED', featured: true, displayOrder: 1,
    }, ADMIN_ID)
    expect(country.id).toBe(COUNTRY_ID)
    bucharestId = (await directoryService.createCity({ countryId: COUNTRY_ID, slug: 'bucharest', nameAr: 'بوخارست', nameEn: 'Bucharest' }, ADMIN_ID)).id
    clujId = (await directoryService.createCity({ countryId: COUNTRY_ID, slug: 'cluj-napoca', nameAr: 'كلوج نابوكا', nameEn: 'Cluj-Napoca' }, ADMIN_ID)).id
    medicineId = (await directoryService.createMajor({ slug: 'medicine', nameAr: 'الطب', nameEn: 'Medicine', category: 'Health Sciences' }, ADMIN_ID)).id
    engineeringId = (await directoryService.createMajor({ slug: 'engineering', nameAr: 'الهندسة', nameEn: 'Engineering', category: 'Engineering' }, ADMIN_ID)).id

    const createUniversity = async (slug: string, values: { cityId?: string; universityType?: 'PUBLIC' | 'PRIVATE'; status?: 'DRAFT' | 'PUBLISHED' }) => {
      const record = await contentService.create('universities', {
        nameAr: `جامعة ${slug}`, nameEn: `${slug} University`, officialName: `${slug} University`, slug,
        countryId: COUNTRY_ID, cityId: values.cityId ?? null, universityType: values.universityType ?? null,
        cityAr: values.cityId === clujId ? 'كلوج نابوكا' : values.cityId === bucharestId ? 'بوخارست' : 'مدينة تاريخية',
        cityEn: values.cityId === clujId ? 'Cluj-Napoca' : values.cityId === bucharestId ? 'Bucharest' : 'Legacy City',
        overviewAr: 'نظرة عامة', status: values.status ?? 'PUBLISHED', featured: slug === 'bucharest-medical',
      }, ADMIN_ID)
      directoryRepository.addUniversity({
        id: record.id, slug, status: (values.status ?? 'PUBLISHED'), nameAr: String(record.nameAr), nameEn: String(record.nameEn),
        officialName: String(record.officialName), cityAr: String(record.cityAr), countrySlug: 'romania', featured: Boolean(record.featured),
        cityId: values.cityId ?? null, universityType: values.universityType ?? null,
      })
      return record.id
    }
    universityOneId = await createUniversity('bucharest-medical', { cityId: bucharestId, universityType: 'PUBLIC' })
    universityTwoId = await createUniversity('cluj-university', { cityId: clujId, universityType: 'PRIVATE' })
    legacyUniversityId = await createUniversity('legacy-university', {})
    draftUniversityId = await createUniversity('draft-university', { cityId: bucharestId, universityType: 'PUBLIC', status: 'DRAFT' })

    const createProgram = (universityId: string, academicMajorId: string, studyLevel: 'BACHELORS' | 'MASTERS', languages: Array<'ENGLISH' | 'ROMANIAN' | 'GERMAN'>, status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') =>
      directoryService.createProgram({ universityId, academicMajorId, nameAr: `${academicMajorId}-${studyLevel}`, studyLevel, languages, status, officialSourceUrl: `https://example.edu/${universityId}/${academicMajorId}/${studyLevel}`, verifiedAt: new Date('2026-11-01T12:00:00.000Z') }, ADMIN_ID)
    medicineBachelorsId = (await createProgram(universityOneId, medicineId, 'BACHELORS', ['ENGLISH', 'ROMANIAN'])).id
    await createProgram(universityOneId, engineeringId, 'MASTERS', ['GERMAN'])
    await createProgram(universityTwoId, medicineId, 'MASTERS', ['ENGLISH'])
    await createProgram(universityTwoId, medicineId, 'BACHELORS', ['ROMANIAN'], 'DRAFT')
    await createProgram(draftUniversityId, medicineId, 'BACHELORS', ['ENGLISH'])

    const createScholarship = async (
      slug: string,
      universityId: string | null,
      values: {
        status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
        countryId?: string | null
        studyLevel?: string
        applicationStatus?: 'OPEN' | 'CLOSED'
        verifiedDeadline?: string | null
      } = {},
    ) => (await contentService.create('scholarships', {
      titleAr: `منحة ${slug}`, slug, universityId, countryId: values.countryId === undefined ? COUNTRY_ID : values.countryId,
      studyLevel: values.studyLevel ?? 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف',
      applicationStatus: values.applicationStatus ?? 'OPEN', verifiedDeadline: values.verifiedDeadline ?? null,
      officialSourceUrl: values.status === 'DRAFT' || values.status === 'ARCHIVED' ? null : `https://example.edu/scholarships/${slug}`,
      status: values.status ?? 'PUBLISHED',
    }, ADMIN_ID)).id

    bucharestOpenId = await createScholarship('bucharest-open', universityOneId, { studyLevel: 'MASTERS', verifiedDeadline: '2027-01-01T00:00:00.000Z' })
    bucharestExpiredId = await createScholarship('bucharest-expired', universityOneId, { verifiedDeadline: '2026-10-01T00:00:00.000Z' })
    bucharestBoundaryId = await createScholarship('bucharest-boundary', universityOneId, { countryId: null, verifiedDeadline: NOW.toISOString() })
    clujOpenId = await createScholarship('cluj-open', universityTwoId)
    clujClosedId = await createScholarship('cluj-closed', universityTwoId, { applicationStatus: 'CLOSED', studyLevel: 'MASTERS' })
    await createScholarship('legacy-open', legacyUniversityId)
    draftUniversityScholarshipId = await createScholarship('draft-university-open', draftUniversityId)
    await createScholarship('global-open', null)
    draftScholarshipId = await createScholarship('draft-scholarship', universityOneId, { status: 'DRAFT' })
    archivedScholarshipId = await createScholarship('archived-scholarship', universityOneId, { status: 'ARCHIVED' })
    audit.events.splice(0)

    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({ id: ADMIN_ID, name: 'Admin', email: 'admin@example.invalid', passwordHash: '$argon2id$test', role: 'ADMIN', isActive: true })
    authRepository.addUser({ id: SUPER_ID, name: 'Super', email: 'super@example.invalid', passwordHash: '$argon2id$test', role: 'SUPER_ADMIN', isActive: true })
    const authRuntime: AuthRuntime = { getConfig: () => config, getService: () => new AuthService(authRepository, JWT_SECRET) }
    const contentRuntime: ContentRuntime = { getService: () => contentService }
    const universityDirectoryRuntime: UniversityDirectoryRuntime = { getService: () => directoryService }
    app = createApp({ authRuntime, contentRuntime, universityDirectoryRuntime })
  })

  const adminRequest = (path: string, method = 'GET', body?: unknown, role: AdminRole = 'ADMIN') => app.request(path, {
    method,
    headers: { Origin: ADMIN_ORIGIN, Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const universityIds = async (query = '') => {
    const response = await app.request(`/api/v1/universities${query}`, { headers: { Origin: PUBLIC_ORIGIN } })
    const body = await response.json() as { data: { items: Array<{ id: string }>; pagination: { total: number } } }
    return { response, body, ids: body.data.items.map(({ id }) => id) }
  }

  const scholarshipIds = async (query = '') => {
    const response = await app.request(`/api/v1/scholarships${query}`, { headers: { Origin: PUBLIC_ORIGIN } })
    const body = await response.json() as { data: { items: Array<{ id: string; effectiveApplicationStatus: string }>; pagination: { page: number; limit: number; total: number; totalPages: number } } }
    return { response, body, ids: body.data.items.map(({ id }) => id) }
  }

  it('preserves existing University listing behavior and universities without programs', async () => {
    const result = await universityIds()
    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    expect(result.body.data.pagination.total).toBe(3)
    expect(result.ids).toContain(legacyUniversityId)
    const legacy = await app.request('/api/v1/universities/legacy-university')
    await expect(legacy.json()).resolves.toMatchObject({ data: { cityAr: 'مدينة تاريخية', cityId: null, universityType: null } })
  })

  it('matches major, study level, multiple languages, and combined P1 filters on one published program', async () => {
    expect((await universityIds('?major=medicine')).ids).toEqual(expect.arrayContaining([universityOneId, universityTwoId]))
    expect((await universityIds('?studyLevel=BACHELORS')).ids).toEqual([universityOneId])
    expect((await universityIds('?language=ROMANIAN')).ids).toEqual([universityOneId])
    expect((await universityIds('?major=medicine&studyLevel=BACHELORS&language=ENGLISH')).ids).toEqual([universityOneId])
  })

  it('prevents cross-program false matches and excludes draft programs and unpublished parents', async () => {
    expect((await universityIds('?major=medicine&studyLevel=MASTERS&language=GERMAN')).ids).toEqual([])
    expect((await universityIds('?major=medicine&studyLevel=BACHELORS&language=ROMANIAN')).ids).toEqual([universityOneId])
    expect((await universityIds('?major=medicine&studyLevel=BACHELORS')).ids).not.toContain(universityTwoId)
    expect((await universityIds('?major=medicine&studyLevel=BACHELORS')).ids).not.toContain(draftUniversityId)
    expect((await app.request('/api/v1/universities?studyLevel=UNDERGRADUATE')).status).toBe(400)
    expect((await app.request('/api/v1/universities?tuitionMin=1000')).status).toBe(400)
  })

  it('filters City and University type independently and with P1 constraints', async () => {
    expect((await universityIds('?city=bucharest')).ids).toEqual([universityOneId])
    expect((await universityIds('?universityType=PRIVATE')).ids).toEqual([universityTwoId])
    expect((await universityIds('?country=romania&major=medicine&studyLevel=BACHELORS&language=ENGLISH&city=bucharest&universityType=PUBLIC')).ids).toEqual([universityOneId])
    expect((await universityIds('?city=cluj-napoca&universityType=PUBLIC')).ids).toEqual([])
  })

  it('finds Scholarships across the full University result set with independent pagination', async () => {
    const universities = await universityIds('?major=medicine&page=1&limit=1')
    expect(universities.body.data.pagination.total).toBe(2)
    expect(universities.ids).toHaveLength(1)

    const first = await scholarshipIds('?universityMajor=medicine&page=1&limit=2')
    const second = await scholarshipIds('?universityMajor=medicine&page=2&limit=2')
    const third = await scholarshipIds('?universityMajor=medicine&page=3&limit=2')
    const combined = [...first.ids, ...second.ids, ...third.ids]
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 })
    expect(combined).toHaveLength(5)
    expect(new Set(combined).size).toBe(5)
    expect(combined).toEqual(expect.arrayContaining([bucharestOpenId, bucharestExpiredId, bucharestBoundaryId, clujOpenId, clujClosedId]))
  })

  it('applies University-level and same-program filters without cross-program false matches', async () => {
    expect((await scholarshipIds('?universityCountry=romania')).body.data.pagination.total).toBe(6)
    expect((await scholarshipIds('?universitySearch=bucharest')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?universityCity=bucharest')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?universityType=PUBLIC')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?universityFeatured=true')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?universityMajor=medicine&universityStudyLevel=BACHELORS&universityLanguage=ENGLISH')).body.data.pagination.total).toBe(3)

    const crossProgram = await scholarshipIds('?universityMajor=medicine&universityStudyLevel=MASTERS&universityLanguage=GERMAN')
    expect(crossProgram.body.data.pagination.total).toBe(0)

    await directoryService.createProgram({
      universityId: universityOneId, academicMajorId: medicineId, nameAr: 'برنامج طب إضافي', studyLevel: 'BACHELORS',
      languages: ['ENGLISH'], status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/additional-medicine', verifiedAt: new Date('2026-11-01T12:00:00.000Z'),
    }, ADMIN_ID)
    const duplicateSafe = await scholarshipIds('?universityMajor=medicine&universityStudyLevel=BACHELORS&universityLanguage=ENGLISH')
    expect(duplicateSafe.body.data.pagination.total).toBe(3)
    expect(new Set(duplicateSafe.ids).size).toBe(3)
    for (const hiddenId of [draftUniversityScholarshipId, draftScholarshipId, archivedScholarshipId]) {
      expect(duplicateSafe.ids).not.toContain(hiddenId)
    }
  })

  it('combines Scholarship and University filters while preserving legacy single-University behavior', async () => {
    expect((await scholarshipIds('?university=bucharest-medical')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?university=bucharest-medical&universityMajor=medicine&universityStudyLevel=BACHELORS&universityLanguage=ENGLISH')).body.data.pagination.total).toBe(3)
    expect((await scholarshipIds('?country=romania&universityCountry=romania&universityMajor=medicine&universityStudyLevel=BACHELORS&universityLanguage=ENGLISH')).body.data.pagination.total).toBe(2)
    const distinctStudyLevels = await scholarshipIds('?studyLevel=MASTERS&universityStudyLevel=BACHELORS&universityLanguage=ENGLISH')
    expect(distinctStudyLevels.ids).toEqual([bucharestOpenId])
  })

  it('preserves effective OPEN/CLOSED status including the exact deadline boundary', async () => {
    const open = await scholarshipIds('?universityCity=bucharest&applicationStatus=OPEN')
    expect(open.ids).toEqual(expect.arrayContaining([bucharestOpenId, bucharestBoundaryId]))
    expect(open.ids).not.toContain(bucharestExpiredId)
    expect(open.body.data.items.every(({ effectiveApplicationStatus }) => effectiveApplicationStatus === 'OPEN')).toBe(true)

    const closed = await scholarshipIds('?universityCity=bucharest&applicationStatus=CLOSED')
    expect(closed.ids).toEqual([bucharestExpiredId])
    expect(closed.body.data.items[0]?.effectiveApplicationStatus).toBe('CLOSED')
  })

  it('validates University Scholarship filters and returns a standard empty collection', async () => {
    for (const query of [
      '?universityStudyLevel=UNDERGRADUATE',
      '?universityLanguage=KLINGON',
      '?universityFeatured=yes',
      '?universityTuition=1000',
    ]) {
      const response = await app.request(`/api/v1/scholarships${query}`)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } })
    }
    const empty = await scholarshipIds('?universityCountry=not-present')
    expect(empty.response.status).toBe(200)
    expect(empty.body).toEqual({ success: true, data: { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } } })
  })

  it('documents University-filtered Scholarships without adding another API operation', async () => {
    const document = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, Record<string, { description?: string; parameters?: Array<{ name: string; in: string }> }>>
    }
    const operation = document.paths['/api/v1/scholarships']?.get
    const parameterNames = operation?.parameters?.filter(({ in: location }) => location === 'query').map(({ name }) => name) ?? []
    expect(parameterNames).toEqual(expect.arrayContaining([
      'universitySearch', 'universityCountry', 'universityMajor', 'universityStudyLevel',
      'universityLanguage', 'universityCity', 'universityType', 'universityFeatured',
    ]))
    expect(operation?.description).toContain('same PUBLISHED UniversityProgram')
    expect(operation?.description).toContain('complete University result set')
  })

  it('lists published programs only and hides programs under an unpublished University', async () => {
    const response = await app.request('/api/v1/universities/bucharest-medical/programs?limit=1')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { items: Array<Record<string, unknown>>; pagination: { total: number } } }
    expect(body.data.pagination.total).toBe(2)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0]).not.toHaveProperty('status')
    expect((await app.request('/api/v1/universities/draft-university/programs')).status).toBe(404)
  })

  it('returns self-excluding dynamic facets with distinct University counts', async () => {
    const response = await app.request('/api/v1/universities/filter-options?major=medicine&language=ENGLISH')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { majors: Array<{ value: string; count: number }>; studyLevels: Array<{ value: string; count: number }>; languages: Array<{ value: string; count: number }>; cities: Array<{ value: string; count: number }>; universityTypes: Array<{ value: string; count: number }> } }
    expect(body.data.majors).toEqual(expect.arrayContaining([{ id: medicineId, slug: 'medicine', nameAr: 'الطب', nameEn: 'Medicine', category: 'Health Sciences', value: 'medicine', count: 2 }]))
    expect(body.data.studyLevels).toEqual(expect.arrayContaining([{ value: 'BACHELORS', count: 1 }, { value: 'MASTERS', count: 1 }]))
    expect(body.data.languages).toEqual(expect.arrayContaining([{ value: 'ENGLISH', count: 2 }, { value: 'ROMANIAN', count: 1 }]))
    expect(body.data.cities).toEqual(expect.arrayContaining([{ id: bucharestId, countryId: COUNTRY_ID, slug: 'bucharest', nameAr: 'بوخارست', nameEn: 'Bucharest', value: 'bucharest', count: 1 }]))
    expect(body.data.universityTypes).toEqual(expect.arrayContaining([{ value: 'PUBLIC', count: 1 }, { value: 'PRIVATE', count: 1 }]))
  })

  it('authorizes both Admin roles and validates catalog and program management', async () => {
    expect((await app.request(`/api/v1/admin/universities/${universityOneId}/programs`)).status).toBe(401)
    expect((await adminRequest(`/api/v1/admin/universities/${universityOneId}/programs`)).status).toBe(200)
    expect((await adminRequest(`/api/v1/admin/universities/${universityOneId}/programs`, 'GET', undefined, 'SUPER_ADMIN')).status).toBe(200)
    expect((await adminRequest('/api/v1/admin/academic-majors')).status).toBe(200)
    expect((await adminRequest('/api/v1/admin/cities')).status).toBe(200)

    const majorCreated = await adminRequest('/api/v1/admin/academic-majors', 'POST', { slug: 'law', nameAr: 'القانون', nameEn: 'Law', category: 'Social Sciences' })
    expect(majorCreated.status).toBe(201)
    const majorBody = await majorCreated.json() as { data: { id: string } }
    expect((await adminRequest(`/api/v1/admin/academic-majors/${majorBody.data.id}`, 'PATCH', { nameAr: 'القانون العام' })).status).toBe(200)
    const cityCreated = await adminRequest('/api/v1/admin/cities', 'POST', { countryId: COUNTRY_ID, slug: 'iasi', nameAr: 'ياش', nameEn: 'Iasi' })
    expect(cityCreated.status).toBe(201)
    const cityBody = await cityCreated.json() as { data: { id: string } }
    const universityUpdated = await adminRequest(`/api/v1/admin/universities/${legacyUniversityId}`, 'PATCH', { cityId: cityBody.data.id, universityType: 'PRIVATE' })
    expect(universityUpdated.status).toBe(200)
    await expect(universityUpdated.json()).resolves.toMatchObject({ data: { cityId: cityBody.data.id, universityType: 'PRIVATE', cityAr: 'مدينة تاريخية' } })

    const programCreated = await adminRequest(`/api/v1/admin/universities/${legacyUniversityId}/programs`, 'POST', {
      academicMajorId: engineeringId, nameAr: 'هندسة البرمجيات', nameEn: 'Software Engineering', facultyNameAr: 'كلية الهندسة', durationValue: 4, durationUnit: 'YEARS', studyLevel: 'BACHELORS', languages: ['ENGLISH'], tuition: { amount: '0', currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027' }, status: 'DRAFT', officialSourceUrl: 'https://example.edu/program', verifiedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(programCreated.status).toBe(201)
    const programBody = await programCreated.json() as { data: { id: string } }
    expect((await adminRequest(`/api/v1/admin/university-programs/${programBody.data.id}`, 'PATCH', { status: 'PUBLISHED' })).status).toBe(200)
    expect((await adminRequest(`/api/v1/admin/academic-majors/${engineeringId}`, 'DELETE')).status).toBe(409)
    expect((await adminRequest(`/api/v1/admin/cities/${bucharestId}`, 'DELETE')).status).toBe(409)
    const publicProgram = await app.request('/api/v1/universities/legacy-university/programs?search=Software&studyLevel=BACHELORS&language=ENGLISH&faculty=الهندسة')
    expect(publicProgram.status).toBe(200)
    await expect(publicProgram.json()).resolves.toMatchObject({ data: { items: [{ nameAr: 'هندسة البرمجيات', durationValue: 4, durationUnit: 'YEARS', tuition: { amount: '0', currency: 'EUR', academicYear: '2026/2027' } }], pagination: { total: 1 } } })

    const invalidTuition = await adminRequest(`/api/v1/admin/university-programs/${programBody.data.id}`, 'PATCH', { tuition: { amount: '-1', currency: 'eur', billingPeriod: 'YEAR', academicYear: '2026/2028' } })
    expect(invalidTuition.status).toBe(400)
    expect((await adminRequest(`/api/v1/admin/university-programs/${programBody.data.id}`, 'PATCH', { tuition: { amount: '100', currency: 'AAA', billingPeriod: 'YEAR', academicYear: '2026/2027' } })).status).toBe(400)
    const invalidDuration = await adminRequest(`/api/v1/admin/university-programs/${programBody.data.id}`, 'PATCH', { durationValue: 3 })
    expect(invalidDuration.status).toBe(400)

    const invalidSource = await adminRequest(`/api/v1/admin/universities/${legacyUniversityId}/programs`, 'POST', {
      academicMajorId: engineeringId, nameAr: 'هندسة', studyLevel: 'BACHELORS', languages: ['ENGLISH'], officialSourceUrl: 'http://example.edu/program', verifiedAt: NOW.toISOString(),
    })
    expect(invalidSource.status).toBe(400)
    const future = await adminRequest(`/api/v1/admin/universities/${legacyUniversityId}/programs`, 'POST', {
      academicMajorId: engineeringId, nameAr: 'هندسة', studyLevel: 'BACHELORS', languages: ['ENGLISH'], officialSourceUrl: 'https://example.edu/program', verifiedAt: '2027-01-01T00:00:00.000Z',
    })
    expect(future.status).toBe(400)
    expect((await app.request('/api/v1/universities/bucharest-medical/programs', { method: 'POST' })).status).toBe(404)
  })

  it('updates languages and status atomically, archives without DELETE, and writes safe audit events', async () => {
    const updated = await adminRequest(`/api/v1/admin/university-programs/${medicineBachelorsId}`, 'PATCH', { languages: ['ENGLISH', 'ROMANIAN'], status: 'ARCHIVED' })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ data: { status: 'ARCHIVED', languages: ['ENGLISH', 'ROMANIAN'] } })
    expect((await app.request('/api/v1/universities/bucharest-medical/programs')).status).toBe(200)
    const publicPrograms = await (await app.request('/api/v1/universities/bucharest-medical/programs')).json() as { data: { pagination: { total: number } } }
    expect(publicPrograms.data.pagination.total).toBe(1)
    expect((await adminRequest(`/api/v1/admin/university-programs/${medicineBachelorsId}`, 'DELETE')).status).toBe(404)
    expect(audit.events.map(({ action }) => action)).toContain('university_program.archived')
    expect(JSON.stringify(audit.events)).not.toContain('example.edu')

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audit.failNextWrite = true
    const failed = await adminRequest(`/api/v1/admin/universities/${legacyUniversityId}/programs`, 'POST', {
      academicMajorId: engineeringId, nameAr: 'هندسة', studyLevel: 'BACHELORS', languages: ['ENGLISH'], officialSourceUrl: 'https://example.edu/program', verifiedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(failed.status).toBe(500)
    expect(directoryRepository.programs.some((program) => program.universityId === legacyUniversityId)).toBe(false)
    log.mockRestore()
  })
})
