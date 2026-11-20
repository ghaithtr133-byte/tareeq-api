export type AdminRole = 'ADMIN' | 'SUPER_ADMIN'

export type AdminRecord = {
  id: string
  name: string
  email: string
  passwordHash: string
  authVersion: number
  role: AdminRole
  isActive: boolean
}

export type PublicAdmin = Omit<AdminRecord, 'passwordHash' | 'isActive' | 'authVersion'>

export type AccessClaims = {
  userId: string
  role: AdminRole
  /** `null` identifies a signed legacy JWT issued before TA-92. */
  authVersion: number | null
}

export type IssuedCredentials = {
  accessToken: string
  refreshToken: string
  user: PublicAdmin
}

export type AuthEnv = {
  Variables: {
    authClaims: AccessClaims
    requestId: string
  }
}
