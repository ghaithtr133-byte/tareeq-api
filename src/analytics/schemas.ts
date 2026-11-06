import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import {
  analyticsCtaIds,
  analyticsEngagementTypes,
  analyticsEventTypes,
} from './types.js'

export const analyticsEventTypeSchema = z.enum(analyticsEventTypes).openapi('AnalyticsEventType')
export const analyticsCtaIdSchema = z.enum(analyticsCtaIds).openapi('AnalyticsCtaId')
export const analyticsEngagementTypeSchema = z.enum(
  analyticsEngagementTypes,
).openapi('AnalyticsEngagementType')
const nullableAnalyticsCtaIdSchema = z.enum(analyticsCtaIds).nullable()
const nullableAnalyticsEngagementTypeSchema = z.enum(analyticsEngagementTypes).nullable()

const safePath = z.string().trim().min(1).max(500).regex(
  /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/,
  'Use a relative path without a query string or fragment.',
)
const hostname = z.string().trim().toLowerCase().max(253).regex(
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  'Use a hostname only, without a scheme, path, query, or port.',
)
const attributionValue = z.string().trim().min(1).max(100).regex(
  /^[A-Za-z0-9._~-]+$/,
  'Use only letters, numbers, dots, underscores, tildes, or hyphens.',
)
const eventBase = {
  eventId: z.uuid().openapi({ description: 'Client-generated idempotency UUID.' }),
  visitorId: z.uuid().openapi({ description: 'Random anonymous visitor UUID; never derive it from identity or device fingerprinting.' }),
  sessionId: z.uuid().openapi({ description: 'Random anonymous session UUID.' }),
  path: safePath.openapi({ example: '/scholarships/romania-government' }),
  referrerHost: hostname.optional().openapi({ example: 'www.google.com' }),
  referrerPath: safePath.optional().openapi({ example: '/search' }),
  utmSource: attributionValue.optional().openapi({ example: 'google' }),
  utmMedium: attributionValue.optional().openapi({ example: 'cpc' }),
  utmCampaign: attributionValue.optional().openapi({ example: 'fall-scholarships' }),
  utmContent: attributionValue.optional(),
  utmTerm: attributionValue.optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional().openapi({
    description: 'Optional client event time, limited to the previous 24 hours and five minutes into the future.',
  }),
}

export const analyticsEventCreateSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('PAGE_VIEW') }).strict(),
  z.object({
    ...eventBase,
    type: z.literal('CTA_CLICK'),
    ctaId: analyticsCtaIdSchema,
    targetPath: safePath.optional(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal('ENGAGEMENT'),
    engagementType: analyticsEngagementTypeSchema,
  }).strict(),
  z.object({ ...eventBase, type: z.literal('APPLICATION_SUBMITTED') }).strict(),
  z.object({ ...eventBase, type: z.literal('INQUIRY_SUBMITTED') }).strict(),
]).openapi('AnalyticsEventCreateRequest')

export const analyticsEventAcceptedResponseSchema = successEnvelopeSchema(z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
})).openapi('AnalyticsEventAcceptedResponse')

const dateQuery = z.iso.date().optional().openapi({
  description: 'UTC calendar date in YYYY-MM-DD format. The range is inclusive.',
})
const reportQueryFields = {
  from: dateQuery,
  to: dateQuery,
  granularity: z.enum(['day', 'week', 'month']).optional().default('day'),
  topLimit: z.coerce.number().int().min(1).max(25).optional().default(10),
}

export const analyticsSummaryQuerySchema = z.object(reportQueryFields).strict()
export const analyticsJourneyQuerySchema = z.object({
  ...reportQueryFields,
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
}).strict()

const rangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  granularity: z.enum(['day', 'week', 'month']),
})
const countSchema = z.number().int().min(0)

export const analyticsSummaryResponseSchema = successEnvelopeSchema(z.object({
  range: rangeSchema,
  totals: z.object({ pageViews: countSchema, visitors: countSchema, sessions: countSchema }),
  topPages: z.array(z.object({ path: z.string(), pageViews: countSchema, visitors: countSchema })),
  trafficSources: z.array(z.object({
    source: z.string(),
    medium: z.string().nullable(),
    campaign: z.string().nullable(),
    sessions: countSchema,
    pageViews: countSchema,
  })),
  ctaEngagement: z.array(z.object({
    ctaId: analyticsCtaIdSchema,
    clicks: countSchema,
    sessions: countSchema,
  })),
  clientReportedConversions: z.object({ applications: countSchema, inquiries: countSchema, total: countSchema }),
  serverVerifiedConversions: z.object({ applications: countSchema, inquiries: countSchema, total: countSchema }),
  conversionRates: z.object({
    clientReportedSessionRate: z.number().min(0),
    applicationSessionRate: z.number().min(0),
    inquirySessionRate: z.number().min(0),
  }),
  funnel: z.array(z.object({
    step: z.string(),
    sessions: countSchema,
    rateFromPrevious: z.number().min(0).nullable(),
  })),
  trends: z.array(z.object({
    periodStart: z.iso.datetime({ offset: true }),
    pageViews: countSchema,
    visitors: countSchema,
    sessions: countSchema,
    ctaClicks: countSchema,
    clientReportedConversions: countSchema,
    serverVerifiedApplications: countSchema,
    serverVerifiedInquiries: countSchema,
  })),
})).openapi('AnalyticsSummaryResponse')

const journeyStepSchema = z.object({
  eventId: z.uuid(),
  type: analyticsEventTypeSchema,
  path: z.string(),
  targetPath: z.string().nullable(),
  ctaId: nullableAnalyticsCtaIdSchema,
  engagementType: nullableAnalyticsEngagementTypeSchema,
  occurredAt: z.iso.datetime({ offset: true }),
})

export const analyticsJourneyResponseSchema = successEnvelopeSchema(z.object({
  range: rangeSchema,
  items: z.array(z.object({
    sessionId: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    eventCount: countSchema,
    truncated: z.boolean(),
    clientReportedApplication: z.boolean(),
    clientReportedInquiry: z.boolean(),
    steps: z.array(journeyStepSchema),
  })),
  pagination: z.object({
    page: countSchema,
    limit: countSchema,
    total: countSchema,
    totalPages: countSchema,
  }),
})).openapi('AnalyticsJourneyResponse')

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const analyticsErrorResponses = {
  400: { description: 'The event or report query is invalid.', content: errorContent({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid fields.', details: { fields: { path: ['Use a relative path without a query string or fragment.'] } } },
  }) },
  401: { description: 'Authentication is required.', content: errorContent({
    success: false,
    error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: {} },
  }) },
  403: { description: 'The public origin is not allowed or SUPER_ADMIN permission is required.', content: errorContent({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Insufficient permissions.', details: {} },
  }) },
  413: { description: 'The JSON request exceeds 8 KiB.', content: errorContent({
    success: false,
    error: { code: 'ANALYTICS_PAYLOAD_TOO_LARGE', message: 'Analytics event payload is too large.', details: { maxBytes: 8192 } },
  }) },
  415: { description: 'The request body is not JSON.', content: errorContent({
    success: false,
    error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.', details: {} },
  }) },
  429: { description: 'The anonymous client event limit was reached.', content: errorContent({
    success: false,
    error: { code: 'ANALYTICS_RATE_LIMITED', message: 'Too many analytics events. Please try again later.', details: { retryAfterSeconds: 300 } },
  }) },
} as const
