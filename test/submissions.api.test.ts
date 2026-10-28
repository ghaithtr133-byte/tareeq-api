import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import type { SubmissionRuntime } from '../src/submissions/runtime.js'
import { SubmissionService } from '../src/submissions/service.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemorySubmissionRepository } from './helpers/in-memory-submission-repository.js'

const ADMIN_ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const JWT_SECRET = 'submission-api-test-secret-that-is-longer-than-thirty-two-characters'
const FIXED_NOW = new Date('2026-10-25T10:00:00.000Z')
const COUNTRY_ID = '9879d0a4-9b7e-48d1-850a-da51be9de671'
const UNIVERSITY_ID = '88008b68-b698-4725-93e9-801537e7797c'
const SCHOLARSHIP_ID = '9f414dec-fcbc-49dd-994f-086d2ef40e1f'

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ADMIN_ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

const applicationInput = (overrides: Record<string, unknown> = {}) => ({
  applicationType: 'UNIVERSITY_ADMISSION',
  countryId: COUNTRY_ID,
  universityId: UNIVERSITY_ID,
  studyLevel: 'BACHELORS',
  intendedMajor: 'Computer Science',
  fullName: '  أحمد محمد  ',
  email: '  STUDENT@EXAMPLE.INVALID ',
  phone: '+963 900 000 000',
  message: 'أرغب بالحصول على مساعدة في تقديم طلب القبول الجامعي.',
  privacyAccepted: true,
  website: '',
  ...overrides,
})

const inquiryInput = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'سارة أحمد',
  email: 'sara@example.invalid',
  subject: 'استفسار عن الخدمات',
  message: 'أرغب بمعرفة المزيد عن خدمات القبول الجامعي المتاحة.',
  privacyAccepted: true,
  website: '',
  ...overrides,
})

describe('student applications and inquiries APIs', () => {
  let app: ReturnType<typeof createApp>
  let repository: InMemorySubmissionRepository
  let adminToken: string
  let superAdminToken: string

  beforeAll(async () => {
    adminToken = await signAccessToken(
      { id: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20', role: 'ADMIN' },
      JWT_SECRET,
    )
    superAdminToken = await signAccessToken(
      { id: '11111111-1111-4111-8111-111111111111', role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
  })

  beforeEach(() => {
    repository = new InMemorySubmissionRepository()
    repository.countries.set(COUNTRY_ID, { id: COUNTRY_ID })
    repository.universities.set(UNIVERSITY_ID, {
      id: UNIVERSITY_ID,
      countryId: COUNTRY_ID,
    })
    repository.scholarships.set(SCHOLARSHIP_ID, {
      id: SCHOLARSHIP_ID,
      countryId: COUNTRY_ID,
      universityId: UNIVERSITY_ID,
      availableUntil: new Date('2027-01-01T00:00:00.000Z'),
    })
    const service = new SubmissionService(repository, JWT_SECRET, () => new Date(FIXED_NOW))
    const submissionRuntime: SubmissionRuntime = { getService: () => service }
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(new InMemoryAuthRepository(), JWT_SECRET),
    }
    app = createApp({ authRuntime, submissionRuntime })
  })

  const submit = (
    path: '/api/v1/applications' | '/api/v1/inquiries',
    body: unknown,
    client: string = crypto.randomUUID(),
    origin: string = PUBLIC_ORIGIN,
  ) => app.request(path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Forwarded-For': client,
    },
    body: JSON.stringify(body),
  })

  const adminRequest = (
    path: string,
    method = 'GET',
    body?: unknown,
    role: AdminRole = 'ADMIN',
  ) => app.request(path, {
    method,
    headers: {
      Origin: ADMIN_ORIGIN,
      Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superAdminToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  it('accepts university admission and scholarship-assistance requests without requiring a scholarship', async () => {
    const university = await submit('/api/v1/applications', applicationInput())
    const scholarship = await submit('/api/v1/applications', applicationInput({
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      scholarshipId: null,
    }))

    expect(university.status).toBe(201)
    expect(scholarship.status).toBe(201)
    await expect(university.json()).resolves.toEqual({
      success: true,
      data: { message: 'Submission received.' },
    })
    expect(repository.applications).toHaveLength(2)
    expect(repository.applications[0]).toMatchObject({
      fullName: 'أحمد محمد',
      email: 'student@example.invalid',
      status: 'NEW',
      scholarshipId: null,
      privacyAcceptedAt: FIXED_NOW,
    })
  })

  it('accepts an available scholarship and rejects unavailable or inconsistent references', async () => {
    expect((await submit('/api/v1/applications', applicationInput({
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      scholarshipId: SCHOLARSHIP_ID,
    }))).status).toBe(201)

    const unavailable = await submit('/api/v1/applications', applicationInput({
      scholarshipId: '22222222-2222-4222-8222-222222222222',
    }))
    expect(unavailable.status).toBe(400)
    await expect(unavailable.json()).resolves.toMatchObject({
      error: {
        code: 'SCHOLARSHIP_UNAVAILABLE',
        details: { fields: { scholarshipId: expect.any(Array) } },
      },
    })

    const otherCountryId = '33333333-3333-4333-8333-333333333333'
    repository.countries.set(otherCountryId, { id: otherCountryId })
    const inconsistent = await submit('/api/v1/applications', applicationInput({
      countryId: otherCountryId,
      universityId: UNIVERSITY_ID,
    }))
    expect(inconsistent.status).toBe(400)
    await expect(inconsistent.json()).resolves.toMatchObject({
      error: { code: 'RELATIONSHIP_INVALID' },
    })
  })

  it('requires consent, validates fields, content type, and request size', async () => {
    const invalid = await submit('/api/v1/inquiries', inquiryInput({
      privacyAccepted: false,
      email: 'invalid',
      message: 'short',
    }))
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: {
          fields: {
            privacyAccepted: expect.any(Array),
            email: expect.any(Array),
            message: expect.any(Array),
          },
        },
      },
    })

    const unsupported = await app.request('/api/v1/inquiries', {
      method: 'POST',
      headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'text/plain' },
      body: '{}',
    })
    expect(unsupported.status).toBe(415)

    const oversized = await submit('/api/v1/inquiries', inquiryInput({
      message: 'x'.repeat(17_000),
    }))
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    })
  })

  it('handles a filled honeypot without storing data or revealing detection', async () => {
    const response = await submit('/api/v1/inquiries', inquiryInput({ website: 'spam.example' }))
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { message: 'Submission received.' },
    })
    expect(repository.inquiries).toHaveLength(0)
  })

  it('enforces the shared rate limit atomically under concurrent requests', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () =>
      submit('/api/v1/inquiries', inquiryInput(), '203.0.113.10'),
    ))
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 201, 201, 201, 201, 429,
    ])
    expect(repository.inquiries).toHaveLength(5)
    const limited = responses.find((response) => response.status === 429)
    await expect(limited?.json()).resolves.toMatchObject({
      error: {
        code: 'SUBMISSION_RATE_LIMITED',
        details: { retryAfterSeconds: 900 },
      },
    })
  })

  it('allows Public Website POST CORS without credentials and rejects untrusted origins', async () => {
    const preflight = await app.request('/api/v1/applications', {
      method: 'OPTIONS',
      headers: {
        Origin: PUBLIC_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
    expect(preflight.headers.get('access-control-allow-methods')).not.toContain('GET')
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()

    const allowed = await submit('/api/v1/inquiries', inquiryInput())
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull()

    const rejected = await submit(
      '/api/v1/inquiries',
      inquiryInput(),
      crypto.randomUUID(),
      'https://untrusted.invalid',
    )
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'ORIGIN_NOT_ALLOWED' },
    })

    const untrustedPreflight = await app.request('/api/v1/inquiries', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.invalid',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(untrustedPreflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('enforces Admin authentication and permits both roles', async () => {
    const unauthenticated = await app.request('/api/v1/admin/applications')
    expect(unauthenticated.status).toBe(401)
    expect((await adminRequest('/api/v1/admin/applications')).status).toBe(200)
    expect((await adminRequest(
      '/api/v1/admin/inquiries',
      'GET',
      undefined,
      'SUPER_ADMIN',
    )).status).toBe(200)

    const publicOrigin = await app.request('/api/v1/admin/inquiries', {
      headers: {
        Origin: PUBLIC_ORIGIN,
        Cookie: `${ACCESS_COOKIE_NAME}=${adminToken}`,
      },
    })
    expect(publicOrigin.headers.get('access-control-allow-origin')).toBeNull()

    const blockedMutation = await app.request(
      '/api/v1/admin/inquiries/22222222-2222-4222-8222-222222222222/status',
      {
        method: 'PATCH',
        headers: {
          Origin: PUBLIC_ORIGIN,
          Cookie: `${ACCESS_COOKIE_NAME}=${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CLOSED' }),
      },
    )
    expect(blockedMutation.status).toBe(403)
    await expect(blockedMutation.json()).resolves.toMatchObject({
      error: { code: 'CSRF_VALIDATION_FAILED' },
    })
  })

  it('lists, filters, sorts, paginates, reads, and updates private workflow fields', async () => {
    await submit('/api/v1/applications', applicationInput({
      applicationType: 'UNIVERSITY_ADMISSION',
    }))
    await submit('/api/v1/applications', applicationInput({
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      countryId: null,
      universityId: null,
    }))
    const first = repository.applications[0]
    const second = repository.applications[1]
    if (!first || !second) throw new Error('Missing fixtures.')
    first.createdAt = new Date('2026-10-24T10:00:00.000Z')
    second.createdAt = new Date('2026-10-25T10:00:00.000Z')

    const filtered = await adminRequest(
      '/api/v1/admin/applications?applicationType=SCHOLARSHIP_ASSISTANCE&sort=oldest&page=1&limit=1',
    )
    const filteredBody = await filtered.json() as {
      data: { items: Array<{ id: string }>; pagination: Record<string, number> }
    }
    expect(filtered.status).toBe(200)
    expect(filteredBody.data.items.map(({ id }) => id)).toEqual([second.id])
    expect(filteredBody.data.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 })

    const updated = await adminRequest(
      `/api/v1/admin/applications/${second.id}/status`,
      'PATCH',
      { status: 'IN_REVIEW', internalNote: '  تمت المراجعة.  ' },
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      data: { status: 'IN_REVIEW', internalNote: 'تمت المراجعة.' },
    })

    const detail = await adminRequest(`/api/v1/admin/applications/${second.id}`)
    await expect(detail.json()).resolves.toMatchObject({
      data: { id: second.id, internalNote: 'تمت المراجعة.' },
    })

    const missing = await adminRequest(
      '/api/v1/admin/inquiries/22222222-2222-4222-8222-222222222222',
    )
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'INQUIRY_NOT_FOUND' },
    })
  })

  it('manages inquiry workflow and rejects invalid admin parameters or empty updates', async () => {
    await submit('/api/v1/inquiries', inquiryInput())
    const inquiry = repository.inquiries[0]
    if (!inquiry) throw new Error('Missing inquiry fixture.')

    const updated = await adminRequest(
      `/api/v1/admin/inquiries/${inquiry.id}/status`,
      'PATCH',
      { status: 'RESOLVED', internalNote: '  تم الرد.  ' },
      'SUPER_ADMIN',
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      data: { id: inquiry.id, status: 'RESOLVED', internalNote: 'تم الرد.' },
    })

    const filtered = await adminRequest('/api/v1/admin/inquiries?status=RESOLVED&sort=updated')
    await expect(filtered.json()).resolves.toMatchObject({
      data: { items: [{ id: inquiry.id }], pagination: { total: 1 } },
    })

    const invalidUuid = await adminRequest('/api/v1/admin/inquiries/not-a-uuid')
    expect(invalidUuid.status).toBe(400)
    await expect(invalidUuid.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: { id: expect.any(Array) } } },
    })

    const invalidSort = await adminRequest('/api/v1/admin/inquiries?sort=unsafe')
    expect(invalidSort.status).toBe(400)

    const emptyUpdate = await adminRequest(
      `/api/v1/admin/inquiries/${inquiry.id}/status`,
      'PATCH',
      {},
    )
    expect(emptyUpdate.status).toBe(400)
    await expect(emptyUpdate.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })
  })

  it('documents exactly the eight approved operations and preserves request IDs', async () => {
    const response = await app.request('/openapi.json', {
      headers: { 'X-Request-Id': 'task-5-openapi-check' },
    })
    const document = await response.json() as {
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>
    }
    const expected = [
      ['post', '/api/v1/applications'],
      ['get', '/api/v1/admin/applications'],
      ['get', '/api/v1/admin/applications/{id}'],
      ['patch', '/api/v1/admin/applications/{id}/status'],
      ['post', '/api/v1/inquiries'],
      ['get', '/api/v1/admin/inquiries'],
      ['get', '/api/v1/admin/inquiries/{id}'],
      ['patch', '/api/v1/admin/inquiries/{id}/status'],
    ] as const
    for (const [method, path] of expected) {
      expect(document.paths[path]?.[method]).toBeDefined()
      if (path.includes('/admin/')) {
        expect(document.paths[path]?.[method]?.security).toEqual([{ accessCookie: [] }])
      }
    }
    const methods = new Set(['get', 'post', 'patch', 'put', 'delete'])
    const operationCount = Object.values(document.paths).reduce(
      (total, path) => total + Object.keys(path).filter((method) => methods.has(method)).length,
      0,
    )
    expect(operationCount).toBe(44)
    expect(response.headers.get('x-request-id')).toBe('task-5-openapi-check')
  })
})
