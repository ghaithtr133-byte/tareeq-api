import { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import type {
  AnalyticsCtaId,
  AnalyticsEventType,
  AnalyticsJourney,
  AnalyticsRange,
  AnalyticsRepository,
  AnalyticsSummaryData,
  StoredAnalyticsEvent,
  AnalyticsRateLimit,
  AnalyticsEngagementType,
} from './types.js'

const asNumber = (value: bigint | number) => Number(value)
const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100
const summaryQuery = async <T>(name: string, operation: () => Promise<T>) => {
  try { return await operation() } catch (cause) {
    const error = new Error('Analytics summary query failed.')
    Object.assign(error, { analyticsQuery: name, cause })
    throw error
  }
}

type TotalsRow = {
  pageViews: bigint
  visitors: bigint
  sessions: bigint
  pageSessions: bigint
  applications: bigint
  inquiries: bigint
  conversions: bigint
  ctaSessions: bigint
}
type TrendRow = {
  periodStart: Date
  pageViews: bigint
  visitors: bigint
  sessions: bigint
  ctaClicks: bigint
  clientReportedConversions: bigint
}
type SubmissionTrendRow = {
  periodStart: Date
  applications: bigint
  inquiries: bigint
}
type FunnelRow = {
  pageSessions: bigint
  ctaSessions: bigint
  conversionSessions: bigint
}

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  async ingest(event: StoredAnalyticsEvent, rateLimit: AnalyticsRateLimit) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$executeRaw`
        DELETE FROM "PublicSubmissionRateLimit"
        WHERE ("scope", "identifierHash", "windowStartedAt") IN (
          SELECT "scope", "identifierHash", "windowStartedAt"
          FROM "PublicSubmissionRateLimit"
          WHERE "expiresAt" < NOW()
          ORDER BY "expiresAt" ASC
          LIMIT 100
        )
      `
      const bucket = await transaction.publicSubmissionRateLimit.upsert({
        where: { scope_identifierHash_windowStartedAt: {
          scope: 'analytics-events',
          identifierHash: rateLimit.identifierHash,
          windowStartedAt: rateLimit.windowStartedAt,
        } },
        create: {
          scope: 'analytics-events',
          identifierHash: rateLimit.identifierHash,
          windowStartedAt: rateLimit.windowStartedAt,
          expiresAt: rateLimit.expiresAt,
          count: 1,
        },
        update: { count: { increment: 1 }, expiresAt: rateLimit.expiresAt },
        select: { count: true },
      })
      if (bucket.count > rateLimit.limit) return 'RATE_LIMITED' as const

      const created = await transaction.analyticsEvent.createMany({
        data: [event],
        skipDuplicates: true,
      })
      return created.count === 0 ? 'DUPLICATE' as const : 'CREATED' as const
    }, { maxWait: 10_000, timeout: 10_000 })
  }

  async getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryData> {
    const prisma = getPrisma()
    const { from, toExclusive, topLimit, granularity } = range
    const [
      totalRows,
      funnelRows,
      topPageRows,
      sourceRows,
      ctaRows,
      analyticTrendRows,
      submissionTrendRows,
      serverApplications,
      serverInquiries,
    ] = await Promise.all([
      summaryQuery('totals', () => prisma.$queryRaw<TotalsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::bigint AS "pageViews",
          COUNT(DISTINCT "visitorId")::bigint AS "visitors",
          COUNT(DISTINCT "sessionId")::bigint AS "sessions",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'PAGE_VIEW')::bigint AS "pageSessions",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'APPLICATION_SUBMITTED')::bigint AS "applications",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'INQUIRY_SUBMITTED')::bigint AS "inquiries",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" IN ('APPLICATION_SUBMITTED', 'INQUIRY_SUBMITTED'))::bigint AS "conversions",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'CTA_CLICK')::bigint AS "ctaSessions"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive}
      `),
      summaryQuery('funnel', () => prisma.$queryRaw<FunnelRow[]>`
        WITH "firstPage" AS (
          SELECT "sessionId", MIN("occurredAt") AS "firstPageAt"
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive} AND "type" = 'PAGE_VIEW'
          GROUP BY "sessionId"
        ),
        "firstCta" AS (
          SELECT "firstPage"."sessionId", "firstPage"."firstPageAt", MIN("event"."occurredAt") AS "firstCtaAt"
          FROM "firstPage"
          LEFT JOIN "AnalyticsEvent" AS "event"
            ON "event"."sessionId" = "firstPage"."sessionId"
            AND "event"."type" = 'CTA_CLICK'
            AND "event"."occurredAt" >= "firstPage"."firstPageAt"
            AND "event"."occurredAt" < ${toExclusive}
          GROUP BY "firstPage"."sessionId", "firstPage"."firstPageAt"
        ),
        "stages" AS (
          SELECT "firstCta"."sessionId", "firstCta"."firstCtaAt", MIN("event"."occurredAt") AS "firstConversionAt"
          FROM "firstCta"
          LEFT JOIN "AnalyticsEvent" AS "event"
            ON "event"."sessionId" = "firstCta"."sessionId"
            AND "event"."type" IN ('APPLICATION_SUBMITTED', 'INQUIRY_SUBMITTED')
            AND "firstCta"."firstCtaAt" IS NOT NULL
            AND "event"."occurredAt" >= "firstCta"."firstCtaAt"
            AND "event"."occurredAt" < ${toExclusive}
          GROUP BY "firstCta"."sessionId", "firstCta"."firstCtaAt"
        )
        SELECT
          COUNT(*)::bigint AS "pageSessions",
          COUNT(*) FILTER (WHERE "firstCtaAt" IS NOT NULL)::bigint AS "ctaSessions",
          COUNT(*) FILTER (WHERE "firstConversionAt" IS NOT NULL)::bigint AS "conversionSessions"
        FROM "stages"
      `),
      summaryQuery('topPages', () => prisma.$queryRaw<Array<{ path: string; pageViews: bigint; visitors: bigint }>>`
        SELECT "path", COUNT(*)::bigint AS "pageViews", COUNT(DISTINCT "visitorId")::bigint AS "visitors"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive} AND "type" = 'PAGE_VIEW'
        GROUP BY "path"
        ORDER BY COUNT(*) DESC, "path" ASC
        LIMIT ${topLimit}
      `),
      summaryQuery('trafficSources', () => prisma.$queryRaw<Array<{ source: string; medium: string | null; campaign: string | null; sessions: bigint; pageViews: bigint }>>`
        SELECT
          COALESCE("utmSource", "referrerHost", 'direct') AS "source",
          "utmMedium" AS "medium",
          "utmCampaign" AS "campaign",
          COUNT(DISTINCT "sessionId")::bigint AS "sessions",
          COUNT(*)::bigint AS "pageViews"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive} AND "type" = 'PAGE_VIEW'
        GROUP BY COALESCE("utmSource", "referrerHost", 'direct'), "utmMedium", "utmCampaign"
        ORDER BY COUNT(DISTINCT "sessionId") DESC, "source" ASC, "medium" ASC NULLS LAST, "campaign" ASC NULLS LAST
        LIMIT ${topLimit}
      `),
      summaryQuery('ctaEngagement', () => prisma.$queryRaw<Array<{ ctaId: AnalyticsCtaId; clicks: bigint; sessions: bigint }>>`
        SELECT "ctaId", COUNT(*)::bigint AS "clicks", COUNT(DISTINCT "sessionId")::bigint AS "sessions"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive} AND "type" = 'CTA_CLICK'
        GROUP BY "ctaId"
        ORDER BY COUNT(*) DESC, "ctaId" ASC
      `),
      summaryQuery('analyticsTrends', () => prisma.$queryRaw<TrendRow[]>`
        WITH "trendEvents" AS (
          SELECT date_trunc(CAST(${granularity} AS text), "occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "periodStart",
            "type", "visitorId", "sessionId"
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${toExclusive}
        )
        SELECT "periodStart",
          COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::bigint AS "pageViews",
          COUNT(DISTINCT "visitorId")::bigint AS "visitors",
          COUNT(DISTINCT "sessionId")::bigint AS "sessions",
          COUNT(*) FILTER (WHERE "type" = 'CTA_CLICK')::bigint AS "ctaClicks",
          COUNT(DISTINCT "sessionId") FILTER (WHERE "type" IN ('APPLICATION_SUBMITTED', 'INQUIRY_SUBMITTED'))::bigint AS "clientReportedConversions"
        FROM "trendEvents"
        GROUP BY "periodStart"
        ORDER BY "periodStart" ASC
      `),
      summaryQuery('submissionTrends', () => prisma.$queryRaw<SubmissionTrendRow[]>`
        WITH "submissionEvents" AS (
          SELECT date_trunc(CAST(${granularity} AS text), "createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "periodStart", 1::bigint AS "applications", 0::bigint AS "inquiries"
          FROM "StudentApplication" WHERE "createdAt" >= ${from} AND "createdAt" < ${toExclusive}
          UNION ALL
          SELECT date_trunc(CAST(${granularity} AS text), "createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "periodStart", 0::bigint AS "applications", 1::bigint AS "inquiries"
          FROM "GeneralInquiry" WHERE "createdAt" >= ${from} AND "createdAt" < ${toExclusive}
        )
        SELECT "periodStart", SUM("applications")::bigint AS "applications", SUM("inquiries")::bigint AS "inquiries"
        FROM "submissionEvents"
        GROUP BY "periodStart"
        ORDER BY "periodStart" ASC
      `),
      summaryQuery('serverApplications', () => prisma.studentApplication.count({ where: { createdAt: { gte: from, lt: toExclusive } } })),
      summaryQuery('serverInquiries', () => prisma.generalInquiry.count({ where: { createdAt: { gte: from, lt: toExclusive } } })),
    ])

    const totals = totalRows[0] ?? {
      pageViews: 0n, visitors: 0n, sessions: 0n, pageSessions: 0n,
      applications: 0n, inquiries: 0n, conversions: 0n, ctaSessions: 0n,
    }
    const trendMap = new Map<string, AnalyticsSummaryData['trends'][number]>()
    for (const row of analyticTrendRows) {
      trendMap.set(row.periodStart.toISOString(), {
        periodStart: row.periodStart,
        pageViews: asNumber(row.pageViews), visitors: asNumber(row.visitors),
        sessions: asNumber(row.sessions), ctaClicks: asNumber(row.ctaClicks),
        clientReportedConversions: asNumber(row.clientReportedConversions),
        serverVerifiedApplications: 0, serverVerifiedInquiries: 0,
      })
    }
    for (const row of submissionTrendRows) {
      const key = row.periodStart.toISOString()
      const current = trendMap.get(key) ?? {
        periodStart: row.periodStart, pageViews: 0, visitors: 0, sessions: 0,
        ctaClicks: 0, clientReportedConversions: 0,
        serverVerifiedApplications: 0, serverVerifiedInquiries: 0,
      }
      current.serverVerifiedApplications = asNumber(row.applications)
      current.serverVerifiedInquiries = asNumber(row.inquiries)
      trendMap.set(key, current)
    }
    const funnel = funnelRows[0] ?? {
      pageSessions: 0n,
      ctaSessions: 0n,
      conversionSessions: 0n,
    }
    const pageSessions = asNumber(funnel.pageSessions)
    const ctaSessions = asNumber(funnel.ctaSessions)
    const funnelConversionSessions = asNumber(funnel.conversionSessions)
    const conversionSessions = asNumber(totals.conversions)
    return {
      totals: {
        pageViews: asNumber(totals.pageViews),
        visitors: asNumber(totals.visitors),
        sessions: asNumber(totals.sessions),
      },
      topPages: topPageRows.map((row) => ({ ...row, pageViews: asNumber(row.pageViews), visitors: asNumber(row.visitors) })),
      trafficSources: sourceRows.map((row) => ({ ...row, sessions: asNumber(row.sessions), pageViews: asNumber(row.pageViews) })),
      ctaEngagement: ctaRows.map((row) => ({ ...row, clicks: asNumber(row.clicks), sessions: asNumber(row.sessions) })),
      clientReportedConversions: {
        applications: asNumber(totals.applications),
        inquiries: asNumber(totals.inquiries),
        total: conversionSessions,
      },
      serverVerifiedConversions: {
        applications: serverApplications,
        inquiries: serverInquiries,
        total: serverApplications + serverInquiries,
      },
      funnel: [
        { step: 'PAGE_VIEW', sessions: pageSessions, rateFromPrevious: null },
        { step: 'CTA_CLICK', sessions: ctaSessions, rateFromPrevious: rate(ctaSessions, pageSessions) },
        { step: 'CLIENT_REPORTED_CONVERSION', sessions: funnelConversionSessions, rateFromPrevious: rate(funnelConversionSessions, ctaSessions) },
      ],
      trends: [...trendMap.values()].sort((left, right) => left.periodStart.getTime() - right.periodStart.getTime()),
    }
  }

  async listJourneys(range: AnalyticsRange, page: number, limit: number) {
    const prisma = getPrisma()
    const offset = (page - 1) * limit
    const [sessionRows, totalRows] = await Promise.all([
      prisma.$queryRaw<Array<{ sessionId: string; startedAt: Date; endedAt: Date; eventCount: bigint; clientReportedApplication: boolean; clientReportedInquiry: boolean }>>`
        SELECT "sessionId", MIN("occurredAt") AS "startedAt", MAX("occurredAt") AS "endedAt", COUNT(*)::bigint AS "eventCount",
          BOOL_OR("type" = 'APPLICATION_SUBMITTED') AS "clientReportedApplication",
          BOOL_OR("type" = 'INQUIRY_SUBMITTED') AS "clientReportedInquiry"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${range.from} AND "occurredAt" < ${range.toExclusive}
        GROUP BY "sessionId"
        ORDER BY MAX("occurredAt") DESC, "sessionId" ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(DISTINCT "sessionId")::bigint AS "total"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${range.from} AND "occurredAt" < ${range.toExclusive}
      `,
    ])
    if (sessionRows.length === 0) return { items: [], total: asNumber(totalRows[0]?.total ?? 0n) }

    const sessionIds = sessionRows.map(({ sessionId }) => sessionId)
    const eventRows = await prisma.$queryRaw<Array<{
      id: string
      sessionId: string
      type: AnalyticsEventType
      path: string
      targetPath: string | null
      ctaId: AnalyticsCtaId | null
      engagementType: AnalyticsEngagementType | null
      occurredAt: Date
    }>>(Prisma.sql`
      WITH "ranked" AS (
        SELECT "id", "sessionId", "type", "path", "targetPath", "ctaId", "engagementType", "occurredAt",
          ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "occurredAt" ASC, "id" ASC) AS "rowNumber"
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${range.from} AND "occurredAt" < ${range.toExclusive}
          AND "sessionId" IN (${Prisma.join(sessionIds)})
      )
      SELECT "id", "sessionId", "type", "path", "targetPath", "ctaId", "engagementType", "occurredAt"
      FROM "ranked" WHERE "rowNumber" <= 100
      ORDER BY "sessionId" ASC, "occurredAt" ASC, "id" ASC
    `)
    const bySession = new Map<string, typeof eventRows>()
    for (const event of eventRows) {
      const list = bySession.get(event.sessionId) ?? []
      list.push(event)
      bySession.set(event.sessionId, list)
    }
    const items: AnalyticsJourney[] = sessionRows.map((session) => {
      const events = bySession.get(session.sessionId) ?? []
      return {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        eventCount: asNumber(session.eventCount),
        truncated: asNumber(session.eventCount) > 100,
        clientReportedApplication: session.clientReportedApplication,
        clientReportedInquiry: session.clientReportedInquiry,
        steps: events.map((event) => ({
          eventId: event.id, type: event.type, path: event.path,
          targetPath: event.targetPath, ctaId: event.ctaId,
          engagementType: event.engagementType, occurredAt: event.occurredAt,
        })),
      }
    })
    return { items, total: asNumber(totalRows[0]?.total ?? 0n) }
  }
}
