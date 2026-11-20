import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getCookie } from 'hono/cookie'

import { ApiError, successResponse } from '../shared/http.js'
import { clearAuthCookies, setAuthCookies } from './cookies.js'
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './constants.js'
import { requireAuthentication, requireRole } from './middleware.js'
import type { AuthRuntime } from './runtime.js'
import {
  authErrorResponses,
  authUserResponseSchema,
  changePasswordRequestSchema,
  emptySuccessResponseSchema,
  loginRequestSchema,
  adminAccountIdParamSchema,
  passwordRecoveryAcceptedResponseSchema,
  passwordRecoveryRequestResponseSchema,
  passwordRecoveryRequestSchema,
  passwordRecoveryResetSchema,
  passwordRecoveryVerificationResponseSchema,
  passwordRecoveryVerificationSchema,
  profileNameUpdateSchema,
} from './schemas.js'
import { authCors, requireTrustedOrigin } from './security.js'
import type { AuthEnv } from './types.js'

const cookieHeaders = {
  'Set-Cookie': {
    description: 'HttpOnly authentication cookies. Tokens are never returned in JSON.',
    schema: { type: 'string' as const },
  },
}

const userResponseExample = {
  success: true,
  data: {
    user: {
      id: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20',
      name: 'Admin Name',
      email: 'admin@example.invalid',
      role: 'ADMIN',
    },
  },
}

const emptyResponseExample = { success: true, data: {} }
const passwordRecoveryAcceptedExample = {
  success: true,
  data: { message: 'If the account is eligible, recovery instructions have been sent.' },
}
const passwordRecoveryRequestExample = {
  success: true,
  data: {
    message: 'If the account is eligible, recovery instructions have been sent.',
    challengeId: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20',
  },
}

const clientIdentifier = (request: Request) => {
  // Vercel overwrites its forwarded-IP headers before invoking a Function.
  // Outside that managed boundary, browser-controlled forwarding headers are
  // deliberately ignored rather than becoming attacker-selected rate buckets.
  if (process.env.VERCEL === '1') {
    return request.headers.get('x-vercel-forwarded-for')?.trim()
      || request.headers.get('x-forwarded-for')?.trim()
      || 'vercel-client-unavailable'
  }
  return 'untrusted-client'
}

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Authentication'],
  summary: 'Authenticate an administrator',
  description: 'Validates an active administrator and sets host-only HttpOnly access and refresh cookies. Authentication credentials are never returned in JSON.',
  request: {
    body: {
      required: true,
      content: { 'application/json': {
        schema: loginRequestSchema,
        example: { email: 'admin@example.invalid', password: 'ExamplePassword123' },
      } },
    },
  },
  responses: {
    200: {
      description: 'Authentication succeeded.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: authUserResponseSchema, example: userResponseExample } },
    },
    ...authErrorResponses,
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Authentication'],
  summary: 'Rotate the refresh session',
  description: 'Consumes the current rotating refresh cookie, issues replacement access and refresh cookies, and returns the active administrator. Reused, expired, revoked, or inactive-account sessions are rejected.',
  security: [{ refreshCookie: [] }],
  responses: {
    200: {
      description: 'The refresh credential was rotated.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: authUserResponseSchema, example: userResponseExample } },
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
  description: 'Revokes the supplied refresh session when present and clears both authentication cookies. The endpoint remains safe when no refresh cookie is present.',
  security: [{}, { refreshCookie: [] }],
  responses: {
    200: {
      description: 'Authentication cookies were cleared.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: emptySuccessResponseSchema, example: emptyResponseExample } },
    },
    403: authErrorResponses[403],
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Authentication'],
  summary: 'Get the current administrator',
  description: 'Returns the administrator represented by a valid access cookie. The access JWT has a 15-minute lifetime.',
  security: [{ accessCookie: [] }],
  responses: {
    200: {
      description: 'Current administrator profile.',
      content: { 'application/json': { schema: authUserResponseSchema, example: userResponseExample } },
    },
    401: authErrorResponses[401],
  },
})

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['Authentication'],
  summary: 'Change the current administrator password',
  description: 'Validates the current password, atomically increments the account security version, revokes refresh sessions, clears authentication cookies, immediately invalidates prior access JWTs, and requires a new login.',
  security: [{ accessCookie: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': {
        schema: changePasswordRequestSchema,
        example: { currentPassword: 'CurrentPassword123', newPassword: 'ChangedPassword456' },
      } },
    },
  },
  responses: {
    200: {
      description: 'Password changed, prior access JWTs and refresh sessions revoked, and cookies cleared.',
      headers: cookieHeaders,
      content: { 'application/json': { schema: emptySuccessResponseSchema, example: emptyResponseExample } },
    },
    ...authErrorResponses,
  },
})

const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Authentication'],
  summary: 'Update the current administrator profile name',
  description: 'Updates only the authenticated active administrator\'s display name. Role, email, activation state, password, and all other account fields are rejected.',
  security: [{ accessCookie: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': {
        schema: profileNameUpdateSchema,
        example: { name: 'Admin Name' },
      } },
    },
  },
  responses: {
    200: {
      description: 'Current administrator profile updated.',
      content: { 'application/json': { schema: authUserResponseSchema, example: userResponseExample } },
    },
    ...authErrorResponses,
  },
})

const passwordRecoveryRequestRoute = createRoute({
  method: 'post',
  path: '/password-recovery/request',
  tags: ['Authentication'],
  summary: 'Request administrator password recovery',
  description: 'Accepts an administrator email and always returns the same acknowledgement shape for eligible, unknown, inactive, cooldown-limited, and rate-limited accounts. It includes a fresh opaque challenge UUID for the next verification request; that UUID is durable only when an eligible account receives a code. When eligible, a six-digit code is sent only to the account’s registered email. No code is returned by this API.',
  request: { body: { required: true, content: { 'application/json': {
    schema: passwordRecoveryRequestSchema,
    example: { email: 'admin@example.invalid' },
  } } } },
  responses: {
    202: { description: 'Generic recovery-request acceptance.', content: { 'application/json': { schema: passwordRecoveryRequestResponseSchema, example: passwordRecoveryRequestExample } } },
    400: authErrorResponses[400], 403: authErrorResponses[403], 415: authErrorResponses[415],
  },
})

const passwordRecoveryVerifyRoute = createRoute({
  method: 'post',
  path: '/password-recovery/verify',
  tags: ['Authentication'],
  summary: 'Verify a password recovery code',
  description: 'Verifies a non-expired six-digit recovery code with durable attempt limits. On success, returns a short-lived single-use authorization required only by the reset endpoint.',
  request: { body: { required: true, content: { 'application/json': {
    schema: passwordRecoveryVerificationSchema,
    example: { challengeId: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20', otp: '123456' },
  } } } },
  responses: {
    200: { description: 'Recovery code verified.', content: { 'application/json': { schema: passwordRecoveryVerificationResponseSchema, example: { success: true, data: { resetAuthorization: 'opaque-single-use-authorization' } } } } },
    400: authErrorResponses[400], 403: authErrorResponses[403], 415: authErrorResponses[415],
  },
})

const passwordRecoveryResetRoute = createRoute({
  method: 'post',
  path: '/password-recovery/reset',
  tags: ['Authentication'],
  summary: 'Reset an administrator password after recovery verification',
  description: 'Consumes the short-lived recovery authorization exactly once, applies the normal password policy, atomically replaces the password through the shared session-revocation primitive, invalidates all outstanding recovery authorizations, and requires fresh login.',
  request: { body: { required: true, content: { 'application/json': {
    schema: passwordRecoveryResetSchema,
    example: { challengeId: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20', resetAuthorization: 'opaque-single-use-authorization', newPassword: 'ChangedPassword456' },
  } } } },
  responses: {
    200: { description: 'Password reset and prior sessions revoked.', content: { 'application/json': { schema: emptySuccessResponseSchema, example: emptyResponseExample } } },
    400: authErrorResponses[400], 403: authErrorResponses[403], 415: authErrorResponses[415],
  },
})

const adminPasswordRecoveryRoute = createRoute({
  method: 'post',
  path: '/admin/users/{id}/password-recovery',
  tags: ['Admin — Account Management'],
  summary: 'Initiate password recovery for an administrator',
  description: 'SUPER_ADMIN only. Sends recovery instructions only to the target account’s current registered email. The initiator never receives an OTP, reset authorization, password choice, or email content. The initiation is audited without secrets.',
  security: [{ accessCookie: [] }],
  request: { params: adminAccountIdParamSchema },
  responses: {
    202: { description: 'Recovery initiation accepted.', content: { 'application/json': { schema: passwordRecoveryAcceptedResponseSchema, example: passwordRecoveryAcceptedExample } } },
    401: authErrorResponses[401], 403: authErrorResponses[403], 404: authErrorResponses[404],
  },
})

export const createAuthRoutes = (runtime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerComponent('securitySchemes', 'accessCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: ACCESS_COOKIE_NAME,
    description: 'Signed JWT access credential with a 15-minute lifetime and account security version; prior versions are rejected after a password change or deactivation.',
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
  routes.use('/admin/users/:id/password-recovery', requireAuthentication(runtime))
  routes.use('/admin/users/:id/password-recovery', requireRole('SUPER_ADMIN'))

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

  routes.openapi(updateProfileRoute, async (c) => {
    const input = c.req.valid('json')
    const user = await runtime.getService().updateProfileName(
      c.get('authClaims').userId,
      input.name,
    )
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

  routes.openapi(passwordRecoveryRequestRoute, async (c) => {
    const input = c.req.valid('json')
    const result = await runtime.getService().requestPasswordRecovery(input.email, clientIdentifier(c.req.raw))
    return c.json(successResponse({ ...passwordRecoveryAcceptedExample.data, ...result }), 202)
  })

  routes.openapi(passwordRecoveryVerifyRoute, async (c) => {
    const input = c.req.valid('json')
    const result = await runtime.getService().verifyPasswordRecovery(input.challengeId, input.otp)
    return c.json(successResponse(result), 200)
  })

  routes.openapi(passwordRecoveryResetRoute, async (c) => {
    const input = c.req.valid('json')
    await runtime.getService().resetPasswordWithRecovery(
      input.challengeId,
      input.resetAuthorization,
      input.newPassword,
    )
    clearAuthCookies(c, runtime.getConfig())
    return c.json(successResponse({}), 200)
  })

  routes.openapi(adminPasswordRecoveryRoute, async (c) => {
    const params = c.req.valid('param')
    await runtime.getService().initiatePasswordRecoveryForAdmin(
      c.get('authClaims').userId,
      params.id,
      clientIdentifier(c.req.raw),
    )
    return c.json(successResponse(passwordRecoveryAcceptedExample.data), 202)
  })

  return routes
}
