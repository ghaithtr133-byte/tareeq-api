import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { successEnvelopeSchema, successResponse } from '../shared/http.js'

const healthDataSchema = z
  .object({
    status: z.literal('ok'),
  })
  .openapi('HealthData')

export const healthResponseSchema = successEnvelopeSchema(healthDataSchema).openapi(
  'HealthResponse',
)

const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  tags: ['System'],
  summary: 'Check API health',
  description: 'Reports whether the API process is available. No database or authentication is required.',
  responses: {
    200: {
      description: 'The API is healthy.',
      content: {
        'application/json': {
          schema: healthResponseSchema,
        },
      },
    },
  },
})

export const healthRoutes = new OpenAPIHono().openapi(healthRoute, (c) =>
  c.json(successResponse({ status: 'ok' as const }), 200),
)
