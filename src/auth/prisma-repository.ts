import type { AdminUser } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import type {
  AuthRepository,
  NewRefreshSession,
  ReplacementRefreshSession,
} from './repository.js'
import type { AdminRecord, AdminRole } from './types.js'

const toAdminRecord = (user: AdminUser): AdminRecord => ({
  id: user.id,
  name: user.name,
  email: user.email,
  passwordHash: user.passwordHash,
  role: user.role as AdminRole,
  isActive: user.isActive,
})

export class PrismaAuthRepository implements AuthRepository {
  async findAdminByEmail(email: string) {
    const user = await getPrisma().adminUser.findUnique({ where: { email } })
    return user ? toAdminRecord(user) : null
  }

  async findAdminById(id: string) {
    const user = await getPrisma().adminUser.findUnique({ where: { id } })
    return user ? toAdminRecord(user) : null
  }

  async createRefreshSession(session: NewRefreshSession) {
    await getPrisma().refreshSession.create({ data: session })
  }

  async rotateRefreshSession(
    currentTokenHash: string,
    replacement: ReplacementRefreshSession,
    now: Date,
  ) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.refreshSession.findUnique({
        where: { tokenHash: currentTokenHash },
      })

      if (
        !current ||
        current.revokedAt ||
        current.expiresAt <= now
      ) {
        return null
      }

      const users = await transaction.$queryRaw<AdminUser[]>`
        SELECT "id", "name", "email", "passwordHash", "role", "isActive", "createdAt", "updatedAt"
        FROM "AdminUser"
        WHERE "id" = ${current.userId}::uuid
        FOR UPDATE
      `
      const user = users[0]
      if (!user?.isActive) {
        return null
      }

      const consumed = await transaction.refreshSession.updateMany({
        where: {
          id: current.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          revokedAt: now,
          lastUsedAt: now,
        },
      })

      if (consumed.count !== 1) {
        return null
      }

      await transaction.refreshSession.create({
        data: { ...replacement, userId: current.userId },
      })
      return toAdminRecord(user)
    })
  }

  async revokeRefreshSession(tokenHash: string, now: Date) {
    await getPrisma().refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now },
    })
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    now: Date,
  ) {
    await getPrisma().$transaction([
      getPrisma().adminUser.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      getPrisma().refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ])
  }
}
