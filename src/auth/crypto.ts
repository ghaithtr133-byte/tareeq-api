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
  user: Pick<AdminRecord, 'id' | 'role'>,
  secret: string,
) =>
  new SignJWT({ role: user.role })
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

  if (
    typeof payload.sub !== 'string' ||
    (payload.role !== 'ADMIN' && payload.role !== 'SUPER_ADMIN')
  ) {
    throw new Error('Invalid access-token claims.')
  }

  return {
    userId: payload.sub,
    role: payload.role,
  }
}
