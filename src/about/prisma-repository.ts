import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import { ABOUT_US_ID, type AboutUsRecord, type AboutUsRepository, type AboutUsUpdate } from './types.js'

const ABOUT_US_MUTATION_LOCK = 9_000_010

const toRecord = (record: AboutUsRecord) => record

export class PrismaAboutUsRepository implements AboutUsRepository {
  async find() {
    const record = await getPrisma().aboutUs.findUnique({ where: { id: ABOUT_US_ID } })
    return record ? toRecord(record) : null
  }

  async update(actorAdminId: string, input: AboutUsUpdate) {
    return await getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${ABOUT_US_MUTATION_LOCK})`
      const actor = await transaction.adminUser.findUnique({
        where: { id: actorAdminId }, select: { isActive: true, role: true },
      })
      if (!actor?.isActive || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) return null

      const current = await transaction.aboutUs.findUnique({ where: { id: ABOUT_US_ID } })
      const nextStatus = input.status ?? current?.status ?? 'DRAFT'
      const record = await transaction.aboutUs.upsert({
        where: { id: ABOUT_US_ID },
        create: {
          id: ABOUT_US_ID,
          ...input,
          status: nextStatus,
          publishedAt: nextStatus === 'PUBLISHED' ? new Date() : null,
        },
        update: {
          ...input,
          ...(nextStatus === 'PUBLISHED' && current?.publishedAt === null
            ? { publishedAt: new Date() }
            : {}),
        },
      })
      const statusChanged = current !== null && input.status !== undefined && input.status !== current.status
      await transaction.adminAuditLog.create({
        data: {
          actorAdminId,
          action: current === null ? 'about_us.created' : statusChanged ? 'about_us.status_changed' : 'about_us.updated',
          resourceType: 'ABOUT_US',
          resourceId: ABOUT_US_ID,
          metadata: {
            changedFields: Object.keys(input).sort(),
            ...(statusChanged ? { fromStatus: current.status, toStatus: input.status as string } : {}),
          } as Prisma.InputJsonValue,
        },
      })
      return toRecord(record)
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
