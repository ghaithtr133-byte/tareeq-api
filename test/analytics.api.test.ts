import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AnalyticsRuntime } from '../src/analytics/runtime.js'
import { AnalyticsService } from '../src/analytics/service.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import { createApp } from '../src/app.js'
import type { AuthConfig } from '../src/config/env.js'
import { InMemoryAnalyticsRepository } from './helpers/in-memory-analytics-repository.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'

const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const ADMIN_ORIGIN = 'https://admin.tareeq-academy.com'
const SUPER_ID = '11111111-1111-4111-8111-111111111111'
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VISITOR_ONE = '42eea975-4f11-4421-b105-d66aa9240c0f'
const VISITOR_TWO = '0c54ecf9-a4f8-4fc3-91a1-acfe3ec45668'
const SESSION_ONE = 'b470a73b-1f04-45a1-9045-96237f868b65'
const SESSION_TWO = '2cbb86a5-1cb8-4479-9a0f-3fe023a0c116'
const JWT_SECRET = 'analytics-test-secret-that-is-longer-than-thirty-two-characters'
const NOW = new Date('2026-11-02T12:00:00.000Z')

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ADMIN_ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

describe('visitor analytics and student journeys', () => {
  let app: ReturnType<typeof createApp>
  let repository: InMemoryAnalyticsRepository
  let superToken: string
  let adminToken: string

  beforeAll(async () => {
    superToken = await signAccessToken({ id: SUPER_ID, role: 'SUPER_ADMIN' }, JWT_SECRET)
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
  })

  beforeEach(() => {
    repository = new InMemoryAnalyticsRepository()
    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({ id: SUPER_ID, name: 'Super Admin', email: 'super@example.invalid', passwordHash: '$argon2id$test', role: 'SUPER_ADMIN', isActive: true })
    authRepository.addUser({ id: ADMIN_ID, name: 'Admin', email: 'admin@example.invalid', passwordHash: '$argon2id$test', role: 'ADMIN', isActive: true })
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(authRepository, JWT_SECRET),
    }
    const analyticsRuntime: AnalyticsRuntime = {
      getService: () => new AnalyticsService(repository, JWT_SECRET, () => new Date(NOW)),
    }
    app = createApp({ analyticsRuntime, authRuntime })
  })

  const event = (overrides: Record<string, unknown> = {}) => ({
    eventId: crypto.randomUUID(),
    visitorId: VISITOR_ONE,
    sessionId: SESSION_ONE,
    type: 'PAGE_VIEW',
    path: '/scholarships',
    occurredAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  })
  const ingest = (body: unknown, client = '203.0.113.10', origin = PUBLIC_ORIGIN) =>
    app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': client,
      },
      body: JSON.stringify(body),
    })
  const adminGet = (path: string, role: 'ADMIN' | 'SUPER_ADMIN' = 'SUPER_ADMIN') =>
    app.request(path, {
      headers: {
        Origin: ADMIN_ORIGIN,
        Cookie: `${ACCESS_COOKIE_NAME}=${role === 'SUPER_ADMIN' ? superToken : adminToken}`,
      },
    })

  it('accepts allowlisted anonymous events idempotently without storing the client address', async () => {
    const body = event({
      referrerHost: 'www.google.com',
      referrerPath: '/search',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'fall-scholarships',
    })
    const first = await ingest(body)
    expect(first.status).toBe(202)
    expect(first.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN)
    await expect(first.json()).resolves.toEqual({
      success: true,
      data: { accepted: true, duplicate: false },
    })
    const duplicate = await ingest(body)
    await expect(duplicate.json()).resolves.toMatchObject({ data: { duplicate: true } })
    expect(repository.events).toHaveLength(1)
    expect(JSON.stringify(repository.events)).not.toContain('203.0.113.10')
  })

  it('rejects unsupported events, arbitrary metadata, sensitive fields, full URLs, and disallowed origins', async () => {
    for (const body of [
      event({ type: 'FORM_FIELD_CHANGED' }),
      event({ metadata: { arbitrary: true } }),
      event({ email: 'student@example.invalid' }),
      event({ fullName: 'Student Name' }),
      event({ phone: '+963900000000' }),
      event({ message: 'private student message' }),
      event({ token: 'must-not-be-collected' }),
      event({ path: '/apply?email=student@example.invalid' }),
      event({ referrerHost: 'https://google.com/search?q=student' }),
      event({ utmCampaign: 'student@example.invalid' }),
    ]) {
      expect((await ingest(body)).status).toBe(400)
    }
    const forbidden = await ingest(event(), '203.0.113.10', 'https://evil.example')
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } })
    expect(repository.events).toHaveLength(0)
  })

  it('enforces identifier, event-shape, event-time, media-type, and 8 KiB payload validation', async () => {
    expect((await ingest(event({ visitorId: 'not-a-uuid' }))).status).toBe(400)
    expect((await ingest(event({ type: 'CTA_CLICK' }))).status).toBe(400)
    expect((await ingest(event({ occurredAt: '2026-10-31T00:00:00.000Z' }))).status).toBe(400)

    const wrongMedia = await app.request('/api/v1/analytics/events', {
      method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'text/plain' }, body: '{}',
    })
    expect(wrongMedia.status).toBe(415)
    const oversized = await ingest({ padding: 'x'.repeat(9_000) })
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: 'ANALYTICS_PAYLOAD_TOO_LARGE' } })
  })

  it('rate limits repeated anonymous ingestion without exposing the identifier hash', async () => {
    for (let index = 0; index < 120; index += 1) {
      expect((await ingest(event(), '198.51.100.20')).status).toBe(202)
    }
    const limited = await ingest(event(), '198.51.100.20')
    expect(limited.status).toBe(429)
    const body = await limited.json()
    expect(body).toMatchObject({ error: { code: 'ANALYTICS_RATE_LIMITED' } })
    expect(JSON.stringify(body)).not.toMatch(/198\.51\.100\.20|identifierHash/i)
  })

  it('restricts reporting to SUPER_ADMIN and safely handles an empty dataset', async () => {
    expect((await app.request('/api/v1/admin/analytics/summary')).status).toBe(401)
    expect((await adminGet('/api/v1/admin/analytics/summary', 'ADMIN')).status).toBe(403)
    expect((await adminGet('/api/v1/admin/analytics/journeys', 'ADMIN')).status).toBe(403)
    const empty = await adminGet('/api/v1/admin/analytics/summary')
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toMatchObject({
      data: {
        totals: { pageViews: 0, visitors: 0, sessions: 0 },
        topPages: [], trafficSources: [], ctaEngagement: [], trends: [],
        clientReportedConversions: { applications: 0, inquiries: 0, total: 0 },
        serverVerifiedConversions: { applications: 0, inquiries: 0, total: 0 },
      },
    })
  })

  it('calculates acquisition, CTA, conversion, funnel, and trend aggregates without conflating verified submissions', async () => {
    const events = [
      event({ path: '/', occurredAt: '2026-11-01T13:00:00.000Z', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'fall' }),
      event({ path: '/universities/alpha', occurredAt: '2026-11-01T13:01:00.000Z', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'fall' }),
      event({ type: 'CTA_CLICK', path: '/universities/alpha', ctaId: 'APPLY_NOW', targetPath: '/apply', occurredAt: '2026-11-01T13:02:00.000Z' }),
      event({ type: 'APPLICATION_SUBMITTED', path: '/apply', occurredAt: '2026-11-01T13:03:00.000Z' }),
      event({ visitorId: VISITOR_TWO, sessionId: SESSION_TWO, path: '/', occurredAt: '2026-11-02T08:00:00.000Z', referrerHost: 'example.org' }),
      event({ visitorId: VISITOR_TWO, sessionId: SESSION_TWO, type: 'CTA_CLICK', path: '/', ctaId: 'CONTACT_US', targetPath: '/contact', occurredAt: '2026-11-02T08:01:00.000Z' }),
      event({ visitorId: VISITOR_TWO, sessionId: SESSION_TWO, type: 'INQUIRY_SUBMITTED', path: '/contact', occurredAt: '2026-11-02T08:02:00.000Z' }),
    ]
    for (const item of events) expect((await ingest(item)).status).toBe(202)
    repository.serverApplications.push(new Date('2026-11-01T13:04:00.000Z'))

    const response = await adminGet('/api/v1/admin/analytics/summary?from=2026-11-01&to=2026-11-02&granularity=day')
    expect(response.status).toBe(200)
    const summary = await response.json() as { data: { topPages: unknown[] } }
    expect(summary.data.topPages[0]).toMatchObject({ path: '/', pageViews: 2, visitors: 2 })
    expect(summary).toMatchObject({
      data: {
        totals: { pageViews: 3, visitors: 2, sessions: 2 },
        clientReportedConversions: { applications: 1, inquiries: 1, total: 2 },
        serverVerifiedConversions: { applications: 1, inquiries: 0, total: 1 },
        conversionRates: { clientReportedSessionRate: 100 },
        funnel: [
          { step: 'PAGE_VIEW', sessions: 2 },
          { step: 'CTA_CLICK', sessions: 2, rateFromPrevious: 100 },
          { step: 'CLIENT_REPORTED_CONVERSION', sessions: 2, rateFromPrevious: 100 },
        ],
        trends: [{ periodStart: '2026-11-01T00:00:00.000Z' }, { periodStart: '2026-11-02T00:00:00.000Z' }],
      },
    })
  })

  it('counts funnel stages only when they occur in page-view, CTA, conversion order', async () => {
    const conversionOnlySession = '3753122c-544c-4d4f-8681-d385f4eaeb36'
    const outOfOrderSession = '35b40178-63d1-432d-8237-818250ba445e'
    await ingest(event({
      sessionId: conversionOnlySession,
      type: 'APPLICATION_SUBMITTED',
      path: '/apply',
      occurredAt: '2026-11-02T08:00:00.000Z',
    }))
    await ingest(event({
      sessionId: outOfOrderSession,
      type: 'CTA_CLICK',
      ctaId: 'APPLY_NOW',
      path: '/universities/alpha',
      occurredAt: '2026-11-02T08:01:00.000Z',
    }))
    await ingest(event({
      sessionId: outOfOrderSession,
      path: '/universities/alpha',
      occurredAt: '2026-11-02T08:02:00.000Z',
    }))

    const response = await adminGet('/api/v1/admin/analytics/summary?from=2026-11-02&to=2026-11-02')
    await expect(response.json()).resolves.toMatchObject({
      data: {
        totals: { sessions: 2 },
        clientReportedConversions: { applications: 1, total: 1 },
        funnel: [
          { step: 'PAGE_VIEW', sessions: 1, rateFromPrevious: null },
          { step: 'CTA_CLICK', sessions: 0, rateFromPrevious: 0 },
          { step: 'CLIENT_REPORTED_CONVERSION', sessions: 0, rateFromPrevious: 0 },
        ],
      },
    })
  })

  it('returns deterministic paginated journeys and validates bounded date ranges', async () => {
    await ingest(event({ path: '/', occurredAt: '2026-11-01T13:00:00.000Z' }))
    await ingest(event({ type: 'CTA_CLICK', path: '/', ctaId: 'APPLY_NOW', targetPath: '/apply', occurredAt: '2026-11-01T13:01:00.000Z' }))
    await ingest(event({ visitorId: VISITOR_TWO, sessionId: SESSION_TWO, path: '/services', occurredAt: '2026-11-02T09:00:00.000Z' }))

    const response = await adminGet('/api/v1/admin/analytics/journeys?from=2026-11-01&to=2026-11-02&page=1&limit=1')
    const body = await response.json() as { data: { items: Array<{ sessionId: string }>; pagination: Record<string, number> } }
    expect(response.status).toBe(200)
    expect(body.data.items[0]?.sessionId).toBe(SESSION_TWO)
    expect(body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 })

    const reversed = await adminGet('/api/v1/admin/analytics/summary?from=2026-11-02&to=2026-11-01')
    expect(reversed.status).toBe(400)
    await expect(reversed.json()).resolves.toMatchObject({ error: { code: 'ANALYTICS_DATE_RANGE_INVALID' } })
    expect((await adminGet('/api/v1/admin/analytics/journeys?limit=21')).status).toBe(400)
  })
})
