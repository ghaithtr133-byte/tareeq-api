// Read-only owner diagnostic for PostgreSQL-backed analytics aggregation.
import { disconnectPrisma } from '../src/database/client.js'
import { PrismaAnalyticsRepository } from '../src/analytics/prisma-repository.js'

const argument = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
const from = argument('from') ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
const to = argument('to') ?? new Date().toISOString().slice(0, 10)
const granularity = argument('granularity') ?? 'day'
if (!['day', 'week', 'month'].includes(granularity) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Use ISO --from/--to and granularity day, week, or month.')
const scrub = (value: unknown) => typeof value === 'string'
  ? value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-url]').replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech\b/gi, '[redacted-host]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]').replace(/'[^']{1,200}'/g, "'[redacted]'").slice(0, 300)
  : null
const databaseError = (error: unknown) => {
  const value = error as { analyticsQuery?: unknown; cause?: unknown; code?: unknown; name?: unknown; meta?: { code?: unknown; message?: unknown } }
  const cause = value.cause as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown } | undefined
  const rawMessage = cause?.meta?.message ?? value.meta?.message ?? cause?.message
  const sqlState = cause?.meta?.code ?? value.meta?.code
    ?? (typeof rawMessage === 'string' ? /\bCode:\s*([0-9A-Z]{5})\b/.exec(rawMessage)?.[1] : null)
    ?? null
  return { query: typeof value.analyticsQuery === 'string' ? value.analyticsQuery : null, prismaCode: value.code ?? cause?.code ?? null, sqlState, message: scrub(rawMessage) }
}
try { const report = await new PrismaAnalyticsRepository().getSummary({ from: new Date(`${from}T00:00:00.000Z`), toExclusive: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000), granularity: granularity as 'day' | 'week' | 'month', topLimit: 10 }); console.log(JSON.stringify({ ok: true, range: { from, to, granularity }, totals: report.totals, trendCount: report.trends.length, topPageCount: report.topPages.length }, null, 2)) } catch (error) { console.error(JSON.stringify({ ok: false, error: databaseError(error) })); process.exitCode = 1 } finally { await disconnectPrisma() }
