import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

import type { AuthConfig } from '../config/env.js'
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_SECONDS,
} from './constants.js'
import type { IssuedCredentials } from './types.js'

const cookieSecurity = (config: AuthConfig) => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'Lax' as const,
})

export const setAuthCookies = (
  c: Context,
  credentials: Pick<IssuedCredentials, 'accessToken' | 'refreshToken'>,
  config: AuthConfig,
) => {
  const now = Date.now()
  setCookie(c, ACCESS_COOKIE_NAME, credentials.accessToken, {
    ...cookieSecurity(config),
    path: '/api/v1',
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
    expires: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
  })
  setCookie(c, REFRESH_COOKIE_NAME, credentials.refreshToken, {
    ...cookieSecurity(config),
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
    expires: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
  })
}

export const clearAuthCookies = (c: Context, config: AuthConfig) => {
  deleteCookie(c, ACCESS_COOKIE_NAME, {
    ...cookieSecurity(config),
    path: '/api/v1',
  })
  deleteCookie(c, REFRESH_COOKIE_NAME, {
    ...cookieSecurity(config),
    path: '/api/v1/auth',
  })
}
