export type AdminRole = 'ADMIN' | 'SUPER_ADMIN'

export type AdminRecord = {
  id: string
  name: string
  email: string
  passwordHash: string
  role: AdminRole
  isActive: boolean
}

export type PublicAdmin = Omit<AdminRecord, 'passwordHash' | 'isActive'>

export type AccessClaims = {
  userId: string
  role: AdminRole
}

export type IssuedCredentials = {
  accessToken: string
  refreshToken: string
  user: PublicAdmin
}

export type AuthEnv = {
  Variables: {
    authClaims: AccessClaims
  }
}
