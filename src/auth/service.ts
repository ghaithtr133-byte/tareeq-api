import { randomUUID } from 'node:crypto'

import { ApiError } from '../shared/http.js'
import { REFRESH_TOKEN_TTL_SECONDS } from './constants.js'
import {
  createRefreshToken,
  hashPassword,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from './crypto.js'
import type { AuthRepository } from './repository.js'
import type { PasswordRecoveryEmailSender } from './recovery-email.js'
import {
  createRecoveryAuthorization,
  createRecoveryOtp,
  hashRecoveryAuthorization,
  hashRecoveryOtp,
  hashRecoveryRateIdentifier,
  PASSWORD_RECOVERY_AUTHORIZATION_TTL_MS,
  PASSWORD_RECOVERY_OTP_TTL_MS,
} from './recovery.js'
import type {
  AccessClaims,
  AdminRecord,
  IssuedCredentials,
  PublicAdmin,
} from './types.js'

const dummyPasswordHash = hashPassword('Not-A-Real-Password-123')

const invalidCredentials = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.')

const invalidSession = () =>
  new ApiError(401, 'INVALID_REFRESH_SESSION', 'Authentication is required.')

const toPublicAdmin = (user: AdminRecord): PublicAdmin => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
})

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtSecret: string,
    private readonly passwordRecoverySecret = jwtSecret,
    private readonly passwordRecoveryEmailSender: PasswordRecoveryEmailSender = {
      available: false,
      async sendPasswordRecovery() {
        throw new Error('Password recovery email delivery is unavailable.')
      },
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(email: string, password: string): Promise<IssuedCredentials> {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await this.repository.findAdminByEmail(normalizedEmail)
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await dummyPasswordHash),
      password,
    )

    if (!user || !passwordMatches || !user.isActive) {
      throw invalidCredentials()
    }

    const refreshToken = createRefreshToken()
    const sessionCreated = await this.repository.createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    }, user.authVersion)
    if (!sessionCreated) {
      throw invalidCredentials()
    }

    return {
      accessToken: await signAccessToken(user, this.jwtSecret),
      refreshToken,
      user: toPublicAdmin(user),
    }
  }

  async refresh(refreshToken: string): Promise<IssuedCredentials> {
    const replacementToken = createRefreshToken()
    const user = await this.repository.rotateRefreshSession(
      hashRefreshToken(refreshToken),
      {
        tokenHash: hashRefreshToken(replacementToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
      new Date(),
    )

    if (!user) {
      throw invalidSession()
    }

    return {
      accessToken: await signAccessToken(user, this.jwtSecret),
      refreshToken: replacementToken,
      user: toPublicAdmin(user),
    }
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) {
      await this.repository.revokeRefreshSession(
        hashRefreshToken(refreshToken),
        new Date(),
      )
    }
  }

  verifyAccessToken(token: string): Promise<AccessClaims> {
    return verifyAccessToken(token, this.jwtSecret)
  }

  async authenticateAccessToken(token: string): Promise<AccessClaims> {
    const claims = await this.verifyAccessToken(token)
    const user = await this.repository.findAdminById(claims.userId)
    if (
      !user?.isActive ||
      (claims.authVersion !== null && claims.authVersion !== user.authVersion) ||
      (claims.authVersion === null && user.authVersion !== 0)
    ) {
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.')
    }
    return { userId: user.id, role: user.role, authVersion: user.authVersion }
  }

  async getCurrentUser(userId: string): Promise<PublicAdmin> {
    const user = await this.repository.findAdminById(userId)
    if (!user || !user.isActive) {
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.')
    }

    return toPublicAdmin(user)
  }

  async updateProfileName(userId: string, name: string): Promise<PublicAdmin> {
    const user = await this.repository.updateAdminName(userId, name)
    if (!user) {
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.')
    }
    return toPublicAdmin(user)
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.repository.findAdminById(userId)
    if (!user || !user.isActive) {
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.')
    }

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw invalidCredentials()
    }

    const passwordHash = await hashPassword(newPassword)
    const changed = await this.repository.replacePasswordAndRevokeSessions(
      user.id,
      user.passwordHash,
      passwordHash,
      new Date(),
    )
    if (!changed) {
      throw invalidCredentials()
    }
  }

  async requestPasswordRecovery(email: string, clientIdentifier: string) {
    // Return a fresh opaque UUID whether or not a durable challenge is created.
    // This lets the browser proceed to verification without turning account
    // existence, delivery, or rate-limit state into an observable signal.
    const challengeId = randomUUID()
    await this.createAndDeliverPasswordRecovery(email, clientIdentifier, undefined, challengeId)
    return { challengeId }
  }

  async initiatePasswordRecoveryForAdmin(
    actorAdminId: string,
    targetAdminId: string,
    clientIdentifier: string,
  ) {
    const target = await this.repository.findAdminById(targetAdminId)
    if (!target || !target.isActive) {
      throw new ApiError(404, 'ADMIN_ACCOUNT_NOT_FOUND', 'Administrator account was not found.')
    }
    await this.createAndDeliverPasswordRecovery(
      target.email,
      clientIdentifier,
      actorAdminId,
    )
  }

  async verifyPasswordRecovery(challengeId: string, otp: string) {
    const authorization = createRecoveryAuthorization()
    const now = this.now()
    const verified = await this.repository.verifyPasswordRecoveryChallenge({
      challengeId,
      otpHash: hashRecoveryOtp(this.passwordRecoverySecret, challengeId, otp),
      resetAuthorizationHash: hashRecoveryAuthorization(
        this.passwordRecoverySecret,
        challengeId,
        authorization,
      ),
      authorizationExpiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_AUTHORIZATION_TTL_MS),
    }, now)
    if (!verified) {
      throw new ApiError(
        400,
        'PASSWORD_RECOVERY_VERIFICATION_FAILED',
        'The recovery code is invalid or expired.',
      )
    }
    return { resetAuthorization: authorization }
  }

  async resetPasswordWithRecovery(
    challengeId: string,
    resetAuthorization: string,
    newPassword: string,
  ) {
    const changed = await this.repository.consumePasswordRecoveryAndReplacePassword({
      challengeId,
      resetAuthorizationHash: hashRecoveryAuthorization(
        this.passwordRecoverySecret,
        challengeId,
        resetAuthorization,
      ),
      passwordHash: await hashPassword(newPassword),
    }, this.now())
    if (!changed) {
      throw new ApiError(
        400,
        'PASSWORD_RECOVERY_AUTHORIZATION_INVALID',
        'The recovery authorization is invalid or expired.',
      )
    }
  }

  private async createAndDeliverPasswordRecovery(
    email: string,
    clientIdentifier: string,
    actorAdminId?: string,
    id = randomUUID(),
  ) {
    const normalizedEmail = email.trim().toLowerCase()
    const now = this.now()
    const otp = createRecoveryOtp()
    const challenge = await this.repository.createPasswordRecoveryChallenge({
      id,
      email: normalizedEmail,
      emailRateIdentifierHash: hashRecoveryRateIdentifier(
        this.passwordRecoverySecret,
        'email',
        normalizedEmail,
      ),
      ipRateIdentifierHash: hashRecoveryRateIdentifier(
        this.passwordRecoverySecret,
        'ip',
        clientIdentifier,
      ),
      otpHash: hashRecoveryOtp(this.passwordRecoverySecret, id, otp),
      expiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_OTP_TTL_MS),
      ...(actorAdminId ? { actorAdminId } : {}),
    }, now)
    if (!challenge) return

    try {
      if (!this.passwordRecoveryEmailSender.available) throw new Error('Unavailable recovery sender.')
      await this.passwordRecoveryEmailSender.sendPasswordRecovery({
        to: challenge.email,
        name: challenge.name,
        otp,
        challengeId: challenge.id,
      })
    } catch {
      // A failed direct delivery invalidates the code so a possibly leaked or
      // ambiguously delivered code can never be used. The API remains generic.
      await this.repository.invalidatePasswordRecoveryChallenge(challenge.id, this.now())
    }
  }
}
