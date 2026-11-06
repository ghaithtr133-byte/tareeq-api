import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import { marketingPageIds, type MarketingPageImageRecord, type MarketingPageImageRepository, type MarketingPageImageUpdate, type MarketingPageKey } from './types.js'

const LOCK = 9_000_012
const record = (value: { id: string; pageKey: string; heroImageUrl: string | null; heroImageAltAr: string | null; ctaImageUrl: string | null; ctaImageAltAr: string | null; updatedAt: Date }): MarketingPageImageRecord => ({ ...value, pageKey: value.pageKey as MarketingPageKey })

export class PrismaMarketingPageImageRepository implements MarketingPageImageRepository {
  async find(pageKey: MarketingPageKey) {
    const value = await getPrisma().marketingPageImage.findUnique({ where: { pageKey } })
    return value ? record(value) : null
  }
  async update(actorAdminId: string, pageKey: MarketingPageKey, input: MarketingPageImageUpdate) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK})`
      const actor = await transaction.adminUser.findUnique({ where: { id: actorAdminId }, select: { isActive: true, role: true } })
      if (!actor?.isActive || (actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN')) return null
      const value = await transaction.marketingPageImage.upsert({ where: { pageKey }, create: { id: marketingPageIds[pageKey], pageKey, ...input }, update: input })
      await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'marketing_page_images.updated', resourceType: 'MARKETING_PAGE_IMAGE', resourceId: value.id, metadata: { pageKey, changedFields: Object.keys(input).sort() } as Prisma.InputJsonValue } })
      return record(value)
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
