import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { AuditRuntime } from './runtime.js'
import {
  auditErrorResponses,
  auditListQuerySchema,
  auditListResponseSchema,
} from './schemas.js'
import type { AuditListQuery } from './types.js'

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', {
    fields,
  })
}

const queryObject = (url: string) =>
  Object.fromEntries(new URL(url).searchParams.entries())

export const createAuditRoutes = (
  auditRuntime: AuditRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/audit-logs',
    tags: ['Admin — Audit Logs'],
    summary: 'List administrator audit events',
    description: 'SUPER_ADMIN only. Returns append-only records of successful administrative mutations with deterministic newest-first sorting and optional actor, action, resource-type, and inclusive date-range filters.',
    security: [{ accessCookie: [] }],
    request: { query: auditListQuerySchema },
    responses: {
      200: {
        description: 'Paginated administrator audit events.',
        content: {
          'application/json': {
            schema: auditListResponseSchema,
            example: {
              success: true,
              data: {
                items: [{
                  id: '36ab40ef-5016-4fb0-99b9-668b2dca45f3',
                  actorAdminId: '11111111-1111-4111-8111-111111111111',
                  action: 'content.country.status_changed',
                  resourceType: 'COUNTRY',
                  resourceId: '9879d0a4-9b7e-48d1-850a-da51be9de671',
                  metadata: { fromStatus: 'DRAFT', toStatus: 'PUBLISHED' },
                  createdAt: '2026-10-31T12:00:00.000Z',
                  actor: {
                    id: '11111111-1111-4111-8111-111111111111',
                    name: 'Super Admin',
                  },
                }],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
              },
            },
          },
        },
      },
      400: auditErrorResponses[400],
      401: auditErrorResponses[401],
      403: auditErrorResponses[403],
    },
  })

  adminRoutes.use('/audit-logs', authCors(authRuntime))
  adminRoutes.use('/audit-logs', requireTrustedOrigin(authRuntime))
  adminRoutes.use('/audit-logs', requireAuthentication(authRuntime))
  adminRoutes.use('/audit-logs', requireRole('SUPER_ADMIN'))

  adminRoutes.get('/audit-logs', async (c) => {
    const result = auditListQuerySchema.safeParse(queryObject(c.req.url))
    if (!result.success) throw validationError(result.error.issues)
    return c.json(successResponse(
      await auditRuntime.getService().list(result.data as AuditListQuery),
    ), 200)
  })

  routes.route('/admin', adminRoutes)
  return routes
}
