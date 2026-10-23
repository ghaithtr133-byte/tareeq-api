import { SignJWT } from 'jose'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'

import { createApp } from '../src/app.js'
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  REFRESH_COOKIE_NAME,
} from '../src/auth/constants.js'
import { hashPassword, hashRefreshToken, signAccessToken } from '../src/auth/crypto.js'
import { requireAuthentication, requireRole } from '../src/auth/middleware.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AuthEnv } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'

const ORIGIN = 'https://admin.tareeq-academy.com'
const PUBLIC_ORIGIN = 'https://tareeq-academy.com'
const JWT_SECRET = 'test-only-secret-that-is-at-least-thirty-two-characters-long'
const USER_ID = 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20'
const CURRENT_PASSWORD = 'CurrentPassword123'
const NEW_PASSWORD = 'ChangedPassword456'

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ORIGIN],
  publicAllowedOrigins: [PUBLIC_ORIGIN],
  isProduction: false,
}

const publicUser = {
  id: USER_ID,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
}

const getSetCookies = (response: Response) => response.headers.getSetCookie()

const getCookieValue = (cookies: string[], name: string) => {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`))
  return cookie?.slice(name.length + 1).split(';', 1)[0]
}

const cookieHeader = (...values: Array<[string, string | undefined]>) =>
  values
    .filter((value): value is [string, string] => typeof value[1] === 'string')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

const jsonRequest = (body: unknown, cookie?: string) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: JSON.stringify(body),
})

describe('administrative authentication', () => {
  let passwordHash: string
  let repository: InMemoryAuthRepository
  let service: AuthService
  let runtime: AuthRuntime
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    passwordHash = await hashPassword(CURRENT_PASSWORD)
  })

  beforeEach(() => {
    repository = new InMemoryAuthRepository()
    repository.addUser({
      ...publicUser,
      passwordHash,
      isActive: true,
    })
    service = new AuthService(repository, JWT_SECRET)
    runtime = {
      getConfig: () => config,
      getService: () => service,
    }
    app = createApp({ authRuntime: runtime })
  })

  const login = async (email = '  ADMIN@EXAMPLE.COM  ', password = CURRENT_PASSWORD) =>
    app.request('/api/v1/auth/login', jsonRequest({ email, password }))

  it('logs in with a normalized email and sets HttpOnly credentials without exposing secrets', async () => {
    const response = await login()
    const body = await response.json()
    const cookies = getSetCookies(response)
    const accessToken = getCookieValue(cookies, ACCESS_COOKIE_NAME)
    const refreshToken = getCookieValue(cookies, REFRESH_COOKIE_NAME)

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, data: { user: publicUser } })
    expect(JSON.stringify(body)).not.toMatch(/password|token|hash/i)
    expect(accessToken).toBeTruthy()
    expect(refreshToken).toBeTruthy()
    const accessCookie = cookies.find((cookie) => cookie.startsWith('tareeq_access='))!
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('tareeq_refresh='))!
    expect(accessCookie).toMatch(/; Max-Age=900;/i)
    expect(accessCookie).toMatch(/; Path=\/api\/v1;/i)
    expect(accessCookie).toMatch(/; HttpOnly;/i)
    expect(accessCookie).toMatch(/; SameSite=Lax$/i)
    expect(refreshCookie).toMatch(/; Max-Age=604800;/i)
    expect(refreshCookie).toMatch(/; Path=\/api\/v1\/auth;/i)
    expect(refreshCookie).toMatch(/; HttpOnly;/i)
    expect(refreshCookie).toMatch(/; SameSite=Lax$/i)
    await expect(service.verifyAccessToken(accessToken!)).resolves.toEqual({
      userId: USER_ID,
      role: 'ADMIN',
    })
    expect(repository.getActiveSessionCount(USER_ID)).toBe(1)
  })

  it('returns the same safe failure for unknown credentials, wrong passwords, and inactive users', async () => {
    const unknown = await login('unknown@example.com')
    const incorrect = await login('admin@example.com', 'wrong-password')
    repository.setUserActive(USER_ID, false)
    const inactive = await login()

    for (const response of [unknown, incorrect, inactive]) {
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

  it('validates login and strong-password request bodies', async () => {
    const invalidLogin = await app.request(
      '/api/v1/auth/login',
      jsonRequest({ email: 'not-an-email', password: '' }),
    )
    expect(invalidLogin.status).toBe(400)

    const loginResponse = await login()
    const accessToken = getCookieValue(getSetCookies(loginResponse), ACCESS_COOKIE_NAME)
    const weakPassword = await app.request(
      '/api/v1/auth/change-password',
      jsonRequest(
        { currentPassword: CURRENT_PASSWORD, newPassword: 'weak' },
        cookieHeader([ACCESS_COOKIE_NAME, accessToken]),
      ),
    )
    expect(weakPassword.status).toBe(400)

    const missingContentType = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: JSON.stringify({ email: 'admin@example.com', password: CURRENT_PASSWORD }),
    })
    expect(missingContentType.status).toBe(415)
    await expect(missingContentType.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE' },
    })
  })

  it('returns the current active administrator and rejects missing or expired access tokens', async () => {
    const loginResponse = await login()
    const accessToken = getCookieValue(getSetCookies(loginResponse), ACCESS_COOKIE_NAME)
    const current = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, accessToken]) },
    })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toEqual({
      success: true,
      data: { user: publicUser },
    })

    const missing = await app.request('/api/v1/auth/me')
    expect(missing.status).toBe(401)

    const now = Math.floor(Date.now() / 1000)
    const expired = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(now - 1000)
      .setExpirationTime(now - 1)
      .sign(new TextEncoder().encode(JWT_SECRET))
    const expiredResponse = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, expired]) },
    })
    expect(expiredResponse.status).toBe(401)
  })

  it('rotates refresh credentials and rejects reuse of the consumed credential', async () => {
    const loginResponse = await login()
    const original = getCookieValue(getSetCookies(loginResponse), REFRESH_COOKIE_NAME)!
    const refreshed = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, original]),
      },
    })
    const replacement = getCookieValue(getSetCookies(refreshed), REFRESH_COOKIE_NAME)

    expect(refreshed.status).toBe(200)
    expect(replacement).toBeTruthy()
    expect(replacement).not.toBe(original)
    expect(repository.getSession(hashRefreshToken(original))?.revokedAt).toBeInstanceOf(Date)
    expect(repository.getActiveSessionCount(USER_ID)).toBe(1)

    const replay = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, original]),
      },
    })
    expect(replay.status).toBe(401)
  })

  it('allows only one concurrent refresh to consume a session', async () => {
    const loginResponse = await login()
    const original = getCookieValue(getSetCookies(loginResponse), REFRESH_COOKIE_NAME)!
    const request = () =>
      app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader([REFRESH_COOKIE_NAME, original]),
        },
      })
    const responses = await Promise.all([request(), request()])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
    expect(repository.getActiveSessionCount(USER_ID)).toBe(1)
  })

  it('rejects missing, invalid, expired, and inactive-account refresh sessions', async () => {
    const missing = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { Origin: ORIGIN },
    })
    const invalid = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, 'invalid-token']),
      },
    })

    const expiredToken = 'expired-refresh-token'
    repository.seedSession({
      userId: USER_ID,
      tokenHash: hashRefreshToken(expiredToken),
      expiresAt: new Date(Date.now() - 1000),
    })
    const expired = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, expiredToken]),
      },
    })

    const loginResponse = await login()
    const activeToken = getCookieValue(getSetCookies(loginResponse), REFRESH_COOKIE_NAME)
    repository.setUserActive(USER_ID, false)
    const inactive = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, activeToken]),
      },
    })

    for (const response of [missing, invalid, expired, inactive]) {
      expect(response.status).toBe(401)
    }
  })

  it('logs out through the refresh session even without a valid access token', async () => {
    const loginResponse = await login()
    const refreshToken = getCookieValue(getSetCookies(loginResponse), REFRESH_COOKIE_NAME)!
    const response = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader(
          [ACCESS_COOKIE_NAME, 'expired-or-invalid'],
          [REFRESH_COOKIE_NAME, refreshToken],
        ),
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: {} })
    expect(repository.getSession(hashRefreshToken(refreshToken))?.revokedAt).toBeInstanceOf(Date)
    expect(getSetCookies(response)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^tareeq_access=;.*Max-Age=0.*Path=\/api\/v1/i),
        expect.stringMatching(/^tareeq_refresh=;.*Max-Age=0.*Path=\/api\/v1\/auth/i),
      ]),
    )

    const alreadyLoggedOut = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Origin: ORIGIN },
    })
    expect(alreadyLoggedOut.status).toBe(200)
  })

  it('changes the password, revokes all refresh sessions, clears cookies, and requires a fresh login', async () => {
    const firstLogin = await login()
    const firstCookies = getSetCookies(firstLogin)
    const accessToken = getCookieValue(firstCookies, ACCESS_COOKIE_NAME)
    const refreshToken = getCookieValue(firstCookies, REFRESH_COOKIE_NAME)!
    await login()
    expect(repository.getActiveSessionCount(USER_ID)).toBe(2)

    const changed = await app.request(
      '/api/v1/auth/change-password',
      jsonRequest(
        { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
        cookieHeader([ACCESS_COOKIE_NAME, accessToken]),
      ),
    )

    expect(changed.status).toBe(200)
    expect(repository.getActiveSessionCount(USER_ID)).toBe(0)
    expect(getSetCookies(changed)).toHaveLength(2)

    const revokedRefresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader([REFRESH_COOKIE_NAME, refreshToken]),
      },
    })
    expect(revokedRefresh.status).toBe(401)
    expect((await login()).status).toBe(401)
    expect((await login('admin@example.com', NEW_PASSWORD)).status).toBe(200)
  })

  it('rejects an incorrect current password without revoking the active session', async () => {
    const loginResponse = await login()
    const cookies = getSetCookies(loginResponse)
    const accessToken = getCookieValue(cookies, ACCESS_COOKIE_NAME)
    const response = await app.request(
      '/api/v1/auth/change-password',
      jsonRequest(
        { currentPassword: 'IncorrectPassword123', newPassword: NEW_PASSWORD },
        cookieHeader([ACCESS_COOKIE_NAME, accessToken]),
      ),
    )

    expect(response.status).toBe(401)
    expect(repository.getActiveSessionCount(USER_ID)).toBe(1)
  })

  it('enforces trusted origins, credentialed CORS, and preflight handling', async () => {
    const allowed = await login()
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')

    const actuallyMissing = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: CURRENT_PASSWORD }),
    })
    expect(actuallyMissing.status).toBe(403)

    const disallowed = await app.request('/api/v1/auth/login', {
      ...jsonRequest({ email: 'admin@example.com', password: CURRENT_PASSWORD }),
      headers: {
        'Content-Type': 'application/json',
        Origin: PUBLIC_ORIGIN,
      },
    })
    expect(disallowed.status).toBe(403)
    expect(disallowed.headers.get('access-control-allow-origin')).toBeNull()

    const preflight = await app.request('/api/v1/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('marks both cookies Secure in production without setting a Domain attribute', async () => {
    const productionConfig = { ...config, isProduction: true }
    runtime = { getConfig: () => productionConfig, getService: () => service }
    app = createApp({ authRuntime: runtime })

    const response = await login()
    const cookies = getSetCookies(response)
    expect(cookies).toHaveLength(2)
    for (const cookie of cookies) {
      expect(cookie).toMatch(/; Secure;/i)
      expect(cookie).not.toMatch(/; Domain=/i)
      expect(cookie).toMatch(/; Expires=/i)
    }
  })

  it('enforces ADMIN/SUPER_ADMIN and SUPER_ADMIN-only middleware without database lookups', async () => {
    const roleApp = new Hono<AuthEnv>()
    roleApp.use('/admin', requireAuthentication(runtime), requireRole('ADMIN', 'SUPER_ADMIN'))
    roleApp.use('/super', requireAuthentication(runtime), requireRole('SUPER_ADMIN'))
    roleApp.get('/admin', (c) => c.json({ role: c.get('authClaims').role }))
    roleApp.get('/super', (c) => c.json({ role: c.get('authClaims').role }))

    const adminToken = await signAccessToken(
      { id: USER_ID, role: 'ADMIN' },
      JWT_SECRET,
    )
    const superToken = await signAccessToken(
      { id: USER_ID, role: 'SUPER_ADMIN' },
      JWT_SECRET,
    )
    const withToken = (token: string) => ({
      headers: { Cookie: cookieHeader([ACCESS_COOKIE_NAME, token]) },
    })

    expect((await roleApp.request('/admin')).status).toBe(401)
    expect((await roleApp.request('/admin', withToken(adminToken))).status).toBe(200)
    expect((await roleApp.request('/super', withToken(adminToken))).status).toBe(403)
    expect((await roleApp.request('/super', withToken(superToken))).status).toBe(200)
  })

  it('documents all authentication operations and both cookie security schemes', async () => {
    const response = await app.request('/openapi.json')
    const document = (await response.json()) as {
      paths: Record<string, unknown>
      components: { securitySchemes: Record<string, unknown> }
    }

    expect(response.status).toBe(200)
    for (const path of [
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/auth/change-password',
    ]) {
      expect(document.paths[path]).toBeDefined()
    }
    expect(document.components.securitySchemes.accessCookie).toBeDefined()
    expect(document.components.securitySchemes.refreshCookie).toBeDefined()
  })
})
