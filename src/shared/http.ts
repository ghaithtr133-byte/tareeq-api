import { z } from '@hono/zod-openapi'
import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details: unknown = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.union([
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
      ]),
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
  if (error instanceof ApiError) {
    return errorResponse(
      c,
      error.status,
      error.code,
      error.message,
      error.details,
    )
  }

  if (error instanceof HTTPException && error.status < 500) {
    const safeErrors: Partial<
      Record<ContentfulStatusCode, { code: string; message: string }>
    > = {
      400: { code: 'BAD_REQUEST', message: 'Invalid request.' },
      401: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' },
      403: { code: 'FORBIDDEN', message: 'Request is forbidden.' },
      404: { code: 'NOT_FOUND', message: 'Route not found.' },
      405: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
      413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.' },
      415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type.' },
    }
    const safeError = safeErrors[error.status] ?? {
      code: 'REQUEST_ERROR',
      message: 'Request could not be processed.',
    }
    return errorResponse(c, error.status, safeError.code, safeError.message)
  }

  const requestId = c.res.headers.get('X-Request-Id') ?? crypto.randomUUID()
  c.header('X-Request-Id', requestId)
  console.error('Unhandled application error.', {
    requestId,
    error: error instanceof Error ? error.name : 'UnknownError',
  })

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
