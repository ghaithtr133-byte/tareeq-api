import type { AdminRecord } from './types.js'

export type NewRefreshSession = {
  userId: string
  tokenHash: string
  expiresAt: Date
}

export type ReplacementRefreshSession = Omit<NewRefreshSession, 'userId'>

export type PasswordRecoveryChallengeInput = {
  id: string
  email: string
  emailRateIdentifierHash: string
  ipRateIdentifierHash: string
  otpHash: string
  expiresAt: Date
  actorAdminId?: string
}

export type PasswordRecoveryChallengeForDelivery = {
  id: string
  adminUserId: string
  email: string
  name: string
}

export type PasswordRecoveryVerificationInput = {
  challengeId: string
  otpHash: string
  resetAuthorizationHash: string
  authorizationExpiresAt: Date
}

export type PasswordRecoveryResetInput = {
  challengeId: string
  resetAuthorizationHash: string
  passwordHash: string
}

export interface AuthRepository {
  findAdminByEmail(email: string): Promise<AdminRecord | null>
  findAdminById(id: string): Promise<AdminRecord | null>
  updateAdminName(id: string, name: string): Promise<AdminRecord | null>
  createRefreshSession(
    session: NewRefreshSession,
    expectedAuthVersion: number,
  ): Promise<boolean>
  rotateRefreshSession(
    currentTokenHash: string,
    replacement: ReplacementRefreshSession,
    now: Date,
  ): Promise<AdminRecord | null>
  revokeRefreshSession(tokenHash: string, now: Date): Promise<void>
  replacePasswordAndRevokeSessions(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean>
  createPasswordRecoveryChallenge(
    input: PasswordRecoveryChallengeInput,
    now: Date,
  ): Promise<PasswordRecoveryChallengeForDelivery | null>
  invalidatePasswordRecoveryChallenge(id: string, now: Date): Promise<void>
  verifyPasswordRecoveryChallenge(
    input: PasswordRecoveryVerificationInput,
    now: Date,
  ): Promise<boolean>
  consumePasswordRecoveryAndReplacePassword(
    input: PasswordRecoveryResetInput,
    now: Date,
  ): Promise<boolean>
}
