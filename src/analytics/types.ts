export const analyticsEventTypes = [
  'PAGE_VIEW',
  'CTA_CLICK',
  'ENGAGEMENT',
  'APPLICATION_SUBMITTED',
  'INQUIRY_SUBMITTED',
] as const

export const analyticsCtaIds = [
  'APPLY_NOW',
  'REQUEST_CONSULTATION',
  'CONTACT_US',
  'VIEW_UNIVERSITY',
  'VIEW_SCHOLARSHIP',
  'VIEW_SERVICE',
] as const

export const analyticsEngagementTypes = [
  'SCROLL_50',
  'SCROLL_90',
  'ACTIVE_30_SECONDS',
  'ACTIVE_60_SECONDS',
] as const

export type AnalyticsEventType = (typeof analyticsEventTypes)[number]
export type AnalyticsCtaId = (typeof analyticsCtaIds)[number]
export type AnalyticsEngagementType = (typeof analyticsEngagementTypes)[number]
export type AnalyticsGranularity = 'day' | 'week' | 'month'

export type AnalyticsEventInput = {
  eventId: string
  visitorId: string
  sessionId: string
  type: AnalyticsEventType
  path: string
  targetPath?: string
  referrerHost?: string
  referrerPath?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  ctaId?: AnalyticsCtaId
  engagementType?: AnalyticsEngagementType
  occurredAt?: string
}

export type StoredAnalyticsEvent = {
  id: string
  visitorId: string
  sessionId: string
  type: AnalyticsEventType
  path: string
  targetPath: string | null
  referrerHost: string | null
  referrerPath: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  ctaId: AnalyticsCtaId | null
  engagementType: AnalyticsEngagementType | null
  occurredAt: Date
}

export type AnalyticsRateLimit = {
  identifierHash: string
  windowStartedAt: Date
  expiresAt: Date
  limit: number
}

export type AnalyticsRange = {
  from: Date
  toExclusive: Date
  granularity: AnalyticsGranularity
  topLimit: number
}

export type AnalyticsReportQuery = {
  from?: string
  to?: string
  granularity: AnalyticsGranularity
  topLimit: number
}

export type AnalyticsJourneyQuery = AnalyticsReportQuery & {
  page: number
  limit: number
}

export type AnalyticsSummaryData = {
  totals: { pageViews: number; visitors: number; sessions: number }
  topPages: Array<{ path: string; pageViews: number; visitors: number }>
  trafficSources: Array<{
    source: string
    medium: string | null
    campaign: string | null
    sessions: number
    pageViews: number
  }>
  ctaEngagement: Array<{ ctaId: AnalyticsCtaId; clicks: number; sessions: number }>
  clientReportedConversions: {
    applications: number
    inquiries: number
    total: number
  }
  serverVerifiedConversions: {
    applications: number
    inquiries: number
    total: number
  }
  funnel: Array<{ step: string; sessions: number; rateFromPrevious: number | null }>
  trends: Array<{
    periodStart: Date
    pageViews: number
    visitors: number
    sessions: number
    ctaClicks: number
    clientReportedConversions: number
    serverVerifiedApplications: number
    serverVerifiedInquiries: number
  }>
}

export type AnalyticsJourney = {
  sessionId: string
  startedAt: Date
  endedAt: Date
  eventCount: number
  truncated: boolean
  clientReportedApplication: boolean
  clientReportedInquiry: boolean
  steps: Array<{
    eventId: string
    type: AnalyticsEventType
    path: string
    targetPath: string | null
    ctaId: AnalyticsCtaId | null
    engagementType: AnalyticsEngagementType | null
    occurredAt: Date
  }>
}

export interface AnalyticsRepository {
  ingest(
    event: StoredAnalyticsEvent,
    rateLimit: AnalyticsRateLimit,
  ): Promise<'CREATED' | 'DUPLICATE' | 'RATE_LIMITED'>
  getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryData>
  listJourneys(
    range: AnalyticsRange,
    page: number,
    limit: number,
  ): Promise<{ items: AnalyticsJourney[]; total: number }>
}
