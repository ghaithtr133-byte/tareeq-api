import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getCookie } from 'hono/cookie'

import { ApiError, successResponse } from '../shared/http.js'
import { clearAuthCookies, setAuthCookies } from './cookies.js'
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './constants.js'
import { requireAuthentication } from './middleware.js'
import type { AuthRuntime } from './runtime.js'
import {
  authErrorResponses,
  authUserResponseSchema,
  changePasswordRequestSchema,
  emptySuccessResponseSchema,
  loginRequestSchema,
} from './schemas.js'
import { authCors, requireTrustedOrigin } from './security.js'
import type { AuthEnv } from './types.js'

const cookieHeaders = {
  'Set-Cookie': {
    description: 'HttpOnly authentication cookies. Tokens are never returned in JSON.',
    schema: { type: 'string' as const },
  },
}

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Authentication'],
  summary: 'Authenticate an administrator',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: loginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Authentication succeeded.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: authUserResponseSchema } },
    },
    ...authErrorResponses,
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Authentication'],
  summary: 'Rotate the refresh session',
  security: [{ refreshCookie: [] }],
  responses: {
    200: {
      description: 'The refresh credential was rotated.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: authUserResponseSchema } },
    },
    401: authErrorResponses[401],
    403: authErrorResponses[403],
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Authentication'],
  summary: 'Revoke the current refresh session',
  security: [{}, { refreshCookie: [] }],
  responses: {
    200: {
      description: 'Authentication cookies were cleared.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: emptySuccessResponseSchema } },
    },
    403: authErrorResponses[403],
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Authentication'],
  summary: 'Get the current administrator',
  security: [{ accessCookie: [] }],
  responses: {
    200: {
      description: 'Current administrator profile.',
      content: { 'application/json': { schema: authUserResponseSchema } },
    },
    401: authErrorResponses[401],
  },
})

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['Authentication'],
  summary: 'Change the current administrator password',
  security: [{ accessCookie: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: changePasswordRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Password changed, sessions revoked, and cookies cleared.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: emptySuccessResponseSchema } },
    },
    ...authErrorResponses,
  },
})

export const createAuthRoutes = (runtime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerComponent('securitySchemes', 'accessCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: ACCESS_COOKIE_NAME,
    description: 'Signed JWT access credential with a 15-minute lifetime.',
  })
  routes.openAPIRegistry.registerComponent('securitySchemes', 'refreshCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: REFRESH_COOKIE_NAME,
    description: 'Opaque rotating refresh credential with a 7-day lifetime.',
  })

  routes.use('*', authCors(runtime))
  routes.use('*', requireTrustedOrigin(runtime))
  routes.use('/me', requireAuthentication(runtime))
  routes.use('/change-password', requireAuthentication(runtime))

  routes.openapi(loginRoute, async (c) => {
    const input = c.req.valid('json')
    const credentials = await runtime.getService().login(input.email, input.password)
    setAuthCookies(c, credentials, runtime.getConfig())
    return c.json(successResponse({ user: credentials.user }), 200)
  })

  routes.openapi(refreshRoute, async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME)
    if (!refreshToken) {
      throw new ApiError(401, 'INVALID_REFRESH_SESSION', 'Authentication is required.')
    }

    try {
      const credentials = await runtime.getService().refresh(refreshToken)
      setAuthCookies(c, credentials, runtime.getConfig())
      return c.json(successResponse({ user: credentials.user }), 200)
    } catch (error) {
      clearAuthCookies(c, runtime.getConfig())
      throw error
    }
  })

  routes.openapi(logoutRoute, async (c) => {
    await runtime.getService().logout(getCookie(c, REFRESH_COOKIE_NAME))
    clearAuthCookies(c, runtime.getConfig())
    return c.json(successResponse({}), 200)
  })

  routes.openapi(meRoute, async (c) => {
    const user = await runtime.getService().getCurrentUser(c.get('authClaims').userId)
    return c.json(successResponse({ user }), 200)
  })

  routes.openapi(changePasswordRoute, async (c) => {
    const input = c.req.valid('json')
    await runtime
      .getService()
      .changePassword(
        c.get('authClaims').userId,
        input.currentPassword,
        input.newPassword,
      )
    clearAuthCookies(c, runtime.getConfig())
    return c.json(successResponse({}), 200)
  })

  return routes
}
