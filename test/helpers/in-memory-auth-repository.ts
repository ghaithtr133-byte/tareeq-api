import type {
  AuthRepository,
  NewRefreshSession,
  ReplacementRefreshSession,
} from '../../src/auth/repository.js'
import type { AdminRecord } from '../../src/auth/types.js'

type StoredSession = NewRefreshSession & {
  revokedAt: Date | null
  lastUsedAt: Date | null
}

const copyUser = (user: AdminRecord) => ({ ...user })

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, AdminRecord>()
  private readonly sessions = new Map<string, StoredSession>()

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
}
