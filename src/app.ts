import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

import { healthRoutes } from './routes/health.js'
import { errorResponse, handleError, handleNotFound } from './shared/http.js'

export const createApp = () => {
  const app = new OpenAPIHono({
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

  app.route('/', healthRoutes)

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
