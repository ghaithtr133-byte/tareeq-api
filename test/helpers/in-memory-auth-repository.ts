import type {
  AuthRepository,
  NewRefreshSession,
  ReplacementRefreshSession,
} from '../../src/auth/repository.js'
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

const copyUser = (user: AdminRecord) => ({ ...user })

export class InMemoryAuthRepository implements AuthRepository, AdminManagementRepository {
  private readonly users = new Map<string, AdminRecord>()
  private readonly sessions = new Map<string, StoredSession>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(readonly audit = new InMemoryAuditRepository()) {}

  addUser(user: AdminRecord) {
    this.users.set(user.id, copyUser(user))
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

  async createRefreshSession(session: NewRefreshSession) {
    if (this.sessions.has(session.tokenHash)) {
      throw new Error('Duplicate refresh token hash.')
    }
    this.seedSession(session)
  }

  async rotateRefreshSession(
    currentTokenHash: string,
    replacement: ReplacementRefreshSession,
    now: Date,
  ) {
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
  }

  async revokeRefreshSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash)
    if (session && !session.revokedAt) {
      session.revokedAt = now
      session.lastUsedAt = now
    }
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    now: Date,
  ) {
    const user = this.users.get(userId)
    if (!user) {
      throw new Error('User not found.')
    }
    user.passwordHash = passwordHash
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = now
      }
    }
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
    let release: () => void = () => {}
    const previous = this.mutationQueue
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
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
          for (const session of this.sessions.values()) {
            if (session.userId === targetAdminId && !session.revokedAt) {
              session.revokedAt = now
            }
          }
        }
      } else {
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
    } finally {
      release()
    }
  }
}
