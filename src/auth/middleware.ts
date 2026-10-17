import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { errorResponse } from '../shared/http.js'
import { ACCESS_COOKIE_NAME } from './constants.js'
import type { AuthRuntime } from './runtime.js'
import type { AdminRole, AuthEnv } from './types.js'

export const requireAuthentication = (
  runtime: AuthRuntime,
): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const accessToken = getCookie(c, ACCESS_COOKIE_NAME)
  if (!accessToken) {
    return errorResponse(
      c,
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.',
    )
  }

  try {
    c.set('authClaims', await runtime.getService().verifyAccessToken(accessToken))
  } catch {
    return errorResponse(
      c,
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.',
    )
  }

  await next()
}

export const requireRole = (...roles: AdminRole[]): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const claims = c.get('authClaims')
    if (!claims) {
      return errorResponse(
        c,
        401,
        'AUTHENTICATION_REQUIRED',
        'Authentication is required.',
      )
    }

    if (!roles.includes(claims.role)) {
      return errorResponse(c, 403, 'FORBIDDEN', 'Insufficient permissions.')
    }

    await next()
  }
