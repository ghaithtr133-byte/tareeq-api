import 'dotenv/config'

import { randomBytes, randomUUID } from 'node:crypto'

import { decodeJwt, SignJWT } from 'jose'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  REFRESH_COOKIE_NAME,
} from '../src/auth/constants.js'
import {
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from '../src/auth/crypto.js'
import { requireAuthentication, requireRole } from '../src/auth/middleware.js'
import { PrismaAuthRepository } from '../src/auth/prisma-repository.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole, AuthEnv } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'

const RUN_DATABASE_INTEGRATION = process.env.RUN_DATABASE_INTEGRATION === '1'
const RUN_ID = `${Date.now()}-${randomUUID().slice(0, 8)}`
const EMAIL_PREFIX = `tareeq-integration-${RUN_ID}`
const ORIGIN = 'http://localhost:3001'
const DISALLOWED_ORIGIN = 'https://unauthorized.example.test'
const CURRENT_PASSWORD = `Current-${randomBytes(18).toString('base64url')}9aA`
const NEW_PASSWORD = `Changed-${randomBytes(18).toString('base64url')}8bB`

const trackedUserIds = new Set<string>()
const observedSessionIds = new Set<string>()
let usersCreated = 0
let sessionsObserved = 0

const config = (isProduction = false): AuthConfig => ({
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  allowedOrigins: [ORIGIN],
  isProduction,
})

const runtime = (isProduction = false): AuthRuntime => ({
  getConfig: () => config(isProduction),
  getService: () =>
    new AuthService(new PrismaAuthRepository(), process.env.JWT_SECRET!),
})

const getSetCookies = (response: Response) => response.headers.getSetCookie()
const getCookieValue = (cookies: string[], name: string) =>
  cookies
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .split(';', 1)[0]
const cookieHeader = (...values: Array<[string, string | undefined]>) =>
  values
    .filter((value): value is [string, string] => typeof value[1] === 'string')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
const jsonRequest = (body: unknown, cookie?: string, origin = ORIGIN) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: JSON.stringify(body),
})

const createAdmin = async (
  label: string,
  options: {
    password?: string
    role?: AdminRole
    isActive?: boolean
  } = {},
) => {
  const email = `${EMAIL_PREFIX}-${label}@example.test`
  const user = await getPrisma().adminUser.create({
    data: {
      name: `Integration ${label}`,
      email,
      passwordHash: await hashPassword(options.password ?? CURRENT_PASSWORD),
      role: options.role ?? 'ADMIN',
      isActive: options.isActive ?? true,
    },
  })
  trackedUserIds.add(user.id)
  usersCreated += 1
  return user
}

const collectSessions = async () => {
  for (const userId of trackedUserIds) {
    const sessions = await getPrisma().refreshSession.findMany({
      where: { userId },
      select: { id: true },
    })
    for (const { id } of sessions) {
      if (!observedSessionIds.has(id)) {
        sessionsObserved += 1
      }
      observedSessionIds.add(id)
    }
  }
}

const cleanupExactRecords = async () => {
  await collectSessions()
  for (const sessionId of observedSessionIds) {
    await getPrisma().refreshSession.deleteMany({ where: { id: sessionId } })
  }
  for (const userId of trackedUserIds) {
    await getPrisma().adminUser.deleteMany({ where: { id: userId } })
  }
  const remainingUsers = await getPrisma().adminUser.count({
    where: { id: { in: [...trackedUserIds] } },
  })
  const remainingSessions = await getPrisma().refreshSession.count({
    where: { id: { in: [...observedSessionIds] } },
  })
  expect(remainingUsers).toBe(0)
  expect(remainingSessions).toBe(0)
  trackedUserIds.clear()
  observedSessionIds.clear()
}

describe.runIf(RUN_DATABASE_INTEGRATION)('PostgreSQL administrative authentication', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp({ authRuntime: runtime() })
  })

  afterEach(async () => {
    await cleanupExactRecords()
  })

  afterAll(async () => {
    const leftovers = await getPrisma().adminUser.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    })
    for (const { id } of leftovers) trackedUserIds.add(id)
    await cleanupExactRecords()
    console.log(
      `DATABASE_INTEGRATION_SUMMARY usersCreated=${usersCreated} sessionsObserved=${sessionsObserved} remainingUsers=0 remainingSessions=0`,
    )
    await disconnectPrisma()
  })

  it('persists Argon2id credentials and performs normalized login without exposing tokens', async () => {
    const user = await createAdmin('login')
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    await expect(verifyPassword(user.passwordHash, CURRENT_PASSWORD)).resolves.toBe(true)

    const response = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: `  ${user.email.toUpperCase()}  `, password: CURRENT_PASSWORD }),
    )
    const body = await response.json()
    const cookies = getSetCookies(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: 'ADMIN',
        },
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/password|token|hash/i)
    expect(getCookieValue(cookies, ACCESS_COOKIE_NAME)).toBeTruthy()
    const refreshToken = getCookieValue(cookies, REFRESH_COOKIE_NAME)!
    const persisted = await getPrisma().refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    })
    expect(persisted?.userId).toBe(user.id)
    expect(persisted?.revokedAt).toBeNull()
  })

  it('returns the same standardized 401 for wrong credentials and inactive administrators', async () => {
    const active = await createAdmin('wrong-password')
    const inactive = await createAdmin('inactive', { isActive: false })
    const responses = [
      await app.request(
        '/api/v1/auth/login',
        jsonRequest({ email: active.email, password: 'IncorrectPassword123' }),
      ),
      await app.request(
        '/api/v1/auth/login',
        jsonRequest({ email: inactive.email, password: CURRENT_PASSWORD }),
      ),
    ]

    for (const response of responses) {
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
          details: {},
        },
      })
    }
  })

  it('issues a 15-minute JWT, returns the current user, and rejects expired access tokens', async () => {
    const user = await createAdmin('jwt')
    const login = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    const accessToken = getCookieValue(getSetCookies(login), ACCESS_COOKIE_NAME)!
    const claims = decodeJwt(accessToken)
    expect(claims.exp! - claims.iat!).toBe(900)

    const current = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, accessToken]) },
    })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({
      success: true,
      data: { user: { id: user.id, role: 'ADMIN' } },
    })

    const now = Math.floor(Date.now() / 1000)
    const expired = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(now - 1000)
      .setExpirationTime(now - 1)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
    const rejected = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, expired]) },
    })
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    })
  })

  it('rotates a persisted refresh session and rejects replay and expired sessions', async () => {
    const user = await createAdmin('rotation')
    const login = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    const original = getCookieValue(getSetCookies(login), REFRESH_COOKIE_NAME)!
    const rotated = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, original]),
      },
    })
    const replacement = getCookieValue(getSetCookies(rotated), REFRESH_COOKIE_NAME)!
    expect(rotated.status).toBe(200)
    expect(replacement).not.toBe(original)
    await expect(
      getPrisma().refreshSession.findUnique({
        where: { tokenHash: hashRefreshToken(original) },
      }),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) })
    await expect(
      getPrisma().refreshSession.findUnique({
        where: { tokenHash: hashRefreshToken(replacement) },
      }),
    ).resolves.toMatchObject({ userId: user.id, revokedAt: null })

    const replay = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, original]),
      },
    })
    expect(replay.status).toBe(401)

    const expiredToken = randomBytes(32).toString('base64url')
    await getPrisma().refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(expiredToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
    })
    const expired = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, expiredToken]),
      },
    })
    expect(expired.status).toBe(401)
  }, 20_000)

  it('allows only one concurrent consumption of the same refresh credential', async () => {
    const user = await createAdmin('concurrent')
    const login = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    const refreshToken = getCookieValue(getSetCookies(login), REFRESH_COOKIE_NAME)!
    const refresh = () =>
      app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader([REFRESH_COOKIE_NAME, refreshToken]),
        },
      })
    const responses = await Promise.all([refresh(), refresh()])
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401])
    expect(
      await getPrisma().refreshSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(1)
  })

  it('revokes logout sessions even when the access token is expired and clears cookies', async () => {
    const user = await createAdmin('logout')
    const login = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    const refreshToken = getCookieValue(getSetCookies(login), REFRESH_COOKIE_NAME)!
    const now = Math.floor(Date.now() / 1000)
    const expiredAccess = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(now - 1000)
      .setExpirationTime(now - 1)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
    const logout = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader(
          [ACCESS_COOKIE_NAME, expiredAccess],
          [REFRESH_COOKIE_NAME, refreshToken],
        ),
      },
    })
    expect(logout.status).toBe(200)
    const clearingCookies = getSetCookies(logout)
    expect(clearingCookies).toHaveLength(2)
    for (const cookie of clearingCookies) expect(cookie).toMatch(/Max-Age=0/i)
    await expect(
      getPrisma().refreshSession.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
      }),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) })
  })

  it('changes the password, revokes existing sessions, and requires fresh credentials', async () => {
    const user = await createAdmin('password-change')
    const login = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    const cookies = getSetCookies(login)
    const accessToken = getCookieValue(cookies, ACCESS_COOKIE_NAME)!
    const refreshToken = getCookieValue(cookies, REFRESH_COOKIE_NAME)!
    const changed = await app.request(
      '/api/v1/auth/change-password',
      jsonRequest(
        { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
        cookieHeader([ACCESS_COOKIE_NAME, accessToken]),
      ),
    )
    expect(changed.status).toBe(200)
    expect(getSetCookies(changed)).toHaveLength(2)
    const updated = await getPrisma().adminUser.findUniqueOrThrow({
      where: { id: user.id },
    })
    await expect(verifyPassword(updated.passwordHash, NEW_PASSWORD)).resolves.toBe(true)
    expect(
      await getPrisma().refreshSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0)

    const oldRefresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, refreshToken]),
      },
    })
    expect(oldRefresh.status).toBe(401)
    const oldLogin = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    expect(oldLogin.status).toBe(401)
    const freshLogin = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: NEW_PASSWORD }),
    )
    expect(freshLogin.status).toBe(200)
  })

  it('enforces ADMIN and SUPER_ADMIN authorization with standardized 401 and 403 errors', async () => {
    const admin = await createAdmin('admin-role')
    const superAdmin = await createAdmin('super-role', { role: 'SUPER_ADMIN' })
    const adminLogin = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: admin.email, password: CURRENT_PASSWORD }),
    )
    const superLogin = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: superAdmin.email, password: CURRENT_PASSWORD }),
    )
    const adminAccess = getCookieValue(getSetCookies(adminLogin), ACCESS_COOKIE_NAME)!
    const superAccess = getCookieValue(getSetCookies(superLogin), ACCESS_COOKIE_NAME)!

    const roles = new Hono<AuthEnv>()
    roles.use('*', requireAuthentication(runtime()))
    roles.get('/admin', requireRole('ADMIN', 'SUPER_ADMIN'), (c) => c.json({ ok: true }))
    roles.get('/super', requireRole('SUPER_ADMIN'), (c) => c.json({ ok: true }))

    expect(
      (
        await roles.request('/admin', {
          headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, adminAccess]) },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await roles.request('/super', {
          headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, superAccess]) },
        })
      ).status,
    ).toBe(200)
    const forbidden = await roles.request('/super', {
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, adminAccess]) },
    })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    })
    const unauthorized = await roles.request('/admin')
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    })
  })

  it('enforces production cookie, CORS, and CSRF protections with the PostgreSQL runtime', async () => {
    const user = await createAdmin('browser-security')
    const secureApp = createApp({ authRuntime: runtime(true) })
    const login = await secureApp.request(
      '/api/v1/auth/login',
      jsonRequest({ email: user.email, password: CURRENT_PASSWORD }),
    )
    expect(login.status).toBe(200)
    expect(login.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(login.headers.get('access-control-allow-credentials')).toBe('true')
    for (const cookie of getSetCookies(login)) {
      expect(cookie).toMatch(/; HttpOnly;/i)
      expect(cookie).toMatch(/; Secure;/i)
      expect(cookie).toMatch(/; SameSite=Lax$/i)
      expect(cookie).not.toMatch(/; Domain=/i)
    }

    const rejected = await secureApp.request(
      '/api/v1/auth/login',
      jsonRequest(
        { email: user.email, password: CURRENT_PASSWORD },
        undefined,
        DISALLOWED_ORIGIN,
      ),
    )
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    await expect(rejected.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED' },
    })

    const preflight = await secureApp.request('/api/v1/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true')
  })
})
