import { createHash, randomBytes } from 'node:crypto'

import argon2 from 'argon2'
import { jwtVerify, SignJWT } from 'jose'

import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
} from './constants.js'
import type { AccessClaims, AdminRecord } from './types.js'

const jwtKey = (secret: string) => new TextEncoder().encode(secret)

export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

export const verifyPassword = (passwordHash: string, password: string) =>
  argon2.verify(passwordHash, password)

export const createRefreshToken = () => randomBytes(32).toString('base64url')

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex')

export const signAccessToken = async (
  user: Pick<AdminRecord, 'id' | 'role'> & Partial<Pick<AdminRecord, 'authVersion'>>,
  secret: string,
) =>
  new SignJWT(
    user.authVersion === undefined
      ? { role: user.role }
      : { role: user.role, authVersion: user.authVersion },
  )
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(jwtKey(secret))

export const verifyAccessToken = async (
  token: string,
  secret: string,
): Promise<AccessClaims> => {
  const { payload } = await jwtVerify(token, jwtKey(secret), {
    algorithms: ['HS256'],
    issuer: ACCESS_TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  })

  const rawAuthVersion = payload.authVersion
  if (
    typeof payload.sub !== 'string' ||
    (payload.role !== 'ADMIN' && payload.role !== 'SUPER_ADMIN') ||
    (rawAuthVersion !== undefined &&
      (typeof rawAuthVersion !== 'number' ||
        !Number.isSafeInteger(rawAuthVersion) ||
        rawAuthVersion < 0))
  ) {
    throw new Error('Invalid access-token claims.')
  }

  return {
    userId: payload.sub,
    role: payload.role,
    authVersion: rawAuthVersion === undefined ? null : rawAuthVersion,
  }
}
