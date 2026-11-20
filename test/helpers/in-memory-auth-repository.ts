import type {
  AuthRepository,
  NewRefreshSession,
  PasswordRecoveryChallengeInput,
  PasswordRecoveryResetInput,
  PasswordRecoveryVerificationInput,
  ReplacementRefreshSession,
} from '../../src/auth/repository.js'
import {
  PASSWORD_RECOVERY_EMAIL_LIMIT,
  PASSWORD_RECOVERY_IP_LIMIT,
  PASSWORD_RECOVERY_MAX_ATTEMPTS,
  PASSWORD_RECOVERY_RATE_WINDOW_MS,
  PASSWORD_RECOVERY_RESEND_COOLDOWN_MS,
  safelyEqualsHash,
} from '../../src/auth/recovery.js'
import type { AdminRecord } from '../../src/auth/types.js'
import type {
  AdminAccountChange,
  AdminAccountListQuery,
  AdminManagementRepository,
} from '../../src/admin-management/types.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'

type StoredSession = NewRefreshSession & {
  revokedAt: Date | null
  lastUsedAt: Date | null
}

type StoredPasswordRecoveryChallenge = {
  id: string
  adminUserId: string
  email: string
  otpHash: string
  resetAuthorizationHash: string | null
  expiresAt: Date
  verifiedAt: Date | null
  authorizationExpiresAt: Date | null
  consumedAt: Date | null
  invalidatedAt: Date | null
  attemptCount: number
  lastAttemptAt: Date | null
  createdAt: Date
}

const copyUser = (user: AdminRecord) => ({ ...user })
type SeedAdminRecord = Omit<AdminRecord, 'authVersion'> & Partial<Pick<AdminRecord, 'authVersion'>>

export class InMemoryAuthRepository implements AuthRepository, AdminManagementRepository {
  private readonly users = new Map<string, AdminRecord>()
  private readonly sessions = new Map<string, StoredSession>()
  private readonly passwordRecoveryChallenges = new Map<string, StoredPasswordRecoveryChallenge>()
  private readonly passwordRecoveryRateLimits = new Map<string, number>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(readonly audit = new InMemoryAuditRepository()) {}

  addUser(user: SeedAdminRecord) {
    this.users.set(user.id, copyUser({ ...user, authVersion: user.authVersion ?? 0 }))
  }

  private async withMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    let release: () => void = () => {}
    const previous = this.mutationQueue
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  setUserActive(userId: string, isActive: boolean) {
    const user = this.users.get(userId)
    if (user) {
      user.isActive = isActive
    }
  }

  seedSession(session: NewRefreshSession) {
    this.sessions.set(session.tokenHash, {
      ...session,
      revokedAt: null,
      lastUsedAt: null,
    })
  }

  getSession(tokenHash: string) {
    return this.sessions.get(tokenHash)
  }

  getActiveSessionCount(userId: string) {
    return [...this.sessions.values()].filter(
      (session) => session.userId === userId && !session.revokedAt,
    ).length
  }

  getUsers() {
    return [...this.users.values()].map(copyUser)
  }

  getPasswordRecoveryChallenges() {
    return [...this.passwordRecoveryChallenges.values()].map((challenge) => ({ ...challenge }))
  }

  setPasswordRecoveryChallengeExpiration(id: string, expiresAt: Date) {
    const challenge = this.passwordRecoveryChallenges.get(id)
    if (challenge) challenge.expiresAt = expiresAt
  }

  private invalidateRecoveryChallengesForUser(userId: string, now: Date) {
    for (const challenge of this.passwordRecoveryChallenges.values()) {
      if (challenge.adminUserId === userId && !challenge.consumedAt && !challenge.invalidatedAt) {
        challenge.invalidatedAt = now
      }
    }
  }

  private replacePasswordAndRevokeSessionsUnsafe(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    now: Date,
  ) {
    const user = this.users.get(userId)
    if (!user?.isActive || user.passwordHash !== expectedPasswordHash) return false
    user.passwordHash = passwordHash
    user.authVersion += 1
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) session.revokedAt = now
    }
    this.invalidateRecoveryChallengesForUser(userId, now)
    return true
  }

  async findAdminByEmail(email: string) {
    const user = [...this.users.values()].find(
      (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
    )
    return user ? copyUser(user) : null
  }

  async findAdminById(id: string) {
    const user = this.users.get(id)
    return user ? copyUser(user) : null
  }

  async updateAdminName(id: string, name: string) {
    const user = this.users.get(id)
    if (!user?.isActive) return null
    user.name = name
    return copyUser(user)
  }

  async createRefreshSession(session: NewRefreshSession, expectedAuthVersion: number) {
    return this.withMutation(() => {
      const user = this.users.get(session.userId)
      if (
        !user?.isActive ||
        user.authVersion !== expectedAuthVersion ||
        this.sessions.has(session.tokenHash)
      ) {
        return false
      }
      this.seedSession(session)
      return true
    })
  }

  async rotateRefreshSession(
    currentTokenHash: string,
    replacement: ReplacementRefreshSession,
    now: Date,
  ) {
    return this.withMutation(() => {
      const current = this.sessions.get(currentTokenHash)
      const user = current ? this.users.get(current.userId) : undefined
      if (
        !current ||
        current.revokedAt ||
        current.expiresAt <= now ||
        !user?.isActive ||
        this.sessions.has(replacement.tokenHash)
      ) {
        return null
      }

      current.revokedAt = now
      current.lastUsedAt = now
      this.seedSession({ ...replacement, userId: current.userId })
      return copyUser(user)
    })
  }

  async revokeRefreshSession(tokenHash: string, now: Date) {
    await this.withMutation(() => {
      const session = this.sessions.get(tokenHash)
      if (session && !session.revokedAt) {
        session.revokedAt = now
        session.lastUsedAt = now
      }
    })
  }

  async replacePasswordAndRevokeSessions(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    now: Date,
  ) {
    return this.withMutation(() => this.replacePasswordAndRevokeSessionsUnsafe(
      userId, expectedPasswordHash, passwordHash, now,
    ))
  }

  async createPasswordRecoveryChallenge(input: PasswordRecoveryChallengeInput, now: Date) {
    return this.withMutation(async () => {
      const windowStart = Math.floor(now.getTime() / PASSWORD_RECOVERY_RATE_WINDOW_MS)
      const consumeRate = (scope: string, identifierHash: string, limit: number) => {
        const key = `${scope}:${identifierHash}:${windowStart}`
        const count = (this.passwordRecoveryRateLimits.get(key) ?? 0) + 1
        this.passwordRecoveryRateLimits.set(key, count)
        return count <= limit
      }
      const emailAllowed = consumeRate('EMAIL', input.emailRateIdentifierHash, PASSWORD_RECOVERY_EMAIL_LIMIT)
      const ipAllowed = consumeRate('IP', input.ipRateIdentifierHash, PASSWORD_RECOVERY_IP_LIMIT)
      if (!emailAllowed || !ipAllowed) return null

      const user = await this.findAdminByEmail(input.email)
      if (!user?.isActive) return null
      const cooldownAt = now.getTime() - PASSWORD_RECOVERY_RESEND_COOLDOWN_MS
      if ([...this.passwordRecoveryChallenges.values()].some((challenge) =>
        challenge.adminUserId === user.id && !challenge.consumedAt && !challenge.invalidatedAt &&
        challenge.createdAt.getTime() > cooldownAt,
      )) return null

      if (input.actorAdminId) {
        await this.audit.append({
          actorAdminId: input.actorAdminId,
          action: 'admin_account.password_recovery_initiated',
          resourceType: 'ADMIN_USER',
          metadata: { delivery: 'requested' },
        }, user.id)
      }
      this.invalidateRecoveryChallengesForUser(user.id, now)
      this.passwordRecoveryChallenges.set(input.id, {
        id: input.id,
        adminUserId: user.id,
        email: user.email,
        otpHash: input.otpHash,
        resetAuthorizationHash: null,
        expiresAt: input.expiresAt,
        verifiedAt: null,
        authorizationExpiresAt: null,
        consumedAt: null,
        invalidatedAt: null,
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: now,
      })
      return { id: input.id, adminUserId: user.id, email: user.email, name: user.name }
    })
  }

  async invalidatePasswordRecoveryChallenge(id: string, now: Date) {
    await this.withMutation(() => {
      const challenge = this.passwordRecoveryChallenges.get(id)
      if (challenge && !challenge.consumedAt && !challenge.invalidatedAt) challenge.invalidatedAt = now
    })
  }

  async verifyPasswordRecoveryChallenge(input: PasswordRecoveryVerificationInput, now: Date) {
    return this.withMutation(() => {
      const challenge = this.passwordRecoveryChallenges.get(input.challengeId)
      const user = challenge ? this.users.get(challenge.adminUserId) : undefined
      if (
        !challenge || !user?.isActive || user.email.toLowerCase() !== challenge.email.toLowerCase() ||
        challenge.expiresAt <= now || challenge.verifiedAt || challenge.consumedAt ||
        challenge.invalidatedAt || challenge.attemptCount >= PASSWORD_RECOVERY_MAX_ATTEMPTS
      ) return false
      if (!safelyEqualsHash(challenge.otpHash, input.otpHash)) {
        challenge.attemptCount += 1
        challenge.lastAttemptAt = now
        if (challenge.attemptCount >= PASSWORD_RECOVERY_MAX_ATTEMPTS) challenge.invalidatedAt = now
        return false
      }
      challenge.verifiedAt = now
      challenge.lastAttemptAt = now
      challenge.resetAuthorizationHash = input.resetAuthorizationHash
      challenge.authorizationExpiresAt = input.authorizationExpiresAt
      return true
    })
  }

  async consumePasswordRecoveryAndReplacePassword(input: PasswordRecoveryResetInput, now: Date) {
    return this.withMutation(() => {
      const challenge = this.passwordRecoveryChallenges.get(input.challengeId)
      const user = challenge ? this.users.get(challenge.adminUserId) : undefined
      if (
        !challenge || !user?.isActive || user.email.toLowerCase() !== challenge.email.toLowerCase() ||
        !challenge.verifiedAt || !challenge.authorizationExpiresAt ||
        challenge.authorizationExpiresAt <= now || challenge.consumedAt || challenge.invalidatedAt ||
        !challenge.resetAuthorizationHash ||
        !safelyEqualsHash(challenge.resetAuthorizationHash, input.resetAuthorizationHash)
      ) return false
      if (!this.replacePasswordAndRevokeSessionsUnsafe(
        user.id, user.passwordHash, input.passwordHash, now,
      )) return false
      challenge.consumedAt = now
      challenge.invalidatedAt = null
      challenge.resetAuthorizationHash = null
      return true
    })
  }

  async list(query: AdminAccountListQuery) {
    const records = this.getUsers().sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
    const offset = (query.page - 1) * query.limit
    return {
      items: records.slice(offset, offset + query.limit).map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      })),
      total: records.length,
    }
  }

  async update(
    actorAdminId: string,
    targetAdminId: string,
    change: AdminAccountChange,
    now: Date,
  ) {
    return this.withMutation(async () => {
      const actor = this.users.get(actorAdminId)
      const target = this.users.get(targetAdminId)
      if (!actor?.isActive || actor.role !== 'SUPER_ADMIN') {
        return { outcome: 'ACTOR_FORBIDDEN' as const }
      }
      if (!target) return { outcome: 'NOT_FOUND' as const }

      if ('isActive' in change) {
        if (change.isActive === target.isActive) {
          return { outcome: 'UNCHANGED' as const }
        }
        if (actorAdminId === targetAdminId && !change.isActive) {
          return { outcome: 'SELF_DEACTIVATION_FORBIDDEN' as const }
        }
        if (target.isActive && target.role === 'SUPER_ADMIN' && !change.isActive) {
          const activeSuperAdmins = this.getUsers().filter(
            (user) => user.role === 'SUPER_ADMIN' && user.isActive,
          ).length
          if (activeSuperAdmins <= 1) {
            return { outcome: 'LAST_ACTIVE_SUPER_ADMIN' as const }
          }
        }

        await this.audit.append({
          actorAdminId,
          action: change.isActive
            ? 'admin_account.activated'
            : 'admin_account.deactivated',
          resourceType: 'ADMIN_USER',
          metadata: {
            fromActive: target.isActive,
            toActive: change.isActive,
          },
        }, targetAdminId)
        target.isActive = change.isActive
        if (!change.isActive) {
          target.authVersion += 1
          for (const session of this.sessions.values()) {
            if (session.userId === targetAdminId && !session.revokedAt) {
              session.revokedAt = now
            }
          }
          this.invalidateRecoveryChallengesForUser(targetAdminId, now)
        }
      } else {
        if ('role' in change) {
          if (change.role === target.role) return { outcome: 'UNCHANGED' as const }
          if (
            actorAdminId === targetAdminId &&
            target.role === 'SUPER_ADMIN' &&
            change.role !== 'SUPER_ADMIN'
          ) {
            return { outcome: 'SELF_DEMOTION_FORBIDDEN' as const }
          }
          if (
            target.isActive &&
            target.role === 'SUPER_ADMIN' &&
            change.role !== 'SUPER_ADMIN'
          ) {
            const activeSuperAdmins = this.getUsers().filter(
              (user) => user.role === 'SUPER_ADMIN' && user.isActive,
            ).length
            if (activeSuperAdmins <= 1) {
              return { outcome: 'LAST_ACTIVE_SUPER_ADMIN' as const }
            }
          }

          await this.audit.append({
            actorAdminId,
            action: 'admin_account.role_changed',
            resourceType: 'ADMIN_USER',
            metadata: { fromRole: target.role, toRole: change.role },
          }, targetAdminId)
          target.role = change.role
        } else {
          const changedFields = [
            ...(change.name !== undefined && change.name !== target.name ? ['name'] : []),
            ...(change.email !== undefined && change.email !== target.email ? ['email'] : []),
          ]
          if (changedFields.length === 0) return { outcome: 'UNCHANGED' as const }
          if (
            change.email !== undefined &&
            this.getUsers().some(
              (user) => user.id !== targetAdminId && user.email.toLowerCase() === change.email!.toLowerCase(),
            )
          ) {
            return { outcome: 'EMAIL_ALREADY_EXISTS' as const }
          }
          await this.audit.append({
            actorAdminId,
            action: 'admin_account.identity_updated',
            resourceType: 'ADMIN_USER',
            metadata: { changedFields },
          }, targetAdminId)
          if (change.name !== undefined) target.name = change.name
          if (change.email !== undefined) {
            target.email = change.email
            this.invalidateRecoveryChallengesForUser(targetAdminId, now)
          }
        }
      }

      return {
        outcome: 'UPDATED' as const,
        account: {
          id: target.id,
          name: target.name,
          email: target.email,
          role: target.role,
          isActive: target.isActive,
        },
      }
    })
  }
}
