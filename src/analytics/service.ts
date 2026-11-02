import { createHmac } from 'node:crypto'

import { ApiError } from '../shared/http.js'
import type {
  AnalyticsEventInput,
  AnalyticsJourneyQuery,
  AnalyticsRange,
  AnalyticsReportQuery,
  AnalyticsRepository,
  StoredAnalyticsEvent,
} from './types.js'

export const ANALYTICS_RATE_LIMIT = 120
export const ANALYTICS_RATE_WINDOW_MS = 5 * 60 * 1_000
export const ANALYTICS_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1_000
export const ANALYTICS_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000
export const ANALYTICS_MAX_REPORT_DAYS = 366

const nullable = <T>(value: T | undefined) => value ?? null
const percent = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100

export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly rateLimitSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(input: AnalyticsEventInput, clientIdentifier: string) {
    const now = this.now()
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now
    if (
      occurredAt.getTime() < now.getTime() - ANALYTICS_MAX_EVENT_AGE_MS ||
      occurredAt.getTime() > now.getTime() + ANALYTICS_MAX_FUTURE_SKEW_MS
    ) {
      throw new ApiError(400, 'ANALYTICS_EVENT_TIME_INVALID', 'Event time is outside the accepted window.', {
        fields: { occurredAt: ['Use a time from the previous 24 hours and no more than five minutes in the future.'] },
      })
    }

    const windowStartMs = Math.floor(now.getTime() / ANALYTICS_RATE_WINDOW_MS) * ANALYTICS_RATE_WINDOW_MS
    const windowStartedAt = new Date(windowStartMs)
    const expiresAt = new Date(windowStartMs + ANALYTICS_RATE_WINDOW_MS)
    const identifierHash = createHmac('sha256', this.rateLimitSecret)
      .update(`analytics-rate-limit:v1:${clientIdentifier}`)
      .digest('hex')
    const event: StoredAnalyticsEvent = {
      id: input.eventId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      type: input.type,
      path: input.path,
      targetPath: nullable(input.targetPath),
      referrerHost: nullable(input.referrerHost),
      referrerPath: nullable(input.referrerPath),
      utmSource: nullable(input.utmSource),
      utmMedium: nullable(input.utmMedium),
      utmCampaign: nullable(input.utmCampaign),
      utmContent: nullable(input.utmContent),
      utmTerm: nullable(input.utmTerm),
      ctaId: nullable(input.ctaId),
      engagementType: nullable(input.engagementType),
      occurredAt,
    }
    const outcome = await this.repository.ingest(event, {
      identifierHash,
      windowStartedAt,
      expiresAt,
      limit: ANALYTICS_RATE_LIMIT,
    })
    if (outcome === 'RATE_LIMITED') {
      throw new ApiError(429, 'ANALYTICS_RATE_LIMITED', 'Too many analytics events. Please try again later.', {
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
      })
    }
    return { accepted: true, duplicate: outcome === 'DUPLICATE' }
  }

  async getSummary(query: AnalyticsReportQuery) {
    const range = this.range(query)
    const report = await this.repository.getSummary(range)
    return {
      range: this.publicRange(range),
      ...report,
      conversionRates: {
        clientReportedSessionRate: percent(
          report.clientReportedConversions.total,
          report.totals.sessions,
        ),
        applicationSessionRate: percent(
          report.clientReportedConversions.applications,
          report.totals.sessions,
        ),
        inquirySessionRate: percent(
          report.clientReportedConversions.inquiries,
          report.totals.sessions,
        ),
      },
      trends: report.trends.map((item) => ({
        ...item,
        periodStart: item.periodStart.toISOString(),
      })),
    }
  }

  async listJourneys(query: AnalyticsJourneyQuery) {
    const range = this.range(query)
    const result = await this.repository.listJourneys(range, query.page, query.limit)
    return {
      range: this.publicRange(range),
      items: result.items.map((item) => ({
        ...item,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt.toISOString(),
        steps: item.steps.map((step) => ({
          ...step,
          occurredAt: step.occurredAt.toISOString(),
        })),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
      },
    }
  }

  private range(query: AnalyticsReportQuery): AnalyticsRange {
    const current = this.now()
    const today = new Date(Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
    ))
    const from = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(today.getTime() - 29 * 24 * 60 * 60 * 1_000)
    const inclusiveTo = query.to
      ? new Date(`${query.to}T00:00:00.000Z`)
      : today
    const toExclusive = new Date(inclusiveTo.getTime() + 24 * 60 * 60 * 1_000)
    const days = (toExclusive.getTime() - from.getTime()) / (24 * 60 * 60 * 1_000)
    if (days <= 0 || days > ANALYTICS_MAX_REPORT_DAYS) {
      throw new ApiError(400, 'ANALYTICS_DATE_RANGE_INVALID', 'Analytics date range is invalid.', {
        fields: { to: [`Choose a range from 1 to ${ANALYTICS_MAX_REPORT_DAYS} days.`] },
      })
    }
    return {
      from,
      toExclusive,
      granularity: query.granularity,
      topLimit: query.topLimit,
    }
  }

  private publicRange(range: AnalyticsRange) {
    return {
      from: range.from.toISOString().slice(0, 10),
      to: new Date(range.toExclusive.getTime() - 1).toISOString().slice(0, 10),
      granularity: range.granularity,
    }
  }
}
