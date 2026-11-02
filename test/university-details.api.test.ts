import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import type { UniversityDetailsRuntime } from '../src/university-details/runtime.js'
import { UniversityDetailsService } from '../src/university-details/service.js'
import { InMemoryAuditRepository } from './helpers/in-memory-audit-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryUniversityDetailsRepository } from './helpers/in-memory-university-details-repository.js'

const ADMIN_ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ID = '11111111-1111-4111-8111-111111111111'
const UNIVERSITY_ID = '88008b68-b698-4725-93e9-801537e7797c'
const OTHER_UNIVERSITY_ID = '99008b68-b698-4725-93e9-801537e7797c'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_PROGRAM_ID = '20000000-0000-4000-8000-000000000002'
const JWT_SECRET = 'university-details-test-secret-longer-than-thirty-two'
const NOW = new Date('2026-11-02T12:00:00.000Z')
const config: AuthConfig = { databaseUrl: 'postgresql://unused:unused@localhost:5432/unused', jwtSecret: JWT_SECRET, allowedOrigins: [ADMIN_ORIGIN], publicAllowedOrigins: [PUBLIC_ORIGIN], isProduction: false }

describe('University details admission and gallery APIs', () => {
  let app: ReturnType<typeof createApp>
  let repository: InMemoryUniversityDetailsRepository
  let audit: InMemoryAuditRepository
  let adminToken: string
  let superToken: string

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superToken = await signAccessToken({ id: SUPER_ID, role: 'SUPER_ADMIN' }, JWT_SECRET)
  })

  beforeEach(() => {
    audit = new InMemoryAuditRepository(() => new Date(NOW))
    repository = new InMemoryUniversityDetailsRepository(audit)
    repository.universities.push(
      { id: UNIVERSITY_ID, slug: 'bucharest-medical', status: 'PUBLISHED' },
      { id: OTHER_UNIVERSITY_ID, slug: 'draft-university', status: 'DRAFT' },
    )
    repository.programs.push(
      { id: PROGRAM_ID, universityId: UNIVERSITY_ID, nameAr: 'الطب والجراحة', nameEn: 'Medicine and Surgery', studyLevel: 'BACHELORS' },
      { id: OTHER_PROGRAM_ID, universityId: OTHER_UNIVERSITY_ID, nameAr: 'الهندسة', nameEn: 'Engineering', studyLevel: 'BACHELORS' },
    )
    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({ id: ADMIN_ID, name: 'Admin', email: 'admin@example.invalid', passwordHash: '$argon2id$test', role: 'ADMIN', isActive: true })
    authRepository.addUser({ id: SUPER_ID, name: 'Super', email: 'super@example.invalid', passwordHash: '$argon2id$test', role: 'SUPER_ADMIN', isActive: true })
    const authRuntime: AuthRuntime = { getConfig: () => config, getService: () => new AuthService(authRepository, JWT_SECRET) }
    const universityDetailsRuntime: UniversityDetailsRuntime = { getService: () => new UniversityDetailsService(repository, () => new Date(NOW)) }
    app = createApp({ authRuntime, universityDetailsRuntime })
  })

  const adminRequest = (path: string, method = 'GET', body?: unknown, role: AdminRole = 'ADMIN') => app.request(path, {
    method,
    headers: { Origin: ADMIN_ORIGIN, Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  it('returns valid empty public tab data and hides unpublished Universities', async () => {
    const admission = await app.request('/api/v1/universities/bucharest-medical/admission-requirements', { headers: { Origin: PUBLIC_ORIGIN } })
    expect(admission.status).toBe(200)
    expect(admission.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    await expect(admission.json()).resolves.toEqual({ success: true, data: { university: [], studyLevels: [], programs: [] } })
    await expect((await app.request('/api/v1/universities/bucharest-medical/gallery')).json()).resolves.toEqual({ success: true, data: { items: [] } })
    expect((await app.request('/api/v1/universities/draft-university/gallery')).status).toBe(404)
  })

  it('keeps University, study-level, and program requirements explicitly separated', async () => {
    const base = { contentAr: 'متطلبات موثقة', status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/admissions', verifiedAt: '2026-11-01T00:00:00.000Z' }
    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/admission-requirements`, 'POST', { ...base, scope: 'UNIVERSITY' })).status).toBe(201)
    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/admission-requirements`, 'POST', { ...base, scope: 'STUDY_LEVEL', studyLevel: 'BACHELORS' })).status).toBe(201)
    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/admission-requirements`, 'POST', { ...base, scope: 'PROGRAM', programId: PROGRAM_ID })).status).toBe(201)
    const response = await app.request('/api/v1/universities/bucharest-medical/admission-requirements')
    const body = await response.json() as { data: { university: unknown[]; studyLevels: unknown[]; programs: Array<{ programId: string }> } }
    expect([body.data.university.length, body.data.studyLevels.length, body.data.programs.length]).toEqual([1, 1, 1])
    expect(body.data.programs[0]?.programId).toBe(PROGRAM_ID)

    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/admission-requirements`, 'POST', { ...base, scope: 'PROGRAM', programId: OTHER_PROGRAM_ID })).status).toBe(400)
    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/admission-requirements`, 'POST', { scope: 'UNIVERSITY', contentAr: 'غير موثق', status: 'PUBLISHED' })).status).toBe(400)
  })

  it('requires explicit gallery attachment, publishes safely, orders deterministically, and detaches only the association', async () => {
    const first = await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/gallery`, 'POST', { imageUrl: 'https://res.cloudinary.com/example/image/upload/first.webp', altAr: 'الأولى', status: 'DRAFT' })
    const second = await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/gallery`, 'POST', { imageUrl: 'https://res.cloudinary.com/example/image/upload/second.webp', altAr: 'الثانية', status: 'PUBLISHED' })
    const firstId = (await first.json() as { data: { id: string } }).data.id
    const secondId = (await second.json() as { data: { id: string } }).data.id
    await expect((await app.request('/api/v1/universities/bucharest-medical/gallery')).json()).resolves.toMatchObject({ data: { items: [{ id: secondId }] } })
    expect((await adminRequest(`/api/v1/admin/university-gallery/${firstId}`, 'PATCH', { status: 'PUBLISHED' })).status).toBe(200)
    expect((await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/gallery/order`, 'PATCH', { orderedIds: [secondId, firstId] })).status).toBe(200)
    const ordered = await (await app.request('/api/v1/universities/bucharest-medical/gallery')).json() as { data: { items: Array<{ id: string }> } }
    expect(ordered.data.items.map(({ id }) => id)).toEqual([secondId, firstId])
    expect((await adminRequest(`/api/v1/admin/university-gallery/${secondId}`, 'DELETE')).status).toBe(200)
    expect(repository.images.some(({ id }) => id === secondId)).toBe(false)
    expect(audit.events.find(({ action }) => action === 'university_gallery_image.detached')?.metadata).not.toHaveProperty('imageUrl')
  })

  it('enforces trusted authenticated ADMIN/SUPER_ADMIN access and validates inputs', async () => {
    const path = `/api/v1/admin/universities/${UNIVERSITY_ID}/gallery`
    expect((await app.request(path)).status).toBe(401)
    expect((await app.request(path, { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: `${ACCESS_COOKIE_NAME}=${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: 'https://example.com/image.jpg' }) })).status).toBe(403)
    expect((await adminRequest(path)).status).toBe(200)
    expect((await adminRequest(path, 'GET', undefined, 'SUPER_ADMIN')).status).toBe(200)
    expect((await adminRequest(path, 'POST', { imageUrl: 'http://example.com/image.jpg' })).status).toBe(400)
  })

  it('rolls back business mutations when the atomic audit write fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audit.failNextWrite = true
    const response = await adminRequest(`/api/v1/admin/universities/${UNIVERSITY_ID}/gallery`, 'POST', { imageUrl: 'https://res.cloudinary.com/example/image/upload/fail.webp', status: 'DRAFT' })
    expect(response.status).toBe(500)
    expect(repository.images).toHaveLength(0)
    log.mockRestore()
  })
})
