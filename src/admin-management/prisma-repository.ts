import type { AdminUser, Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import type { AdminRole } from '../auth/types.js'
import type {
  AdminAccount,
  AdminAccountChange,
  AdminAccountListQuery,
  AdminAccountUpdateResult,
  AdminManagementRepository,
} from './types.js'

const ADMIN_MUTATION_LOCK = 9_000_009

const toAdminAccount = (user: Pick<
  AdminUser,
  'id' | 'name' | 'email' | 'role' | 'isActive'
>): AdminAccount => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role as AdminRole,
  isActive: user.isActive,
})

export class PrismaAdminManagementRepository
implements AdminManagementRepository {
  async list(query: AdminAccountListQuery) {
    const prisma = getPrisma()
    const [items, total] = await Promise.all([
      prisma.adminUser.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      }),
      prisma.adminUser.count(),
    ])
    return { items: items.map(toAdminAccount), total }
  }

  async update(
    actorAdminId: string,
    targetAdminId: string,
    change: AdminAccountChange,
    now: Date,
  ): Promise<AdminAccountUpdateResult> {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK})
      `

      const users = await transaction.$queryRaw<AdminUser[]>`
        SELECT "id", "name", "email", "passwordHash", "role", "isActive", "createdAt", "updatedAt"
        FROM "AdminUser"
        WHERE "id" IN (${actorAdminId}::uuid, ${targetAdminId}::uuid)
        FOR UPDATE
      `
      const actor = users.find(({ id }) => id === actorAdminId)
      const target = users.find(({ id }) => id === targetAdminId)
      if (!actor?.isActive || actor.role !== 'SUPER_ADMIN') {
        return { outcome: 'ACTOR_FORBIDDEN' }
      }
      if (!target) return { outcome: 'NOT_FOUND' }

      if ('isActive' in change) {
        if (change.isActive === target.isActive) return { outcome: 'UNCHANGED' }
        if (actorAdminId === targetAdminId && !change.isActive) {
          return { outcome: 'SELF_DEACTIVATION_FORBIDDEN' }
        }
        if (target.isActive && target.role === 'SUPER_ADMIN' && !change.isActive) {
          const activeSuperAdmins = await transaction.adminUser.count({
            where: { role: 'SUPER_ADMIN', isActive: true },
          })
          if (activeSuperAdmins <= 1) {
            return { outcome: 'LAST_ACTIVE_SUPER_ADMIN' }
          }
        }

        const account = await transaction.adminUser.update({
          where: { id: targetAdminId },
          data: { isActive: change.isActive },
        })
        if (!change.isActive) {
          await transaction.refreshSession.updateMany({
            where: { userId: targetAdminId, revokedAt: null },
            data: { revokedAt: now },
          })
        }
        await transaction.adminAuditLog.create({
          data: {
            actorAdminId,
            action: change.isActive
              ? 'admin_account.activated'
              : 'admin_account.deactivated',
            resourceType: 'ADMIN_USER',
            resourceId: targetAdminId,
            metadata: {
              fromActive: target.isActive,
              toActive: change.isActive,
            } as Prisma.InputJsonValue,
          },
        })
        return { outcome: 'UPDATED', account: toAdminAccount(account) }
      }

      if (change.role === target.role) return { outcome: 'UNCHANGED' }
      if (
        actorAdminId === targetAdminId &&
        target.role === 'SUPER_ADMIN' &&
        change.role !== 'SUPER_ADMIN'
      ) {
        return { outcome: 'SELF_DEMOTION_FORBIDDEN' }
      }
      if (
        target.isActive &&
        target.role === 'SUPER_ADMIN' &&
        change.role !== 'SUPER_ADMIN'
      ) {
        const activeSuperAdmins = await transaction.adminUser.count({
          where: { role: 'SUPER_ADMIN', isActive: true },
        })
        if (activeSuperAdmins <= 1) {
          return { outcome: 'LAST_ACTIVE_SUPER_ADMIN' }
        }
      }

      const account = await transaction.adminUser.update({
        where: { id: targetAdminId },
        data: { role: change.role },
      })
      await transaction.adminAuditLog.create({
        data: {
          actorAdminId,
          action: 'admin_account.role_changed',
          resourceType: 'ADMIN_USER',
          resourceId: targetAdminId,
          metadata: {
            fromRole: target.role,
            toRole: change.role,
          } as Prisma.InputJsonValue,
        },
      })
      return { outcome: 'UPDATED', account: toAdminAccount(account) }
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
