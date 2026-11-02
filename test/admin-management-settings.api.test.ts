import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminManagementService } from '../src/admin-management/service.js'
import type { AdminManagementRuntime } from '../src/admin-management/runtime.js'
import { AuditService } from '../src/audit/service.js'
import type { AuditRuntime } from '../src/audit/runtime.js'
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../src/auth/constants.js'
import { hashRefreshToken, signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import type { SiteSettingsRuntime } from '../src/site-settings/runtime.js'
import { SiteSettingsService } from '../src/site-settings/service.js'
import { InMemoryAuditRepository } from './helpers/in-memory-audit-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemorySiteSettingsRepository } from './helpers/in-memory-site-settings-repository.js'

const ORIGIN = 'http://localhost:3001'
const PUBLIC_ORIGIN = 'http://localhost:3002'
const SUPER_ONE_ID = '11111111-1111-4111-8111-111111111111'
const SUPER_TWO_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const JWT_SECRET = 'task-nine-test-secret-longer-than-thirty-two-characters'
const FIXED_NOW = new Date('2026-11-01T10:00:00.000Z')

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

const account = (
  id: string,
  role: AdminRole,
  name: string,
) => ({
  id,
  name,
  email: `${name.toLowerCase().replaceAll(' ', '-')}@example.invalid`,
  passwordHash: '$argon2id$test-only-never-return',
  role,
  isActive: true,
})

describe('SUPER_ADMIN account management and site settings', () => {
  let app: ReturnType<typeof createApp>
  let audit: InMemoryAuditRepository
  let authRepository: InMemoryAuthRepository
  let superOneToken: string
  let superTwoToken: string
  let adminToken: string
  let targetToken: string

  beforeAll(async () => {
    superOneToken = await signAccessToken(
      { id: SUPER_ONE_ID, role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
    superTwoToken = await signAccessToken(
      { id: SUPER_TWO_ID, role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    targetToken = await signAccessToken({ id: TARGET_ID, role: 'ADMIN' }, JWT_SECRET)
  })

  beforeEach(() => {
    audit = new InMemoryAuditRepository(() => new Date(FIXED_NOW))
    authRepository = new InMemoryAuthRepository(audit)
    authRepository.addUser(account(SUPER_ONE_ID, 'SUPER_ADMIN', 'Super One'))
    authRepository.addUser(account(SUPER_TWO_ID, 'SUPER_ADMIN', 'Super Two'))
    authRepository.addUser(account(ADMIN_ID, 'ADMIN', 'Regular Admin'))
    authRepository.addUser(account(TARGET_ID, 'ADMIN', 'Target Admin'))

    const authService = new AuthService(authRepository, JWT_SECRET)
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => authService,
    }
    const adminManagementRuntime: AdminManagementRuntime = {
      getService: () => new AdminManagementService(
        authRepository,
        () => new Date(FIXED_NOW),
      ),
    }
    const auditRuntime: AuditRuntime = {
      getService: () => new AuditService(audit),
    }
    const siteSettingsService = new SiteSettingsService(
      new InMemorySiteSettingsRepository(
        authRepository,
        audit,
        () => new Date(FIXED_NOW),
      ),
    )
    const siteSettingsRuntime: SiteSettingsRuntime = {
      getService: () => siteSettingsService,
    }
    app = createApp({
      adminManagementRuntime,
      auditRuntime,
      authRuntime,
      siteSettingsRuntime,
    })
  })

  const tokenFor = (identity: 'super1' | 'super2' | 'admin' | 'target') => ({
    super1: superOneToken,
    super2: superTwoToken,
    admin: adminToken,
    target: targetToken,
  })[identity]

  const request = (
    path: string,
    identity: 'super1' | 'super2' | 'admin' | 'target',
    method = 'GET',
    body?: unknown,
  ) => app.request(path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: `${ACCESS_COOKIE_NAME}=${tokenFor(identity)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  it('restricts account management to SUPER_ADMIN and lists only safe fields', async () => {
    expect((await app.request('/api/v1/admin/users')).status).toBe(401)
    expect((await request('/api/v1/admin/users', 'admin')).status).toBe(403)

    const response = await request('/api/v1/admin/users?page=1&limit=2', 'super1')
    const body = await response.json() as {
      data: { items: unknown[]; pagination: Record<string, number> }
    }
    expect(response.status).toBe(200)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
    })
    expect(JSON.stringify(body)).not.toMatch(/password|token|hash|session/i)
  })

  it('changes roles and immediately uses the authoritative database role', async () => {
    const promoted = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { role: 'SUPER_ADMIN' },
    )
    expect(promoted.status).toBe(200)
    await expect(promoted.json()).resolves.toMatchObject({
      data: { id: TARGET_ID, role: 'SUPER_ADMIN', isActive: true },
    })

    const staleTokenRequest = await request('/api/v1/admin/users', 'target')
    expect(staleTokenRequest.status).toBe(200)
    expect(audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorAdminId: SUPER_ONE_ID,
        action: 'admin_account.role_changed',
        resourceType: 'ADMIN_USER',
        resourceId: TARGET_ID,
        metadata: { fromRole: 'ADMIN', toRole: 'SUPER_ADMIN' },
      }),
    ]))

    const invalid = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { role: 'OWNER' },
    )
    expect(invalid.status).toBe(400)
    const multiple = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { role: 'ADMIN', isActive: false },
    )
    expect(multiple.status).toBe(400)
  })

  it('deactivates and reactivates accounts, revokes refresh sessions, and rejects existing access cookies', async () => {
    const refreshToken = 'target-existing-refresh-session'
    authRepository.seedSession({
      userId: TARGET_ID,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    })

    const deactivated = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { isActive: false },
    )
    expect(deactivated.status).toBe(200)
    expect(authRepository.getActiveSessionCount(TARGET_ID)).toBe(0)
    expect((await request('/api/v1/admin/users', 'target')).status).toBe(401)

    const refresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
      },
    })
    expect(refresh.status).toBe(401)
    expect(audit.events.at(-1)).toMatchObject({
      action: 'admin_account.deactivated',
      actorAdminId: SUPER_ONE_ID,
      resourceId: TARGET_ID,
      metadata: { fromActive: true, toActive: false },
    })

    const reactivated = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { isActive: true },
    )
    expect(reactivated.status).toBe(200)
    expect((await request('/api/v1/admin/users', 'target')).status).toBe(403)
  })

  it('prevents unsafe self changes and preserves an active SUPER_ADMIN under concurrent requests', async () => {
    const selfDeactivate = await request(
      `/api/v1/admin/users/${SUPER_ONE_ID}`,
      'super1',
      'PATCH',
      { isActive: false },
    )
    expect(selfDeactivate.status).toBe(409)
    await expect(selfDeactivate.json()).resolves.toMatchObject({
      error: { code: 'SELF_DEACTIVATION_FORBIDDEN' },
    })

    const selfDemote = await request(
      `/api/v1/admin/users/${SUPER_ONE_ID}`,
      'super1',
      'PATCH',
      { role: 'ADMIN' },
    )
    expect(selfDemote.status).toBe(409)
    await expect(selfDemote.json()).resolves.toMatchObject({
      error: { code: 'SELF_DEMOTION_FORBIDDEN' },
    })

    const responses = await Promise.all([
      request(
        `/api/v1/admin/users/${SUPER_TWO_ID}`,
        'super1',
        'PATCH',
        { isActive: false },
      ),
      request(
        `/api/v1/admin/users/${SUPER_ONE_ID}`,
        'super2',
        'PATCH',
        { isActive: false },
      ),
    ])
    const statuses = responses.map(({ status }) => status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 401 || status === 403)).toHaveLength(1)
    const activeSupers = authRepository.getUsers().filter(
      (user) => user.role === 'SUPER_ADMIN' && user.isActive,
    )
    expect(activeSupers).toHaveLength(1)
  })

  it('rolls back account changes and session revocation when audit persistence fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    authRepository.seedSession({
      userId: TARGET_ID,
      tokenHash: 'existing-session-hash',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    })
    audit.failNextWrite = true

    const failed = await request(
      `/api/v1/admin/users/${TARGET_ID}`,
      'super1',
      'PATCH',
      { isActive: false },
    )
    expect(failed.status).toBe(500)
    expect((await authRepository.findAdminById(TARGET_ID))?.isActive).toBe(true)
    expect(authRepository.getActiveSessionCount(TARGET_ID)).toBe(1)
    expect(audit.events).toHaveLength(0)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Simulated audit write failure')
  })

  it('returns safe empty public settings and validates SUPER_ADMIN updates', async () => {
    const empty = await app.request('/api/v1/site-settings', {
      headers: { Origin: PUBLIC_ORIGIN },
    })
    expect(empty.status).toBe(200)
    expect(empty.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    await expect(empty.json()).resolves.toMatchObject({
      success: true,
      data: { academyNameAr: null, contactEmail: null, updatedAt: null },
    })

    expect((await request(
      '/api/v1/admin/site-settings',
      'admin',
      'PATCH',
      { academyNameAr: 'أكاديمية طريق' },
    )).status).toBe(403)

    for (const invalidBody of [
      {},
      { apiKey: 'must-not-be-accepted' },
      { facebookUrl: 'https://example.com/not-facebook' },
      { instagramUrl: 'http://instagram.com/insecure' },
      { contactEmail: 'not-an-email' },
    ]) {
      const invalid = await request(
        '/api/v1/admin/site-settings',
        'super1',
        'PATCH',
        invalidBody,
      )
      expect(invalid.status).toBe(400)
    }

    const updated = await request(
      '/api/v1/admin/site-settings',
      'super1',
      'PATCH',
      {
        academyNameAr: 'أكاديمية طريق',
        contactEmail: 'CONTACT@example.invalid',
        contactPhone: '+963 900 000 000',
        facebookUrl: 'https://www.facebook.com/tareeqacademy',
      },
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        academyNameAr: 'أكاديمية طريق',
        contactEmail: 'contact@example.invalid',
        updatedAt: FIXED_NOW.toISOString(),
      },
    })

    const publicSettings = await app.request('/api/v1/site-settings')
    await expect(publicSettings.json()).resolves.toMatchObject({
      data: {
        academyNameAr: 'أكاديمية طريق',
        contactEmail: 'contact@example.invalid',
      },
    })
    const event = audit.events.at(-1)
    expect(event).toMatchObject({
      actorAdminId: SUPER_ONE_ID,
      action: 'site_settings.updated',
      resourceType: 'SITE_SETTINGS',
      metadata: {
        changedFields: [
          'academyNameAr',
          'contactEmail',
          'contactPhone',
          'facebookUrl',
        ],
      },
    })
    expect(JSON.stringify(event)).not.toContain('CONTACT@example.invalid')
    expect(JSON.stringify(event)).not.toContain('+963')
  })

  it('rolls back site settings when audit persistence fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audit.failNextWrite = true
    const failed = await request(
      '/api/v1/admin/site-settings',
      'super1',
      'PATCH',
      { academyNameEn: 'Tareeq Academy' },
    )
    expect(failed.status).toBe(500)
    const current = await app.request('/api/v1/site-settings')
    await expect(current.json()).resolves.toMatchObject({
      data: { academyNameEn: null, updatedAt: null },
    })
    expect(audit.events).toHaveLength(0)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Simulated audit write failure')
  })

  it('documents exactly the four Task #9 operations without creation or deletion APIs', async () => {
    const response = await app.request('/openapi.json')
    const document = await response.json() as {
      paths: Record<string, Record<string, {
        security?: Array<Record<string, unknown>>
      }>>
    }
    expect(document.paths['/api/v1/admin/users']?.get?.security).toEqual([{ accessCookie: [] }])
    expect(document.paths['/api/v1/admin/users/{id}']?.patch?.security).toEqual([{ accessCookie: [] }])
    expect(document.paths['/api/v1/site-settings']?.get?.security).toBeUndefined()
    expect(document.paths['/api/v1/admin/site-settings']?.patch?.security).toEqual([{ accessCookie: [] }])
    expect(document.paths['/api/v1/admin/users']?.post).toBeUndefined()
    expect(document.paths['/api/v1/admin/users/{id}']?.delete).toBeUndefined()
    expect(document.paths['/api/v1/admin/site-settings']?.delete).toBeUndefined()
  })
})
