import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

import { errorResponse } from '../shared/http.js'
import type { AuthRuntime } from './runtime.js'
import type { AuthEnv } from './types.js'

const isAllowedOrigin = (
  origin: string,
  requestUrl: string,
  allowedOrigins: string[],
) => origin === new URL(requestUrl).origin || allowedOrigins.includes(origin)

export const authCors = (runtime: AuthRuntime): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const middleware = cors({
      origin: (origin) =>
        isAllowedOrigin(origin, c.req.url, runtime.getConfig().allowedOrigins)
          ? origin
          : '',
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      credentials: true,
      maxAge: 600,
    })
    return middleware(c, next)
  }

export const publicReadCors = (
  runtime: AuthRuntime,
): MiddlewareHandler<AuthEnv> => async (c, next) => {
  if (
    !c.req.header('Origin') ||
    (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS')
  ) {
    await next()
    return
  }

  const middleware = cors({
    origin: (origin) =>
      runtime.getConfig().publicAllowedOrigins.includes(origin) ? origin : '',
    allowMethods: ['GET', 'HEAD', 'OPTIONS'],
    maxAge: 600,
  })
  return middleware(c, next)
}

export const publicSubmissionCors = (
  runtime: AuthRuntime,
): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const origin = c.req.header('Origin')
  if (!origin) {
    await next()
    return
  }

  const allowed = runtime.getConfig().publicAllowedOrigins.includes(origin)
  if (!allowed && c.req.method !== 'OPTIONS') {
    return errorResponse(
      c,
      403,
      'ORIGIN_NOT_ALLOWED',
      'Request origin is not allowed.',
    )
  }

  const middleware = cors({
    origin: allowed ? origin : '',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  })
  return middleware(c, next)
}

export const requireTrustedOrigin = (
  runtime: AuthRuntime,
): MiddlewareHandler<AuthEnv> => async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    await next()
    return
  }

  const origin = c.req.header('Origin')
  if (
    !origin ||
    !isAllowedOrigin(origin, c.req.url, runtime.getConfig().allowedOrigins)
  ) {
    return errorResponse(c, 403, 'CSRF_VALIDATION_FAILED', 'Request origin is not allowed.')
  }

  await next()
}
