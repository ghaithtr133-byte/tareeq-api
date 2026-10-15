import { z } from '@hono/zod-openapi'
import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown(),
    }),
  })
  .openapi('ErrorResponse')

export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
  })

export const successResponse = <T>(data: T) => ({
  success: true as const,
  data,
})

export const errorResponse = (
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details: unknown = {},
) =>
  c.json(
    {
      success: false as const,
      error: { code, message, details },
    },
    status,
  )

export const handleError: ErrorHandler = (error, c) => {
  console.error(error)

  return errorResponse(
    c,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected error occurred.',
  )
}

export const handleNotFound: NotFoundHandler = (c) =>
  errorResponse(c, 404, 'NOT_FOUND', 'Route not found.', {
    method: c.req.method,
    path: c.req.path,
  })
