import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import {
  SITE_SETTINGS_ID,
  type SiteSettingsRecord,
  type SiteSettingsRepository,
  type SiteSettingsUpdate,
} from './types.js'

const ADMIN_MUTATION_LOCK = 9_000_009

const toRecord = (value: {
  academyNameAr: string | null
  academyNameEn: string | null
  contactEmail: string | null
  contactPhone: string | null
  addressAr: string | null
  addressEn: string | null
  facebookUrl: string | null
  instagramUrl: string | null
  linkedinUrl: string | null
  youtubeUrl: string | null
  updatedAt: Date
}): SiteSettingsRecord => ({ ...value })

export class PrismaSiteSettingsRepository implements SiteSettingsRepository {
  async find() {
    const settings = await getPrisma().siteSettings.findUnique({
      where: { id: SITE_SETTINGS_ID },
    })
    return settings ? toRecord(settings) : null
  }

  async update(actorAdminId: string, input: SiteSettingsUpdate) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK})
      `
      const actor = await transaction.adminUser.findUnique({
        where: { id: actorAdminId },
        select: { role: true, isActive: true },
      })
      if (!actor?.isActive || actor.role !== 'SUPER_ADMIN') return null

      const settings = await transaction.siteSettings.upsert({
        where: { id: SITE_SETTINGS_ID },
        create: { id: SITE_SETTINGS_ID, ...input },
        update: input,
      })
      await transaction.adminAuditLog.create({
        data: {
          actorAdminId,
          action: 'site_settings.updated',
          resourceType: 'SITE_SETTINGS',
          resourceId: SITE_SETTINGS_ID,
          metadata: {
            changedFields: Object.keys(input).sort(),
          } as Prisma.InputJsonValue,
        },
      })
      return toRecord(settings)
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
