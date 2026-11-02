import type {
  AnalyticsJourney,
  AnalyticsRange,
  AnalyticsRateLimit,
  AnalyticsRepository,
  AnalyticsSummaryData,
  StoredAnalyticsEvent,
} from '../../src/analytics/types.js'

const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  readonly events: StoredAnalyticsEvent[] = []
  readonly serverApplications: Date[] = []
  readonly serverInquiries: Date[] = []
  private readonly buckets = new Map<string, number>()

  async ingest(event: StoredAnalyticsEvent, rateLimit: AnalyticsRateLimit) {
    const key = `${rateLimit.identifierHash}:${rateLimit.windowStartedAt.toISOString()}`
    const count = (this.buckets.get(key) ?? 0) + 1
    this.buckets.set(key, count)
    if (count > rateLimit.limit) return 'RATE_LIMITED' as const
    if (this.events.some(({ id }) => id === event.id)) return 'DUPLICATE' as const
    this.events.push({ ...event })
    return 'CREATED' as const
  }

  async getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryData> {
    const events = this.inRange(range)
    const pageViews = events.filter(({ type }) => type === 'PAGE_VIEW')
    const sessionCount = (items: StoredAnalyticsEvent[]) => new Set(items.map(({ sessionId }) => sessionId)).size
    const visitorCount = (items: StoredAnalyticsEvent[]) => new Set(items.map(({ visitorId }) => visitorId)).size
    const applicationSessions = sessionCount(events.filter(({ type }) => type === 'APPLICATION_SUBMITTED'))
    const inquirySessions = sessionCount(events.filter(({ type }) => type === 'INQUIRY_SUBMITTED'))
    const conversionSessions = sessionCount(events.filter(({ type }) =>
      type === 'APPLICATION_SUBMITTED' || type === 'INQUIRY_SUBMITTED'))
    const ctaEvents = events.filter(({ type }) => type === 'CTA_CLICK')

    const pages = new Map<string, StoredAnalyticsEvent[]>()
    for (const event of pageViews) pages.set(event.path, [...(pages.get(event.path) ?? []), event])
    const sources = new Map<string, { source: string; medium: string | null; campaign: string | null; events: StoredAnalyticsEvent[] }>()
    for (const event of pageViews) {
      const source = event.utmSource ?? event.referrerHost ?? 'direct'
      const key = JSON.stringify([source, event.utmMedium, event.utmCampaign])
      const item = sources.get(key) ?? { source, medium: event.utmMedium, campaign: event.utmCampaign, events: [] }
      item.events.push(event)
      sources.set(key, item)
    }
    const ctas = new Map<string, StoredAnalyticsEvent[]>()
    for (const event of ctaEvents) {
      if (event.ctaId) ctas.set(event.ctaId, [...(ctas.get(event.ctaId) ?? []), event])
    }

    const trendGroups = new Map<string, StoredAnalyticsEvent[]>()
    for (const event of events) {
      const key = this.period(event.occurredAt, range.granularity).toISOString()
      trendGroups.set(key, [...(trendGroups.get(key) ?? []), event])
    }
    const submissionPeriods = new Set([
      ...this.serverApplications,
      ...this.serverInquiries,
    ].filter((date) => this.dateInRange(date, range)).map((date) =>
      this.period(date, range.granularity).toISOString()))
    const periodKeys = new Set([...trendGroups.keys(), ...submissionPeriods])

    const serverApplications = this.serverApplications.filter((date) => this.dateInRange(date, range))
    const serverInquiries = this.serverInquiries.filter((date) => this.dateInRange(date, range))
    const sessions = sessionCount(events)
    const funnelStages = [...new Set(events.map(({ sessionId }) => sessionId))].map((sessionId) => {
      const ordered = events.filter((event) => event.sessionId === sessionId)
        .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id))
      let stage: 'NONE' | 'PAGE_VIEW' | 'CTA_CLICK' | 'CONVERSION' = 'NONE'
      for (const event of ordered) {
        if (stage === 'NONE' && event.type === 'PAGE_VIEW') stage = 'PAGE_VIEW'
        else if (stage === 'PAGE_VIEW' && event.type === 'CTA_CLICK') stage = 'CTA_CLICK'
        else if (
          stage === 'CTA_CLICK' &&
          (event.type === 'APPLICATION_SUBMITTED' || event.type === 'INQUIRY_SUBMITTED')
        ) stage = 'CONVERSION'
      }
      return stage
    })
    const pageSessions = funnelStages.filter((stage) => stage !== 'NONE').length
    const ctaSessions = funnelStages.filter((stage) => stage === 'CTA_CLICK' || stage === 'CONVERSION').length
    const funnelConversionSessions = funnelStages.filter((stage) => stage === 'CONVERSION').length
    return {
      totals: { pageViews: pageViews.length, visitors: visitorCount(events), sessions },
      topPages: [...pages].map(([path, items]) => ({ path, pageViews: items.length, visitors: visitorCount(items) }))
        .sort((a, b) => b.pageViews - a.pageViews || a.path.localeCompare(b.path)).slice(0, range.topLimit),
      trafficSources: [...sources.values()].map((item) => ({
        source: item.source, medium: item.medium, campaign: item.campaign,
        sessions: sessionCount(item.events), pageViews: item.events.length,
      })).sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source)).slice(0, range.topLimit),
      ctaEngagement: [...ctas].map(([ctaId, items]) => ({
        ctaId: ctaId as AnalyticsSummaryData['ctaEngagement'][number]['ctaId'],
        clicks: items.length, sessions: sessionCount(items),
      })).sort((a, b) => b.clicks - a.clicks || a.ctaId.localeCompare(b.ctaId)),
      clientReportedConversions: { applications: applicationSessions, inquiries: inquirySessions, total: conversionSessions },
      serverVerifiedConversions: {
        applications: serverApplications.length,
        inquiries: serverInquiries.length,
        total: serverApplications.length + serverInquiries.length,
      },
      funnel: [
        { step: 'PAGE_VIEW', sessions: pageSessions, rateFromPrevious: null },
        { step: 'CTA_CLICK', sessions: ctaSessions, rateFromPrevious: rate(ctaSessions, pageSessions) },
        { step: 'CLIENT_REPORTED_CONVERSION', sessions: funnelConversionSessions, rateFromPrevious: rate(funnelConversionSessions, ctaSessions) },
      ],
      trends: [...periodKeys].sort().map((key) => {
        const items = trendGroups.get(key) ?? []
        return {
          periodStart: new Date(key),
          pageViews: items.filter(({ type }) => type === 'PAGE_VIEW').length,
          visitors: visitorCount(items), sessions: sessionCount(items),
          ctaClicks: items.filter(({ type }) => type === 'CTA_CLICK').length,
          clientReportedConversions: sessionCount(items.filter(({ type }) => type === 'APPLICATION_SUBMITTED' || type === 'INQUIRY_SUBMITTED')),
          serverVerifiedApplications: serverApplications.filter((date) => this.period(date, range.granularity).toISOString() === key).length,
          serverVerifiedInquiries: serverInquiries.filter((date) => this.period(date, range.granularity).toISOString() === key).length,
        }
      }),
    }
  }

  async listJourneys(range: AnalyticsRange, page: number, limit: number) {
    const groups = new Map<string, StoredAnalyticsEvent[]>()
    for (const event of this.inRange(range)) {
      groups.set(event.sessionId, [...(groups.get(event.sessionId) ?? []), event])
    }
    const sessions = [...groups].map(([sessionId, events]) => {
      events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
      const visible = events.slice(0, 100)
      const journey: AnalyticsJourney = {
        sessionId,
        startedAt: events[0]!.occurredAt,
        endedAt: events.at(-1)!.occurredAt,
        eventCount: events.length,
        truncated: events.length > 100,
        clientReportedApplication: events.some(({ type }) => type === 'APPLICATION_SUBMITTED'),
        clientReportedInquiry: events.some(({ type }) => type === 'INQUIRY_SUBMITTED'),
        steps: visible.map((event) => ({
          eventId: event.id, type: event.type, path: event.path,
          targetPath: event.targetPath, ctaId: event.ctaId,
          engagementType: event.engagementType, occurredAt: event.occurredAt,
        })),
      }
      return journey
    }).sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime() || a.sessionId.localeCompare(b.sessionId))
    const offset = (page - 1) * limit
    return { items: sessions.slice(offset, offset + limit), total: sessions.length }
  }

  private inRange(range: AnalyticsRange) {
    return this.events.filter(({ occurredAt }) => this.dateInRange(occurredAt, range))
  }

  private dateInRange(date: Date, range: AnalyticsRange) {
    return date >= range.from && date < range.toExclusive
  }

  private period(date: Date, granularity: AnalyticsRange['granularity']) {
    const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    if (granularity === 'month') result.setUTCDate(1)
    if (granularity === 'week') {
      const day = result.getUTCDay() || 7
      result.setUTCDate(result.getUTCDate() - day + 1)
    }
    return result
  }
}
