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
    await this.repository.createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    })

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

  async getCurrentUser(userId: string): Promise<PublicAdmin> {
    const user = await this.repository.findAdminById(userId)
    if (!user || !user.isActive) {
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
    await this.repository.updatePasswordAndRevokeSessions(
      user.id,
      passwordHash,
      new Date(),
    )
  }
}
