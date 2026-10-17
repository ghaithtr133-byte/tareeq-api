import type { AdminRecord } from './types.js'

export type NewRefreshSession = {
  userId: string
  tokenHash: string
  expiresAt: Date
}

export type ReplacementRefreshSession = Omit<NewRefreshSession, 'userId'>

export interface AuthRepository {
  findAdminByEmail(email: string): Promise<AdminRecord | null>
  findAdminById(id: string): Promise<AdminRecord | null>
  createRefreshSession(session: NewRefreshSession): Promise<void>
  rotateRefreshSession(
    currentTokenHash: string,
    replacement: ReplacementRefreshSession,
    now: Date,
  ): Promise<AdminRecord | null>
  revokeRefreshSession(tokenHash: string, now: Date): Promise<void>
  updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void>
}
