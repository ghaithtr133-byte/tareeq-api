import 'dotenv/config'

import { randomBytes, randomUUID } from 'node:crypto'

import { SignJWT } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER } from '../src/auth/constants.js'
import { hashPassword } from '../src/auth/crypto.js'
import { PrismaAuthRepository } from '../src/auth/prisma-repository.js'
import type { PasswordRecoveryEmail, PasswordRecoveryEmailSender } from '../src/auth/recovery-email.js'
import {
  hashRecoveryRateIdentifier,
  PASSWORD_RECOVERY_EMAIL_LIMIT,
  PASSWORD_RECOVERY_IP_LIMIT,
  PASSWORD_RECOVERY_MAX_ATTEMPTS,
  PASSWORD_RECOVERY_RATE_WINDOW_MS,
  PASSWORD_RECOVERY_OTP_TTL_MS,
} from '../src/auth/recovery.js'
import { AuthService } from '../src/auth/service.js'
import { PrismaAdminManagementRepository } from '../src/admin-management/prisma-repository.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { verifyDisposableTestDatabase } from '../src/database/test-safety.js'

const shouldRun = process.env.RUN_AUTH_RECOVERY_DATABASE_INTEGRATION === '1'
const runToken = `${Date.now()}-${randomUUID().slice(0, 8)}`
const currentPassword = `Current-${randomBytes(18).toString('base64url')}9aA`
const replacementPassword = `Replacement-${randomBytes(18).toString('base64url')}8bB`
const recoverySecret = 'recovery-integration-secret-longer-than-thirty-two-characters'
// Remote disposable-Neon teardown can legitimately span several dependent
// deletes. This is test-only and does not alter production transaction limits.
const cleanupTransactionOptions = { maxWait: 15_000, timeout: 30_000 } as const
const remoteRecoveryScenarioTimeoutMs = 60_000

const trackedUserIds = new Set<string>()
const trackedRateHashes = new Set<string>()
const sentEmails: PasswordRecoveryEmail[] = []

const emailSender: PasswordRecoveryEmailSender = {
  available: true,
  async sendPasswordRecovery(email) {
    sentEmails.push(email)
  },
}

const createService = (now: () => Date = () => new Date()) => new AuthService(
  new PrismaAuthRepository(),
  process.env.JWT_SECRET!,
  recoverySecret,
  emailSender,
  now,
)

const createAdmin = async (label: string, role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN', isActive = true) => {
  const user = await getPrisma().adminUser.create({
    data: {
      name: `Recovery integration ${label}`,
      email: `recovery-${runToken}-${label}@example.invalid`,
      passwordHash: await hashPassword(currentPassword),
      role,
      isActive,
    },
  })
  trackedUserIds.add(user.id)
  return user
}

const latestEmail = (challengeId: string) => {
  const email = [...sentEmails].reverse().find((item) => item.challengeId === challengeId)
  if (!email) throw new Error('Expected a mocked password recovery email.')
  return email
}

const trackRecoveryRateIdentifiers = (email: string, clientIdentifier: string) => {
  trackedRateHashes.add(hashRecoveryRateIdentifier(recoverySecret, 'email', email.trim().toLowerCase()))
  trackedRateHashes.add(hashRecoveryRateIdentifier(recoverySecret, 'ip', clientIdentifier))
}

const requestRecovery = async (service: AuthService, email: string, clientIdentifier: string) => {
  trackRecoveryRateIdentifiers(email, clientIdentifier)
  return service.requestPasswordRecovery(email, clientIdentifier)
}

const currentRecoveryRateWindow = (now: Date) => {
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / PASSWORD_RECOVERY_RATE_WINDOW_MS) * PASSWORD_RECOVERY_RATE_WINDOW_MS,
  )
  return {
    windowStartedAt,
    expiresAt: new Date(windowStartedAt.getTime() + PASSWORD_RECOVERY_RATE_WINDOW_MS),
  }
}

const cleanup = async () => {
  const prisma = getPrisma()
  const userIds = [...trackedUserIds]
  const hashes = [...trackedRateHashes]
  await prisma.$transaction(async (transaction) => {
    if (userIds.length > 0) {
      await transaction.passwordRecoveryChallenge.deleteMany({ where: { adminUserId: { in: userIds } } })
      await transaction.refreshSession.deleteMany({ where: { userId: { in: userIds } } })
      await transaction.hardDeleteChallenge.deleteMany({ where: { actorAdminId: { in: userIds } } })
      await transaction.adminAuditLog.deleteMany({ where: { actorAdminId: { in: userIds } } })
      await transaction.adminUser.deleteMany({ where: { id: { in: userIds } } })
    }
    if (hashes.length > 0) {
      await transaction.passwordRecoveryRateLimit.deleteMany({ where: { identifierHash: { in: hashes } } })
    }
  }, cleanupTransactionOptions)
  expect(await prisma.adminUser.count({ where: { id: { in: userIds } } })).toBe(0)
  trackedUserIds.clear()
  trackedRateHashes.clear()
  sentEmails.length = 0
}

describe.runIf(shouldRun)('PostgreSQL password recovery and session revocation', () => {
  beforeAll(async () => {
    await verifyDisposableTestDatabase()
    await getPrisma().$queryRaw`SELECT 1`
  })

  afterEach(async () => {
    await cleanup()
  }, remoteRecoveryScenarioTimeoutMs)

  afterAll(async () => {
    await cleanup()
    await disconnectPrisma()
  }, remoteRecoveryScenarioTimeoutMs)

  it('locks OTP verification and reset authorization to one successful consumer, then revokes prior credentials', async () => {
    const user = await createAdmin('concurrent-reset')
    const service = createService()
    const credentials = await service.login(user.email, currentPassword)
    const secondCredentials = await service.login(user.email, currentPassword)
    const requested = await requestRecovery(service, user.email, 'recovery-concurrent-client')
    const delivery = latestEmail(requested.challengeId)

    const verification = await Promise.allSettled([
      service.verifyPasswordRecovery(requested.challengeId, delivery.otp),
      service.verifyPasswordRecovery(requested.challengeId, delivery.otp),
    ])
    expect(verification.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(verification.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const authorization = (verification.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ resetAuthorization: string }>).value.resetAuthorization

    const resets = await Promise.allSettled([
      service.resetPasswordWithRecovery(requested.challengeId, authorization, replacementPassword),
      service.resetPasswordWithRecovery(requested.challengeId, authorization, replacementPassword),
    ])
    expect(resets.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(resets.filter((result) => result.status === 'rejected')).toHaveLength(1)

    for (const oldAccessToken of [credentials.accessToken, secondCredentials.accessToken]) {
      await expect(service.authenticateAccessToken(oldAccessToken)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    }
    for (const oldRefreshToken of [credentials.refreshToken, secondCredentials.refreshToken]) {
      await expect(service.refresh(oldRefreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_SESSION' })
    }
    await expect(getPrisma().refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    })).resolves.toBe(0)
    await expect(service.login(user.email, currentPassword)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(service.login(user.email, replacementPassword)).resolves.toMatchObject({ user: { id: user.id } })
    await expect(getPrisma().adminUser.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({ authVersion: 1 })
    await expect(getPrisma().passwordRecoveryChallenge.findUniqueOrThrow({ where: { id: requested.challengeId } })).resolves.toMatchObject({ consumedAt: expect.any(Date), resetAuthorizationHash: null })
  }, remoteRecoveryScenarioTimeoutMs)

  it('uses a SUPER_ADMIN-initiated recovery to revoke every target credential after OTP reset', async () => {
    const actor = await createAdmin('initiating-super-admin', 'SUPER_ADMIN')
    const target = await createAdmin('super-admin-reset-target')
    const service = createService()
    const credentials = await service.login(target.email, currentPassword)
    const clientIdentifier = `super-admin-initiation-${runToken}`
    trackRecoveryRateIdentifiers(target.email, clientIdentifier)

    await service.initiatePasswordRecoveryForAdmin(actor.id, target.id, clientIdentifier)
    const delivery = sentEmails.at(-1)
    expect(delivery).toMatchObject({ to: target.email, challengeId: expect.any(String) })
    const verified = await service.verifyPasswordRecovery(delivery!.challengeId, delivery!.otp)
    await service.resetPasswordWithRecovery(
      delivery!.challengeId,
      verified.resetAuthorization,
      replacementPassword,
    )

    await expect(service.authenticateAccessToken(credentials.accessToken)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    await expect(service.refresh(credentials.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_SESSION' })
    await expect(service.login(target.email, currentPassword)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(service.login(target.email, replacementPassword)).resolves.toMatchObject({ user: { id: target.id } })
    await expect(getPrisma().refreshSession.count({
      where: { userId: target.id, revokedAt: null },
    })).resolves.toBe(1)
    await expect(getPrisma().adminAuditLog.findFirst({
      where: {
        actorAdminId: actor.id,
        action: 'admin_account.password_recovery_initiated',
        resourceType: 'ADMIN_USER',
        resourceId: target.id,
      },
    })).resolves.toMatchObject({ metadata: { delivery: 'requested' } })
  }, remoteRecoveryScenarioTimeoutMs)

  it('enforces OTP expiry and attempt limits while keeping request responses generic and rate-limited', async () => {
    // Keep the database fixture and the service clock close to the real
    // PostgreSQL clock. A fixed calendar date would eventually make the
    // cooldown and expiry assertions dependent on when this suite is run.
    let now = new Date()
    const service = createService(() => new Date(now))
    const user = await createAdmin('limits')

    const active = await requestRecovery(service, user.email, 'same-ip')
    const delivery = latestEmail(active.challengeId)
    for (let attempt = 0; attempt < PASSWORD_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
      await expect(service.verifyPasswordRecovery(active.challengeId, '000000')).rejects.toMatchObject({ code: 'PASSWORD_RECOVERY_VERIFICATION_FAILED' })
    }
    await expect(getPrisma().passwordRecoveryChallenge.findUniqueOrThrow({ where: { id: active.challengeId } })).resolves.toMatchObject({
      attemptCount: PASSWORD_RECOVERY_MAX_ATTEMPTS,
      invalidatedAt: expect.any(Date),
    })

    now = new Date(now.getTime() + PASSWORD_RECOVERY_OTP_TTL_MS + 1)
    const expired = await requestRecovery(service, user.email, 'expired-ip')
    const expiredDelivery = latestEmail(expired.challengeId)
    now = new Date(now.getTime() + PASSWORD_RECOVERY_OTP_TTL_MS + 1)
    await expect(service.verifyPasswordRecovery(expired.challengeId, expiredDelivery.otp)).rejects.toMatchObject({ code: 'PASSWORD_RECOVERY_VERIFICATION_FAILED' })

    const genericUnknown = await requestRecovery(service, `unknown-${runToken}@example.invalid`, 'rate-ip')
    const inactive = await createAdmin('inactive', 'ADMIN', false)
    const genericInactive = await requestRecovery(service, inactive.email, 'rate-ip')
    expect(genericUnknown.challengeId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(genericInactive.challengeId).toMatch(/^[0-9a-f-]{36}$/i)

    // Seed the two exact current-window counters at their documented limits.
    // This proves PostgreSQL upsert enforcement without turning a rate-limit
    // assertion into fifteen network transactions on a disposable Neon target.
    const rateLimited = await createAdmin('rate-limited')
    const ipRateLimited = await createAdmin('ip-rate-limited')
    const emailHash = hashRecoveryRateIdentifier(recoverySecret, 'email', rateLimited.email)
    // This value is intentionally distinct from the earlier generic-request
    // fixture in this test, so its current-window composite key cannot exist
    // before the deterministic threshold row is inserted.
    const blockedRateIp = `rate-limit-${runToken}-${randomUUID()}`
    const ipHash = hashRecoveryRateIdentifier(recoverySecret, 'ip', blockedRateIp)
    const { windowStartedAt, expiresAt } = currentRecoveryRateWindow(now)
    await getPrisma().passwordRecoveryRateLimit.createMany({ data: [
      { scope: 'EMAIL', identifierHash: emailHash, windowStartedAt, expiresAt, count: PASSWORD_RECOVERY_EMAIL_LIMIT },
      { scope: 'IP', identifierHash: ipHash, windowStartedAt, expiresAt, count: PASSWORD_RECOVERY_IP_LIMIT },
    ] })
    trackedRateHashes.add(emailHash)
    trackedRateHashes.add(ipHash)
    const sentBeforeRateLimit = sentEmails.length
    const emailLimited = await requestRecovery(service, rateLimited.email, 'email-rate-ip')
    const ipLimited = await requestRecovery(service, ipRateLimited.email, blockedRateIp)
    expect(emailLimited.challengeId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(ipLimited.challengeId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(sentEmails).toHaveLength(sentBeforeRateLimit)
    const limits = await getPrisma().passwordRecoveryRateLimit.findMany({ where: { identifierHash: { in: [emailHash, ipHash] } } })
    expect(limits).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifierHash: emailHash, count: expect.any(Number) }),
      expect.objectContaining({ identifierHash: ipHash, count: expect.any(Number) }),
    ]))
    expect(limits.find(({ identifierHash }) => identifierHash === emailHash)?.count).toBeGreaterThan(PASSWORD_RECOVERY_EMAIL_LIMIT)
    expect(limits.find(({ identifierHash }) => identifierHash === ipHash)?.count).toBeGreaterThan(PASSWORD_RECOVERY_IP_LIMIT)
    expect(delivery.otp).toMatch(/^\d{6}$/)
  }, remoteRecoveryScenarioTimeoutMs)

  it('invalidates credentials on deactivation, resolves changed roles from the database, and accepts legacy authVersion zero only', async () => {
    const actor = await createAdmin('actor', 'SUPER_ADMIN')
    const target = await createAdmin('target')
    const service = createService()
    const management = new PrismaAdminManagementRepository()
    const credentials = await service.login(target.email, currentPassword)

    await expect(management.update(actor.id, target.id, { role: 'SUPER_ADMIN' }, new Date())).resolves.toMatchObject({ outcome: 'UPDATED' })
    await expect(service.authenticateAccessToken(credentials.accessToken)).resolves.toMatchObject({ role: 'SUPER_ADMIN' })
    await expect(management.update(actor.id, target.id, { isActive: false }, new Date())).resolves.toMatchObject({ outcome: 'UPDATED' })
    await expect(service.authenticateAccessToken(credentials.accessToken)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    await expect(service.refresh(credentials.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_SESSION' })

    const legacy = await createAdmin('legacy')
    const timestamp = Math.floor(Date.now() / 1_000)
    const legacyToken = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(legacy.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(timestamp)
      .setExpirationTime(timestamp + 60)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
    await expect(service.authenticateAccessToken(legacyToken)).resolves.toMatchObject({ userId: legacy.id, authVersion: 0 })
    await getPrisma().adminUser.update({ where: { id: legacy.id }, data: { authVersion: { increment: 1 } } })
    await expect(service.authenticateAccessToken(legacyToken)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  }, 30_000)
})
