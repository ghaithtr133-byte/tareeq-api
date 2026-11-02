import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditService } from '../src/audit/service.js'
import type { AuditRuntime } from '../src/audit/runtime.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import type { ContentRuntime } from '../src/content/runtime.js'
import { ContentService } from '../src/content/service.js'
import type { SubmissionRuntime } from '../src/submissions/runtime.js'
import { SubmissionService } from '../src/submissions/service.js'
import { InMemoryAuditRepository } from './helpers/in-memory-audit-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryContentRepository } from './helpers/in-memory-content-repository.js'
import { InMemorySubmissionRepository } from './helpers/in-memory-submission-repository.js'

const ORIGIN = 'http://localhost:3001'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222'
const JWT_SECRET = 'audit-test-secret-that-is-longer-than-thirty-two-characters'
const FIXED_NOW = new Date('2026-10-31T12:00:00.000Z')

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ORIGIN],
  publicAllowedOrigins: [ORIGIN],
  isProduction: false,
}

const countryInput = {
  nameAr: 'ألمانيا',
  slug: 'germany',
  introductionAr: 'مقدمة',
  detailsAr: 'تفاصيل',
  status: 'DRAFT',
}

describe('Admin activity audit logs', () => {
  let app: ReturnType<typeof createApp>
  let audit: InMemoryAuditRepository
  let content: InMemoryContentRepository
  let submissions: InMemorySubmissionRepository
  let adminToken: string
  let superAdminToken: string
  let auditNow: Date

  beforeAll(async () => {
    adminToken = await signAccessToken(
      { id: ADMIN_ID, role: 'ADMIN' },
      JWT_SECRET,
    )
    superAdminToken = await signAccessToken(
      { id: SUPER_ADMIN_ID, role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
  })

  beforeEach(() => {
    auditNow = new Date(FIXED_NOW)
    audit = new InMemoryAuditRepository(() => new Date(auditNow))
    audit.actors.set(ADMIN_ID, 'Content Admin')
    audit.actors.set(SUPER_ADMIN_ID, 'Super Admin')
    content = new InMemoryContentRepository(audit)
    submissions = new InMemorySubmissionRepository(audit)
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
    const auditRuntime: AuditRuntime = {
      getService: () => new AuditService(audit),
    }
    const contentRuntime: ContentRuntime = {
      getService: () => new ContentService(content, () => new Date(FIXED_NOW)),
    }
    const submissionRuntime: SubmissionRuntime = {
      getService: () => new SubmissionService(
        submissions,
        JWT_SECRET,
        () => new Date(FIXED_NOW),
      ),
    }
    app = createApp({
      auditRuntime,
      authRuntime,
      contentRuntime,
      submissionRuntime,
    })
  })

  const request = (
    path: string,
    role: AdminRole,
    method = 'GET',
    body?: unknown,
  ) => app.request(path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: `${ACCESS_COOKIE_NAME}=${role === 'ADMIN' ? adminToken : superAdminToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  it('automatically attributes content and submission mutations to the actor and resource', async () => {
    const created = await request(
      '/api/v1/admin/countries',
      'ADMIN',
      'POST',
      countryInput,
    )
    expect(created.status).toBe(201)
    const createdBody = await created.json() as { data: { id: string } }

    auditNow = new Date('2026-10-31T12:00:30.000Z')
    const published = await request(
      `/api/v1/admin/countries/${createdBody.data.id}`,
      'ADMIN',
      'PATCH',
      { status: 'PUBLISHED' },
    )
    expect(published.status).toBe(200)

    submissions.applications.push({
      id: RESOURCE_ID,
      applicationType: 'UNIVERSITY_ADMISSION',
      scholarshipId: null,
      countryId: null,
      universityId: null,
      studyLevel: null,
      intendedMajor: null,
      fullName: 'Sensitive Student Name',
      email: 'student@example.invalid',
      phone: '+963 900 000 000',
      message: 'Sensitive student message that must never be audited.',
      status: 'NEW',
      internalNote: null,
      privacyAcceptedAt: new Date(FIXED_NOW),
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
    })
    auditNow = new Date('2026-10-31T12:01:00.000Z')
    const updated = await request(
      `/api/v1/admin/applications/${RESOURCE_ID}/status`,
      'SUPER_ADMIN',
      'PATCH',
      { status: 'IN_REVIEW', internalNote: 'Sensitive private note.' },
    )
    expect(updated.status).toBe(200)

    const inquiryId = '33333333-3333-4333-8333-333333333333'
    submissions.inquiries.push({
      id: inquiryId,
      fullName: 'Sensitive Inquirer Name',
      email: 'inquirer@example.invalid',
      phone: null,
      subject: 'Sensitive subject',
      message: 'Sensitive inquiry message that must never be audited.',
      status: 'NEW',
      internalNote: null,
      privacyAcceptedAt: new Date(FIXED_NOW),
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
    })
    auditNow = new Date('2026-10-31T12:02:00.000Z')
    const resolved = await request(
      `/api/v1/admin/inquiries/${inquiryId}/status`,
      'ADMIN',
      'PATCH',
      { status: 'RESOLVED' },
    )
    expect(resolved.status).toBe(200)

    expect(audit.events).toHaveLength(4)
    expect(audit.events[0]).toMatchObject({
      actorAdminId: ADMIN_ID,
      action: 'content.country.created',
      resourceType: 'COUNTRY',
      resourceId: createdBody.data.id,
      metadata: { status: 'DRAFT' },
    })
    expect(audit.events[1]).toMatchObject({
      actorAdminId: ADMIN_ID,
      action: 'content.country.status_changed',
      resourceType: 'COUNTRY',
      resourceId: createdBody.data.id,
      metadata: {
        changedFields: ['status'],
        fromStatus: 'DRAFT',
        toStatus: 'PUBLISHED',
      },
    })
    expect(audit.events[2]).toMatchObject({
      actorAdminId: SUPER_ADMIN_ID,
      action: 'student_application.status_changed',
      resourceType: 'STUDENT_APPLICATION',
      resourceId: RESOURCE_ID,
      metadata: {
        changedFields: ['internalNote', 'status'],
        fromStatus: 'NEW',
        toStatus: 'IN_REVIEW',
        internalNoteChanged: true,
      },
    })
    expect(audit.events[3]).toMatchObject({
      actorAdminId: ADMIN_ID,
      action: 'general_inquiry.status_changed',
      resourceType: 'GENERAL_INQUIRY',
      resourceId: inquiryId,
      metadata: {
        changedFields: ['status'],
        fromStatus: 'NEW',
        toStatus: 'RESOLVED',
        internalNoteChanged: false,
      },
    })
    const serialized = JSON.stringify(audit.events)
    expect(serialized).not.toContain('Sensitive Student Name')
    expect(serialized).not.toContain('student@example.invalid')
    expect(serialized).not.toContain('Sensitive student message')
    expect(serialized).not.toContain('Sensitive private note')
    expect(serialized).not.toContain('Sensitive Inquirer Name')
    expect(serialized).not.toContain('inquirer@example.invalid')
    expect(serialized).not.toContain('Sensitive inquiry message')
  })

  it('restricts audit reads to SUPER_ADMIN while preserving trusted-origin handling', async () => {
    const unauthenticated = await app.request('/api/v1/admin/audit-logs')
    expect(unauthenticated.status).toBe(401)

    const forbidden = await request('/api/v1/admin/audit-logs', 'ADMIN')
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    })

    const allowed = await request('/api/v1/admin/audit-logs', 'SUPER_ADMIN')
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('paginates deterministically and filters by actor, action, resource, and dates', async () => {
    await audit.append({
      actorAdminId: ADMIN_ID,
      action: 'content.country.created',
      resourceType: 'COUNTRY',
      metadata: { status: 'DRAFT' },
    }, RESOURCE_ID)
    auditNow = new Date('2026-10-31T12:01:00.000Z')
    await audit.append({
      actorAdminId: SUPER_ADMIN_ID,
      action: 'general_inquiry.status_changed',
      resourceType: 'GENERAL_INQUIRY',
      metadata: { fromStatus: 'NEW', toStatus: 'RESOLVED' },
    }, '33333333-3333-4333-8333-333333333333')
    auditNow = new Date('2026-10-31T12:02:00.000Z')
    await audit.append({
      actorAdminId: SUPER_ADMIN_ID,
      action: 'content.country.status_changed',
      resourceType: 'COUNTRY',
      metadata: { fromStatus: 'DRAFT', toStatus: 'PUBLISHED' },
    }, RESOURCE_ID)

    const page = await request(
      '/api/v1/admin/audit-logs?page=1&limit=2',
      'SUPER_ADMIN',
    )
    const pageBody = await page.json() as {
      data: { items: Array<{ action: string }>; pagination: Record<string, number> }
    }
    expect(pageBody.data.items.map(({ action }) => action)).toEqual([
      'content.country.status_changed',
      'general_inquiry.status_changed',
    ])
    expect(pageBody.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    })

    const filtered = await request(
      `/api/v1/admin/audit-logs?actorId=${SUPER_ADMIN_ID}&action=content.country.status_changed&resourceType=COUNTRY&from=2026-10-31T12%3A01%3A30.000Z&to=2026-10-31T12%3A02%3A30.000Z`,
      'SUPER_ADMIN',
    )
    await expect(filtered.json()).resolves.toMatchObject({
      data: {
        items: [{ action: 'content.country.status_changed' }],
        pagination: { total: 1 },
      },
    })
  })

  it('returns field-level validation errors for invalid filters and date ranges', async () => {
    const invalid = await request(
      '/api/v1/admin/audit-logs?page=0&resourceType=PASSWORD',
      'SUPER_ADMIN',
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: { fields: { page: expect.any(Array), resourceType: expect.any(Array) } },
      },
    })

    const reversed = await request(
      '/api/v1/admin/audit-logs?from=2026-11-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z',
      'SUPER_ADMIN',
    )
    expect(reversed.status).toBe(400)
    await expect(reversed.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: { from: expect.any(Array) } } },
    })
  })

  it('rolls back the business mutation when the audit write fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audit.failNextWrite = true
    const failed = await request(
      '/api/v1/admin/countries',
      'ADMIN',
      'POST',
      countryInput,
    )
    expect(failed.status).toBe(500)
    await expect(failed.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
    })
    expect(audit.events).toHaveLength(0)
    await expect(content.list('countries', {
      page: 1,
      limit: 12,
      sort: 'newest',
    }, false, FIXED_NOW)).resolves.toMatchObject({ total: 0 })
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Simulated audit write failure')
  })

  it('documents one read-only audit operation and no mutation operation', async () => {
    const response = await app.request('/openapi.json')
    const document = await response.json() as {
      paths: Record<string, Record<string, {
        security?: Array<Record<string, unknown>>
        parameters?: Array<{ name?: string }>
      }>>
    }
    const path = document.paths['/api/v1/admin/audit-logs']
    expect(path?.get?.security).toEqual([{ accessCookie: [] }])
    expect(path?.get?.parameters?.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['page', 'limit', 'actorId', 'action', 'resourceType', 'from', 'to']),
    )
    expect(path?.post).toBeUndefined()
    expect(path?.patch).toBeUndefined()
    expect(path?.delete).toBeUndefined()
  })
})
