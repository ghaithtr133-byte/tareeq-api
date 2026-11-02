import { OpenAPIHono, type z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, publicSubmissionCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, errorResponse, successResponse } from '../shared/http.js'
import type { AnalyticsRuntime } from './runtime.js'
import {
  analyticsErrorResponses,
  analyticsEventAcceptedResponseSchema,
  analyticsEventCreateSchema,
  analyticsJourneyQuerySchema,
  analyticsJourneyResponseSchema,
  analyticsSummaryQuerySchema,
  analyticsSummaryResponseSchema,
} from './schemas.js'
import type { AnalyticsEventInput, AnalyticsJourneyQuery, AnalyticsReportQuery } from './types.js'

export const MAX_ANALYTICS_BODY_BYTES = 8 * 1_024

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', { fields })
}
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error.issues)
  return result.data
}
const queryObject = (url: string) => Object.fromEntries(new URL(url).searchParams.entries())
const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', {
      fields: { _request: ['Provide a valid JSON request body.'] },
    })
  }
}
const clientIdentifier = (request: Request) => request.headers.get('x-forwarded-for')
  ?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || 'unknown-client'

const eventExample = {
  eventId: '51e127de-9938-47d0-9719-013f4e01b138',
  visitorId: '42eea975-4f11-4421-b105-d66aa9240c0f',
  sessionId: 'b470a73b-1f04-45a1-9045-96237f868b65',
  type: 'PAGE_VIEW',
  path: '/scholarships/romania-government',
  referrerHost: 'www.google.com',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'fall-scholarships',
  occurredAt: '2026-11-02T10:00:00.000Z',
}

export const createAnalyticsRoutes = (
  runtime: AnalyticsRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/analytics/events', tags: ['Public — Analytics'],
    summary: 'Record an anonymous analytics event',
    description: 'Public non-credentialed first-party analytics ingestion. Accepts one strictly allowlisted anonymous event, uses no cookies or raw IP storage, enforces an 8 KiB body limit and a shared abuse limit, and treats eventId as an idempotency key. The Public Website must obtain any required consent before sending events.',
    security: [],
    request: { body: { required: true, content: { 'application/json': { schema: analyticsEventCreateSchema, example: eventExample } } } },
    responses: {
      202: {
        description: 'Event accepted; duplicate idempotency keys are safely acknowledged.',
        content: { 'application/json': {
          schema: analyticsEventAcceptedResponseSchema,
          example: { success: true, data: { accepted: true, duplicate: false } },
        } },
      },
      400: analyticsErrorResponses[400], 403: analyticsErrorResponses[403],
      413: analyticsErrorResponses[413], 415: analyticsErrorResponses[415],
      429: analyticsErrorResponses[429],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/analytics/summary', tags: ['Admin — Analytics'],
    summary: 'Get aggregate traffic and conversion analytics',
    description: 'SUPER_ADMIN only. Returns bounded UTC traffic totals, top pages, acquisition attribution, CTA engagement, client-reported conversions, separately labeled server-verified submission totals, a simple event-stage funnel, and daily, weekly, or monthly trends. Date ranges are inclusive and limited to 366 days.',
    security: [{ accessCookie: [] }], request: { query: analyticsSummaryQuerySchema },
    responses: {
      200: {
        description: 'Anonymous aggregate analytics.',
        content: { 'application/json': {
          schema: analyticsSummaryResponseSchema,
          example: { success: true, data: { range: { from: '2026-10-04', to: '2026-11-02', granularity: 'day' }, totals: { pageViews: 1200, visitors: 430, sessions: 510 }, topPages: [{ path: '/scholarships', pageViews: 320, visitors: 210 }], trafficSources: [{ source: 'google', medium: 'cpc', campaign: 'fall-scholarships', sessions: 100, pageViews: 240 }], ctaEngagement: [{ ctaId: 'APPLY_NOW', clicks: 80, sessions: 72 }], clientReportedConversions: { applications: 25, inquiries: 8, total: 33 }, serverVerifiedConversions: { applications: 23, inquiries: 7, total: 30 }, conversionRates: { clientReportedSessionRate: 6.47, applicationSessionRate: 4.9, inquirySessionRate: 1.57 }, funnel: [{ step: 'PAGE_VIEW', sessions: 510, rateFromPrevious: null }, { step: 'CTA_CLICK', sessions: 72, rateFromPrevious: 14.12 }, { step: 'CLIENT_REPORTED_CONVERSION', sessions: 33, rateFromPrevious: 45.83 }], trends: [] } },
        } },
      },
      400: analyticsErrorResponses[400], 401: analyticsErrorResponses[401], 403: analyticsErrorResponses[403],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/analytics/journeys', tags: ['Admin — Analytics'],
    summary: 'List anonymous session journey summaries',
    description: 'SUPER_ADMIN only. Returns paginated anonymous sessions ordered by latest event, with at most 100 allowlisted steps per session. No IP address, identity, form value, message, unrestricted metadata, or visitor fingerprint is returned.',
    security: [{ accessCookie: [] }], request: { query: analyticsJourneyQuerySchema },
    responses: {
      200: {
        description: 'Paginated anonymous journeys.',
        content: { 'application/json': {
          schema: analyticsJourneyResponseSchema,
          example: { success: true, data: { range: { from: '2026-10-04', to: '2026-11-02', granularity: 'day' }, items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } } },
        } },
      },
      400: analyticsErrorResponses[400], 401: analyticsErrorResponses[401], 403: analyticsErrorResponses[403],
    },
  })

  publicRoutes.use('/analytics/events', publicSubmissionCors(authRuntime))
  publicRoutes.use('/analytics/events', bodyLimit({
    maxSize: MAX_ANALYTICS_BODY_BYTES,
    onError: (c) => errorResponse(c, 413, 'ANALYTICS_PAYLOAD_TOO_LARGE', 'Analytics event payload is too large.', { maxBytes: MAX_ANALYTICS_BODY_BYTES }),
  }))
  for (const path of ['/analytics/summary', '/analytics/journeys']) {
    adminRoutes.use(path, authCors(authRuntime))
    adminRoutes.use(path, requireTrustedOrigin(authRuntime))
    adminRoutes.use(path, requireAuthentication(authRuntime))
    adminRoutes.use(path, requireRole('SUPER_ADMIN'))
  }

  publicRoutes.post('/analytics/events', async (c) => {
    const input = parse(analyticsEventCreateSchema, await readJson(c.req.raw)) as AnalyticsEventInput
    return c.json(successResponse(await runtime.getService().ingest(input, clientIdentifier(c.req.raw))), 202)
  })
  adminRoutes.get('/analytics/summary', async (c) => {
    const query = parse(analyticsSummaryQuerySchema, queryObject(c.req.url)) as AnalyticsReportQuery
    return c.json(successResponse(await runtime.getService().getSummary(query)), 200)
  })
  adminRoutes.get('/analytics/journeys', async (c) => {
    const query = parse(analyticsJourneyQuerySchema, queryObject(c.req.url)) as AnalyticsJourneyQuery
    return c.json(successResponse(await runtime.getService().listJourneys(query)), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
