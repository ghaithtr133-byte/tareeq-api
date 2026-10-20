import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

import { createAuthRoutes } from './auth/routes.js'
import {
  productionAuthRuntime,
  type AuthRuntime,
} from './auth/runtime.js'
import type { AuthEnv } from './auth/types.js'
import { createContentRoutes } from './content/routes.js'
import {
  productionContentRuntime,
  type ContentRuntime,
} from './content/runtime.js'
import { healthRoutes } from './routes/health.js'
import { errorResponse, handleError, handleNotFound } from './shared/http.js'

type AppOptions = {
  authRuntime?: AuthRuntime
  contentRuntime?: ContentRuntime
}

export const createApp = (options: AppOptions = {}) => {
  const app = new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'Invalid request.',
          result.error.issues,
        )
      }
    },
  })

  app.use('*', async (c, next) => {
    const supplied = c.req.header('X-Request-Id')
    const requestId =
      supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
        ? supplied
        : crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('X-Request-Id', requestId)
    await next()
  })

  app.route('/', healthRoutes)
  const authRuntime = options.authRuntime ?? productionAuthRuntime
  app.route('/api/v1/auth', createAuthRoutes(authRuntime))
  app.route(
    '/api/v1',
    createContentRoutes(
      options.contentRuntime ?? productionContentRuntime,
      authRuntime,
    ),
  )

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Tareeq Academy API',
      version: '0.1.0',
      description: 'Backend API for the Tareeq Academy educational consulting platform.',
    },
  })

  app.get(
    '/docs',
    Scalar({
      url: '/openapi.json',
      pageTitle: 'Tareeq Academy API Reference',
    }),
  )

  app.notFound(handleNotFound)
  app.onError(handleError)

  return app
}

export const app = createApp()
