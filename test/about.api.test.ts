import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AboutUsService } from '../src/about/service.js'
import type { AboutUsRuntime } from '../src/about/runtime.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import { InMemoryAboutUsRepository } from './helpers/in-memory-about-us-repository.js'
import { InMemoryAuditRepository } from './helpers/in-memory-audit-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'

const ORIGIN = 'http://localhost:3001'
const PUBLIC_ORIGIN = 'http://localhost:3002'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const JWT_SECRET = 'about-us-test-secret-longer-than-thirty-two-characters'
const NOW = new Date('2026-11-04T12:00:00.000Z')
const config: AuthConfig = { databaseUrl: 'postgresql://unused:unused@localhost:5432/unused', jwtSecret: JWT_SECRET, allowedOrigins: [ORIGIN], publicAllowedOrigins: [PUBLIC_ORIGIN], isProduction: false }
const account = (id: string, role: AdminRole) => ({ id, name: role, email: `${role.toLowerCase()}@example.invalid`, passwordHash: '$argon2id$test-only-never-return', role, isActive: true })
const requiredArabic = { heroTitleAr: 'عن أكاديمية طريق', heroSubtitleAr: 'نساعد الطلاب على اتخاذ قرارات مدروسة.', introTitleAr: 'من نحن', introBodyAr: 'نص تعريفي متعدد الأسطر.\nيبقى النص آمناً.' }

describe('About Us singleton API', () => {
  let app: ReturnType<typeof createApp>
  let audit: InMemoryAuditRepository
  let repository: InMemoryAboutUsRepository
  let adminToken: string
  let superToken: string

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superToken = await signAccessToken({ id: SUPER_ID, role: 'SUPER_ADMIN' }, JWT_SECRET)
  })

  beforeEach(() => {
    audit = new InMemoryAuditRepository(() => new Date(NOW))
    const authRepository = new InMemoryAuthRepository(audit)
    authRepository.addUser(account(ADMIN_ID, 'ADMIN'))
    authRepository.addUser(account(SUPER_ID, 'SUPER_ADMIN'))
    const authRuntime: AuthRuntime = { getConfig: () => config, getService: () => new AuthService(authRepository, JWT_SECRET) }
    repository = new InMemoryAboutUsRepository(authRepository, audit, () => new Date(NOW))
    const aboutUsRuntime: AboutUsRuntime = { getService: () => new AboutUsService(repository) }
    app = createApp({ authRuntime, aboutUsRuntime })
  })

  const adminRequest = (path: string, method = 'GET', body?: unknown, token = adminToken) => app.request(path, {
    method,
    headers: { Origin: ORIGIN, Cookie: `${ACCESS_COOKIE_NAME}=${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  it('hides missing, draft, and archived content from the public route', async () => {
    expect((await app.request('/api/v1/about')).status).toBe(404)
    expect((await adminRequest('/api/v1/admin/about', 'PATCH', { heroTitleAr: 'مسودة' })).status).toBe(200)
    expect((await app.request('/api/v1/about')).status).toBe(404)
    expect((await adminRequest('/api/v1/admin/about', 'PATCH', { status: 'ARCHIVED' })).status).toBe(200)
    expect((await app.request('/api/v1/about')).status).toBe(404)
  })

  it('allows ADMIN and SUPER_ADMIN to create and edit a singleton, while anonymous access is rejected', async () => {
    expect((await app.request('/api/v1/admin/about')).status).toBe(401)
    const created = await adminRequest('/api/v1/admin/about', 'PATCH', { heroTitleAr: 'عنوان مسودة' })
    expect(created.status).toBe(200)
    expect((await adminRequest('/api/v1/admin/about', 'GET', undefined, superToken)).status).toBe(200)
    await expect(created.json()).resolves.toMatchObject({ data: { status: 'DRAFT', heroTitleAr: 'عنوان مسودة', introTitleAr: null } })
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ action: 'about_us.created', resourceType: 'ABOUT_US', metadata: { changedFields: ['heroTitleAr'] } })
  })

  it('preserves omitted fields, rejects incomplete publication, and exposes only the public projection once published', async () => {
    await adminRequest('/api/v1/admin/about', 'PATCH', { ...requiredArabic, heroImageUrl: 'https://example.invalid/hero.webp', heroImageAltAr: 'صورة الغلاف' })
    const partial = await adminRequest('/api/v1/admin/about', 'PATCH', { introTitleEn: 'Who we are' })
    await expect(partial.json()).resolves.toMatchObject({ data: { heroTitleAr: requiredArabic.heroTitleAr, introTitleEn: 'Who we are' } })
    const published = await adminRequest('/api/v1/admin/about', 'PATCH', { status: 'PUBLISHED' })
    expect(published.status).toBe(200)
    const publicResponse = await app.request('/api/v1/about', { headers: { Origin: PUBLIC_ORIGIN } })
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    const publicBody = await publicResponse.json() as { data: Record<string, unknown> }
    expect(publicBody.data).toMatchObject({ heroTitleAr: requiredArabic.heroTitleAr, introBodyAr: requiredArabic.introBodyAr })
    expect(publicBody.data).not.toHaveProperty('status')
    expect(publicBody.data).not.toHaveProperty('createdAt')
    expect(publicBody.data).toHaveProperty('publishedAt', NOW.toISOString())
    expect(publicBody.data).toHaveProperty('updatedAt', NOW.toISOString())
  })

  it('validates URLs, unknown fields, HTML-like text, image-alt consistency, and allows null optional sections', async () => {
    expect((await adminRequest('/api/v1/admin/about', 'PATCH', { status: 'PUBLISHED' })).status).toBe(400)
    for (const body of [
      { heroImageUrl: 'http://example.invalid/image.webp' },
      { heroTitleAr: '<b>unsafe</b>' },
      { unknown: 'field' },
      { heroImageAltAr: 'وصف بلا صورة' },
    ]) expect((await adminRequest('/api/v1/admin/about', 'PATCH', body)).status).toBe(400)
    const optional = await adminRequest('/api/v1/admin/about', 'PATCH', { missionTitleAr: null, visionBodyEn: null, ctaTitleAr: null })
    expect(optional.status).toBe(200)
  })

  it('retains the first publication timestamp through update and unpublishing, and rolls back on audit failure', async () => {
    await adminRequest('/api/v1/admin/about', 'PATCH', { ...requiredArabic, status: 'PUBLISHED' })
    const published = await repository.find()
    expect(published?.publishedAt).toEqual(NOW)
    await adminRequest('/api/v1/admin/about', 'PATCH', { status: 'DRAFT', heroTitleEn: 'About us' })
    expect((await repository.find())?.publishedAt).toEqual(NOW)
    audit.failNextWrite = true
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await adminRequest('/api/v1/admin/about', 'PATCH', { heroTitleAr: 'لا يجب حفظها' })
    expect(failed.status).toBe(500)
    expect((await repository.find())?.heroTitleAr).toBe(requiredArabic.heroTitleAr)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Simulated audit write failure')
  })

  it('serializes concurrent first saves into one merged singleton', async () => {
    const [hero, introduction] = await Promise.all([
      adminRequest('/api/v1/admin/about', 'PATCH', { heroTitleAr: 'عنوان متزامن' }),
      adminRequest('/api/v1/admin/about', 'PATCH', { introTitleAr: 'مقدمة متزامنة' }),
    ])
    expect(hero.status).toBe(200)
    expect(introduction.status).toBe(200)
    await expect(repository.find()).resolves.toMatchObject({
      heroTitleAr: 'عنوان متزامن', introTitleAr: 'مقدمة متزامنة',
    })
    expect(audit.events).toHaveLength(2)
  })

  it('documents exactly three About Us operations and preserves media resource compatibility', async () => {
    const document = await (await app.request('/openapi.json')).json() as { paths: Record<string, Record<string, unknown>>, components: { schemas: Record<string, unknown> } }
    expect(document.paths['/api/v1/about']?.get).toBeDefined()
    expect(document.paths['/api/v1/admin/about']?.get).toBeDefined()
    expect(document.paths['/api/v1/admin/about']?.patch).toBeDefined()
    expect(document.paths['/api/v1/admin/about']?.post).toBeUndefined()
    expect(JSON.stringify(document.components.schemas.AboutUsPublic)).toContain('updatedAt')
    expect(JSON.stringify(document.components.schemas.MediaResource)).toContain('about')
  })
})
