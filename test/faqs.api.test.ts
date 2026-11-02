import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import type { FaqRuntime } from '../src/faqs/runtime.js'
import { FaqService } from '../src/faqs/service.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryFaqRepository } from './helpers/in-memory-faq-repository.js'

const ADMIN_ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ID = '11111111-1111-4111-8111-111111111111'
const COUNTRY_ID = 'c0000000-0000-4000-8000-000000000001'
const COUNTRY_TWO_ID = 'c0000000-0000-4000-8000-000000000002'
const UNIVERSITY_ID = 'c0000000-0000-4000-8000-000000000003'
const SERVICE_ID = 'c0000000-0000-4000-8000-000000000004'
const SCHOLARSHIP_ID = 'c0000000-0000-4000-8000-000000000005'
const JWT_SECRET = 'faq-test-secret-that-is-longer-than-thirty-two-characters'
const NOW = new Date('2026-11-02T12:00:00.000Z')

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ADMIN_ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

describe('reusable FAQ management', () => {
  let app: ReturnType<typeof createApp>
  let repository: InMemoryFaqRepository
  let adminToken: string
  let superToken: string

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superToken = await signAccessToken({ id: SUPER_ID, role: 'SUPER_ADMIN' }, JWT_SECRET)
  })

  beforeEach(() => {
    repository = new InMemoryFaqRepository()
    repository.addParent({ id: COUNTRY_ID, scope: 'COUNTRY', slug: 'germany', status: 'PUBLISHED' })
    repository.addParent({ id: COUNTRY_TWO_ID, scope: 'COUNTRY', slug: 'france', status: 'DRAFT' })
    repository.addParent({ id: UNIVERSITY_ID, scope: 'UNIVERSITY', slug: 'berlin-university', status: 'PUBLISHED' })
    repository.addParent({ id: SERVICE_ID, scope: 'SERVICE', slug: 'admissions', status: 'PUBLISHED' })
    repository.addParent({ id: SCHOLARSHIP_ID, scope: 'SCHOLARSHIP', slug: 'merit-award', status: 'PUBLISHED' })
    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({ id: ADMIN_ID, name: 'Admin', email: 'admin@example.invalid', passwordHash: '$argon2id$test', role: 'ADMIN', isActive: true })
    authRepository.addUser({ id: SUPER_ID, name: 'Super Admin', email: 'super@example.invalid', passwordHash: '$argon2id$test', role: 'SUPER_ADMIN', isActive: true })
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(authRepository, JWT_SECRET),
    }
    const faqRuntime: FaqRuntime = {
      getService: () => new FaqService(repository, () => new Date(NOW)),
    }
    app = createApp({ authRuntime, faqRuntime })
  })

  const adminRequest = (
    path: string,
    method = 'GET',
    body?: unknown,
    role: AdminRole = 'ADMIN',
    origin = ADMIN_ORIGIN,
  ) => app.request(path, {
    method,
    headers: {
      Origin: origin,
      Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const createFaq = async (overrides: Record<string, unknown> = {}) => {
    const response = await adminRequest('/api/v1/admin/faqs', 'POST', {
      scope: 'GLOBAL',
      questionAr: 'ما هي خدمات طريق؟',
      answerAr: 'نساعد الطلاب في رحلة الدراسة بالخارج.',
      ...overrides,
    })
    const body = await response.json() as { data: { id: string; displayOrder: number; status: string } }
    return { response, body }
  }

  it('publishes only GLOBAL entries and applies the public five-item pagination contract', async () => {
    const empty = await app.request('/api/v1/faqs?scope=GLOBAL')
    await expect(empty.json()).resolves.toEqual({
      success: true,
      data: { items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } },
    })
    for (let index = 0; index < 6; index += 1) {
      expect((await createFaq({
        questionAr: `سؤال عالمي رقم ${index + 1}`,
        answerAr: `إجابة عالمية رقم ${index + 1}`,
        status: 'PUBLISHED',
      })).response.status).toBe(201)
    }
    await createFaq({ questionAr: 'مسودة غير عامة', answerAr: 'لا تظهر للزوار', status: 'DRAFT' })

    const first = await app.request('/api/v1/faqs?scope=GLOBAL', { headers: { Origin: PUBLIC_ORIGIN } })
    expect(first.status).toBe(200)
    expect(first.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    const firstBody = await first.json() as { data: { items: Array<Record<string, unknown>>; pagination: Record<string, number> } }
    expect(firstBody.data.items).toHaveLength(5)
    expect(firstBody.data.pagination).toEqual({ page: 1, limit: 5, total: 6, totalPages: 2 })
    expect(firstBody.data.items[0]).not.toHaveProperty('status')
    expect(firstBody.data.items[0]).not.toHaveProperty('parentId')
    expect(firstBody.data.items[0]).not.toHaveProperty('createdAt')

    const second = await app.request('/api/v1/faqs?scope=GLOBAL&page=2')
    const secondBody = await second.json() as { data: { items: Array<{ id: string }>; pagination: { page: number; limit: number } } }
    expect(secondBody).toMatchObject({ data: { items: [expect.any(Object)], pagination: { page: 2, limit: 5 } } })
    expect((await adminRequest(`/api/v1/admin/faqs/${secondBody.data.items[0]!.id}`, 'PATCH', { status: 'ARCHIVED' })).status).toBe(200)
    const afterArchive = await app.request('/api/v1/faqs?scope=GLOBAL')
    await expect(afterArchive.json()).resolves.toMatchObject({ data: { pagination: { total: 5, totalPages: 1 } } })
    expect((await app.request('/api/v1/faqs')).status).toBe(400)
  })

  it('isolates Country, University, Service, and Scholarship FAQs and hides unpublished parents', async () => {
    const fixtures = [
      ['COUNTRY', COUNTRY_ID, '/api/v1/countries/germany/faqs'],
      ['UNIVERSITY', UNIVERSITY_ID, '/api/v1/universities/berlin-university/faqs'],
      ['SERVICE', SERVICE_ID, '/api/v1/services/admissions/faqs'],
      ['SCHOLARSHIP', SCHOLARSHIP_ID, '/api/v1/scholarships/merit-award/faqs'],
    ] as const
    for (const [scope, parentId, path] of fixtures) {
      const created = await createFaq({ scope, parentId, questionAr: `سؤال ${scope}`, answerAr: `إجابة ${scope}`, status: 'PUBLISHED' })
      expect(created.response.status).toBe(201)
      const response = await app.request(path)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        data: { items: [{ id: created.body.data.id, scope }], pagination: { total: 1 } },
      })
    }
    await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_TWO_ID, questionAr: 'سؤال فرنسا', answerAr: 'إجابة فرنسا', status: 'PUBLISHED' })
    expect((await app.request('/api/v1/countries/france/faqs')).status).toBe(404)
    const germany = await app.request('/api/v1/countries/germany/faqs')
    await expect(germany.json()).resolves.toMatchObject({ data: { pagination: { total: 1 } } })
  })

  it('validates parent relationships, translations, immutable scope, and unknown fields', async () => {
    const missingParent = await createFaq({ scope: 'COUNTRY' })
    expect(missingParent.response.status).toBe(400)
    const wrongParent = await createFaq({ scope: 'SERVICE', parentId: COUNTRY_ID })
    expect(wrongParent.response.status).toBe(400)

    const incompleteTranslation = await createFaq({ questionEn: 'Question without answer' })
    expect(incompleteTranslation.response.status).toBe(400)
    const created = await createFaq({ questionEn: 'Question', answerEn: 'Answer' })
    const edited = await adminRequest(`/api/v1/admin/faqs/${created.body.data.id}`, 'PATCH', { questionAr: 'سؤال محدّث' })
    expect(edited.status).toBe(200)
    await expect(edited.json()).resolves.toMatchObject({ data: { questionAr: 'سؤال محدّث' } })
    const move = await adminRequest(`/api/v1/admin/faqs/${created.body.data.id}`, 'PATCH', { scope: 'COUNTRY', parentId: COUNTRY_ID })
    expect(move.status).toBe(400)
    const partialTranslation = await adminRequest(`/api/v1/admin/faqs/${created.body.data.id}`, 'PATCH', { answerEn: null })
    expect(partialTranslation.status).toBe(400)
    await expect(partialTranslation.json()).resolves.toMatchObject({ error: { code: 'FAQ_TRANSLATION_INCOMPLETE' } })
  })

  it('requires authentication, accepts both roles, and preserves trusted-origin CSRF enforcement', async () => {
    expect((await app.request('/api/v1/admin/faqs?scope=GLOBAL')).status).toBe(401)
    expect((await adminRequest('/api/v1/admin/faqs?scope=GLOBAL')).status).toBe(200)
    expect((await adminRequest('/api/v1/admin/faqs?scope=GLOBAL', 'GET', undefined, 'SUPER_ADMIN')).status).toBe(200)
    const rejected = await adminRequest('/api/v1/admin/faqs', 'POST', {
      scope: 'GLOBAL', questionAr: 'سؤال', answerAr: 'إجابة',
    }, 'ADMIN', 'https://evil.example')
    expect(rejected.status).toBe(403)
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: 'CSRF_VALIDATION_FAILED' } })
    expect((await app.request('/api/v1/faqs', { method: 'POST' })).status).toBe(404)
    expect((await adminRequest('/api/v1/admin/faqs/f0000000-0000-4000-8000-000000000001', 'DELETE')).status).toBe(404)
  })

  it('reorders one complete active parent set atomically and excludes archived entries', async () => {
    const first = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID })
    const second = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID, questionAr: 'السؤال الثاني' })
    const archived = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID, questionAr: 'السؤال المؤرشف', status: 'ARCHIVED' })
    const otherParent = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_TWO_ID, questionAr: 'سؤال مورد آخر' })
    const reordered = await adminRequest('/api/v1/admin/faqs/order', 'PATCH', {
      scope: 'COUNTRY', parentId: COUNTRY_ID, orderedIds: [second.body.data.id, first.body.data.id],
    })
    expect(reordered.status).toBe(200)
    await expect(reordered.json()).resolves.toMatchObject({ data: { items: [
      { id: second.body.data.id, displayOrder: 0 }, { id: first.body.data.id, displayOrder: 1 },
    ] } })
    for (const orderedIds of [
      [first.body.data.id],
      [first.body.data.id, first.body.data.id],
      [first.body.data.id, archived.body.data.id],
      [first.body.data.id, otherParent.body.data.id],
    ]) {
      const invalid = await adminRequest('/api/v1/admin/faqs/order', 'PATCH', {
        scope: 'COUNTRY', parentId: COUNTRY_ID, orderedIds,
      })
      expect([400, 409]).toContain(invalid.status)
    }
    const list = await adminRequest(`/api/v1/admin/faqs?scope=COUNTRY&parentId=${COUNTRY_ID}`)
    await expect(list.json()).resolves.toMatchObject({ data: { items: [
      { id: second.body.data.id, displayOrder: 0 }, { id: first.body.data.id, displayOrder: 1 },
      { id: archived.body.data.id },
    ] } })
  })

  it('writes safe actor/resource audit events for create, publish, reorder, and archive', async () => {
    const first = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID })
    const second = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID, questionAr: 'سؤال ثانٍ' })
    await adminRequest(`/api/v1/admin/faqs/${first.body.data.id}`, 'PATCH', { status: 'PUBLISHED' })
    await adminRequest('/api/v1/admin/faqs/order', 'PATCH', {
      scope: 'COUNTRY', parentId: COUNTRY_ID, orderedIds: [second.body.data.id, first.body.data.id],
    })
    await adminRequest(`/api/v1/admin/faqs/${second.body.data.id}`, 'PATCH', { status: 'ARCHIVED' })
    expect(repository.audit.events.map((event) => event.action)).toEqual(expect.arrayContaining([
      'faq.created', 'faq.published', 'faq.reordered', 'faq.archived',
    ]))
    expect(repository.audit.events.every((event) => event.actorAdminId === ADMIN_ID && event.resourceType === 'FAQ_ENTRY')).toBe(true)
    const serialized = JSON.stringify(repository.audit.events)
    expect(serialized).not.toContain('نساعد الطلاب')
    expect(serialized).not.toContain('إجابة')
    expect(serialized).not.toContain('answerAr')
  })

  it('does not persist a business mutation when its audit write fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    repository.audit.failNextWrite = true
    const failedCreate = await createFaq()
    expect(failedCreate.response.status).toBe(500)
    expect(repository.records).toHaveLength(0)
    expect(repository.audit.events).toHaveLength(0)

    const created = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID })
    repository.audit.failNextWrite = true
    const failedUpdate = await adminRequest(`/api/v1/admin/faqs/${created.body.data.id}`, 'PATCH', { status: 'PUBLISHED' })
    expect(failedUpdate.status).toBe(500)
    expect(repository.records.find((record) => record.id === created.body.data.id)?.status).toBe('DRAFT')

    const second = await createFaq({ scope: 'COUNTRY', parentId: COUNTRY_ID, questionAr: 'سؤال آخر' })
    repository.audit.failNextWrite = true
    const failedReorder = await adminRequest('/api/v1/admin/faqs/order', 'PATCH', {
      scope: 'COUNTRY', parentId: COUNTRY_ID, orderedIds: [second.body.data.id, created.body.data.id],
    })
    expect(failedReorder.status).toBe(500)
    expect(repository.records.find((record) => record.id === created.body.data.id)?.displayOrder).toBe(0)
    expect(repository.records.find((record) => record.id === second.body.data.id)?.displayOrder).toBe(1)
    log.mockRestore()
  })

  it('documents all five public and four administrative FAQ operations', async () => {
    const document = await (await app.request('/openapi.json')).json() as { paths: Record<string, Record<string, unknown>> }
    const publicPaths = [
      '/api/v1/faqs',
      '/api/v1/countries/{slug}/faqs',
      '/api/v1/universities/{slug}/faqs',
      '/api/v1/services/{slug}/faqs',
      '/api/v1/scholarships/{slug}/faqs',
    ]
    for (const path of publicPaths) expect(document.paths[path]?.get).toBeDefined()
    expect(document.paths['/api/v1/admin/faqs']?.get).toBeDefined()
    expect(document.paths['/api/v1/admin/faqs']?.post).toBeDefined()
    expect(document.paths['/api/v1/admin/faqs/{id}']?.patch).toBeDefined()
    expect(document.paths['/api/v1/admin/faqs/order']?.patch).toBeDefined()
  })
})
