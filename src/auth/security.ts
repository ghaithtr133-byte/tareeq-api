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
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      credentials: true,
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
