import type { AdminUser, Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import type {
  AuthRepository,
  NewRefreshSession,
  PasswordRecoveryChallengeInput,
  PasswordRecoveryResetInput,
  PasswordRecoveryVerificationInput,
  ReplacementRefreshSession,
} from './repository.js'
import {
  PASSWORD_RECOVERY_EMAIL_LIMIT,
  PASSWORD_RECOVERY_IP_LIMIT,
  PASSWORD_RECOVERY_MAX_ATTEMPTS,
  PASSWORD_RECOVERY_RATE_WINDOW_MS,
  PASSWORD_RECOVERY_RESEND_COOLDOWN_MS,
  safelyEqualsHash,
} from './recovery.js'
import type { AdminRecord, AdminRole } from './types.js'

const toAdminRecord = (user: AdminUser): AdminRecord => ({
  id: user.id,
  name: user.name,
  email: user.email,
  passwordHash: user.passwordHash,
  authVersion: user.authVersion,
  role: user.role as AdminRole,
  isActive: user.isActive,
})

export class PrismaAuthRepository implements AuthRepository {
  private async replacePasswordAndRevokeSessionsInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    now: Date,
  ) {
    const updated = await transaction.adminUser.updateMany({
      where: {
        id: userId,
        isActive: true,
        passwordHash: expectedPasswordHash,
      },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
    })
    if (updated.count !== 1) return false

    await transaction.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    })
    await transaction.passwordRecoveryChallenge.updateMany({
      where: { adminUserId: userId, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    })
    return true
  }

  async findAdminByEmail(email: string) {
    const user = await getPrisma().adminUser.findUnique({ where: { email } })
    return user ? toAdminRecord(user) : null
  }

  async findAdminById(id: string) {
    const user = await getPrisma().adminUser.findUnique({ where: { id } })
    return user ? toAdminRecord(user) : null
  }

  async updateAdminName(id: string, name: string) {
    return getPrisma().$transaction(async (transaction) => {
      const updated = await transaction.adminUser.updateMany({
        where: { id, isActive: true },
        data: { name },
      })
      if (updated.count !== 1) return null
      const user = await transaction.adminUser.findUnique({ where: { id } })
      return user ? toAdminRecord(user) : null
    })
  }

  async createRefreshSession(session: NewRefreshSession, expectedAuthVersion: number) {
    return getPrisma().$transaction(async (transaction) => {
      const users = await transaction.$queryRaw<AdminUser[]>`
        SELECT "id", "name", "email", "passwordHash", "authVersion", "role", "isActive", "createdAt", "updatedAt"
        FROM "AdminUser"
        WHERE "id" = ${session.userId}::uuid
        FOR UPDATE
      `
      const user = users[0]
      if (!user?.isActive || user.authVersion !== expectedAuthVersion) return false

      await transaction.refreshSession.create({ data: session })
      return true
    }, { maxWait: 15_000, timeout: 15_000 })
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
        SELECT "id", "name", "email", "passwordHash", "authVersion", "role", "isActive", "createdAt", "updatedAt"
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
    }, {
      maxWait: 15_000,
      timeout: 15_000,
    })
  }

  async revokeRefreshSession(tokenHash: string, now: Date) {
    await getPrisma().refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now },
    })
  }

  async replacePasswordAndRevokeSessions(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    now: Date,
  ) {
    return getPrisma().$transaction((transaction) => this.replacePasswordAndRevokeSessionsInTransaction(
      transaction,
      userId,
      expectedPasswordHash,
      passwordHash,
      now,
    ), {
      maxWait: 15_000,
      timeout: 15_000,
    })
  }

  async createPasswordRecoveryChallenge(
    input: PasswordRecoveryChallengeInput,
    now: Date,
  ) {
    const windowStartMs = Math.floor(now.getTime() / PASSWORD_RECOVERY_RATE_WINDOW_MS)
      * PASSWORD_RECOVERY_RATE_WINDOW_MS
    const windowStartedAt = new Date(windowStartMs)
    const rateLimitExpiresAt = new Date(windowStartMs + PASSWORD_RECOVERY_RATE_WINDOW_MS)

    return getPrisma().$transaction(async (transaction) => {
      await transaction.passwordRecoveryRateLimit.deleteMany({
        where: { expiresAt: { lt: now } },
      })
      const [emailRate, ipRate] = await Promise.all([
        transaction.passwordRecoveryRateLimit.upsert({
          where: { scope_identifierHash_windowStartedAt: {
            scope: 'EMAIL', identifierHash: input.emailRateIdentifierHash, windowStartedAt,
          } },
          create: {
            scope: 'EMAIL', identifierHash: input.emailRateIdentifierHash, windowStartedAt,
            count: 1, expiresAt: rateLimitExpiresAt,
          },
          update: { count: { increment: 1 }, expiresAt: rateLimitExpiresAt },
          select: { count: true },
        }),
        transaction.passwordRecoveryRateLimit.upsert({
          where: { scope_identifierHash_windowStartedAt: {
            scope: 'IP', identifierHash: input.ipRateIdentifierHash, windowStartedAt,
          } },
          create: {
            scope: 'IP', identifierHash: input.ipRateIdentifierHash, windowStartedAt,
            count: 1, expiresAt: rateLimitExpiresAt,
          },
          update: { count: { increment: 1 }, expiresAt: rateLimitExpiresAt },
          select: { count: true },
        }),
      ])
      if (emailRate.count > PASSWORD_RECOVERY_EMAIL_LIMIT || ipRate.count > PASSWORD_RECOVERY_IP_LIMIT) {
        return null
      }

      const users = await transaction.$queryRaw<AdminUser[]>`
        SELECT "id", "name", "email", "passwordHash", "authVersion", "role", "isActive", "createdAt", "updatedAt"
        FROM "AdminUser"
        WHERE "email" = ${input.email}::citext
        FOR UPDATE
      `
      const user = users[0]
      if (!user?.isActive) return null

      const cooldown = await transaction.passwordRecoveryChallenge.findFirst({
        where: {
          adminUserId: user.id,
          createdAt: { gt: new Date(now.getTime() - PASSWORD_RECOVERY_RESEND_COOLDOWN_MS) },
          consumedAt: null,
          invalidatedAt: null,
        },
        select: { id: true },
      })
      if (cooldown) return null

      await transaction.passwordRecoveryChallenge.updateMany({
        where: { adminUserId: user.id, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      })
      await transaction.passwordRecoveryChallenge.create({
        data: {
          id: input.id,
          adminUserId: user.id,
          email: user.email,
          otpHash: input.otpHash,
          expiresAt: input.expiresAt,
        },
      })
      if (input.actorAdminId) {
        await transaction.adminAuditLog.create({
          data: {
            actorAdminId: input.actorAdminId,
            action: 'admin_account.password_recovery_initiated',
            resourceType: 'ADMIN_USER',
            resourceId: user.id,
            metadata: { delivery: 'requested' },
          },
        })
      }
      return { id: input.id, adminUserId: user.id, email: user.email, name: user.name }
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async invalidatePasswordRecoveryChallenge(id: string, now: Date) {
    await getPrisma().passwordRecoveryChallenge.updateMany({
      where: { id, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    })
  }

  async verifyPasswordRecoveryChallenge(
    input: PasswordRecoveryVerificationInput,
    now: Date,
  ) {
    return getPrisma().$transaction(async (transaction) => {
      const challenges = await transaction.$queryRaw<Array<{
        id: string
        adminUserId: string
        email: string
        otpHash: string
        expiresAt: Date
        verifiedAt: Date | null
        consumedAt: Date | null
        invalidatedAt: Date | null
        attemptCount: number
        isActive: boolean
        currentEmail: string
      }>>`
        SELECT challenge."id", challenge."adminUserId", challenge."email", challenge."otpHash",
          challenge."expiresAt", challenge."verifiedAt", challenge."consumedAt", challenge."invalidatedAt",
          challenge."attemptCount", admin."isActive", admin."email" AS "currentEmail"
        FROM "PasswordRecoveryChallenge" AS challenge
        JOIN "AdminUser" AS admin ON admin."id" = challenge."adminUserId"
        WHERE challenge."id" = ${input.challengeId}::uuid
        FOR UPDATE OF challenge, admin
      `
      const challenge = challenges[0]
      if (
        !challenge || !challenge.isActive || challenge.email !== challenge.currentEmail ||
        challenge.expiresAt <= now || challenge.verifiedAt || challenge.consumedAt ||
        challenge.invalidatedAt || challenge.attemptCount >= PASSWORD_RECOVERY_MAX_ATTEMPTS
      ) return false

      if (!safelyEqualsHash(challenge.otpHash, input.otpHash)) {
        const nextAttempts = challenge.attemptCount + 1
        await transaction.passwordRecoveryChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
            ...(nextAttempts >= PASSWORD_RECOVERY_MAX_ATTEMPTS ? { invalidatedAt: now } : {}),
          },
        })
        return false
      }

      await transaction.passwordRecoveryChallenge.update({
        where: { id: challenge.id },
        data: {
          verifiedAt: now,
          resetAuthorizationHash: input.resetAuthorizationHash,
          authorizationExpiresAt: input.authorizationExpiresAt,
          lastAttemptAt: now,
        },
      })
      return true
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async consumePasswordRecoveryAndReplacePassword(
    input: PasswordRecoveryResetInput,
    now: Date,
  ) {
    return getPrisma().$transaction(async (transaction) => {
      const challenges = await transaction.$queryRaw<Array<{
        id: string
        adminUserId: string
        email: string
        resetAuthorizationHash: string | null
        authorizationExpiresAt: Date | null
        verifiedAt: Date | null
        consumedAt: Date | null
        invalidatedAt: Date | null
        passwordHash: string
        isActive: boolean
        currentEmail: string
      }>>`
        SELECT challenge."id", challenge."adminUserId", challenge."email", challenge."resetAuthorizationHash",
          challenge."authorizationExpiresAt", challenge."verifiedAt", challenge."consumedAt", challenge."invalidatedAt",
          admin."passwordHash", admin."isActive", admin."email" AS "currentEmail"
        FROM "PasswordRecoveryChallenge" AS challenge
        JOIN "AdminUser" AS admin ON admin."id" = challenge."adminUserId"
        WHERE challenge."id" = ${input.challengeId}::uuid
        FOR UPDATE OF challenge, admin
      `
      const challenge = challenges[0]
      if (
        !challenge || !challenge.isActive || challenge.email !== challenge.currentEmail ||
        !challenge.verifiedAt || !challenge.authorizationExpiresAt ||
        challenge.authorizationExpiresAt <= now || challenge.consumedAt || challenge.invalidatedAt ||
        !challenge.resetAuthorizationHash ||
        !safelyEqualsHash(challenge.resetAuthorizationHash, input.resetAuthorizationHash)
      ) return false

      const replaced = await this.replacePasswordAndRevokeSessionsInTransaction(
        transaction,
        challenge.adminUserId,
        challenge.passwordHash,
        input.passwordHash,
        now,
      )
      if (!replaced) return false
      await transaction.passwordRecoveryChallenge.update({
        where: { id: challenge.id },
        data: {
          consumedAt: now,
          invalidatedAt: null,
          resetAuthorizationHash: null,
        },
      })
      return true
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
