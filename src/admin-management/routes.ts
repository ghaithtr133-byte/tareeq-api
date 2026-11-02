import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { AdminManagementRuntime } from './runtime.js'
import {
  adminAccountIdParamSchema,
  adminAccountListQuerySchema,
  adminAccountListResponseSchema,
  adminAccountResponseSchema,
  adminAccountUpdateSchema,
  adminManagementErrorResponses,
} from './schemas.js'
import type {
  AdminAccountChange,
  AdminAccountListQuery,
} from './types.js'

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

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error.issues)
  return result.data
}

const queryObject = (url: string) =>
  Object.fromEntries(new URL(url).searchParams.entries())

const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', {
      fields: { _request: ['Provide a valid JSON request body.'] },
    })
  }
}

const accountExample = {
  id: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20',
  name: 'Admin Name',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  isActive: true,
}

export const createAdminManagementRoutes = (
  runtime: AdminManagementRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/users',
    tags: ['Admin — Account Management'],
    summary: 'List administrator accounts',
    description: 'SUPER_ADMIN only. Returns paginated administrator identity, role, and activation state without password hashes, credentials, or session data.',
    security: [{ accessCookie: [] }],
    request: { query: adminAccountListQuerySchema },
    responses: {
      200: {
        description: 'Paginated safe administrator accounts.',
        content: { 'application/json': {
          schema: adminAccountListResponseSchema,
          example: {
            success: true,
            data: {
              items: [accountExample],
              pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            },
          },
        } },
      },
      400: adminManagementErrorResponses[400],
      401: adminManagementErrorResponses[401],
      403: adminManagementErrorResponses[403],
    },
  })

  routes.openAPIRegistry.registerPath({
    method: 'patch',
    path: '/admin/users/{id}',
    tags: ['Admin — Account Management'],
    summary: 'Change an administrator role or activation state',
    description: 'SUPER_ADMIN only. Accepts exactly one change: `role` or `isActive`. Self-deactivation, self-demotion, and removal of the last active SUPER_ADMIN are rejected atomically. Deactivation revokes refresh sessions and existing access cookies become unusable on their next authenticated request.',
    security: [{ accessCookie: [] }],
    request: {
      params: adminAccountIdParamSchema,
      body: { required: true, content: {
        'application/json': {
          schema: adminAccountUpdateSchema,
          example: { isActive: false },
        },
      } },
    },
    responses: {
      200: {
        description: 'Updated safe administrator account.',
        content: { 'application/json': {
          schema: adminAccountResponseSchema,
          example: { success: true, data: { ...accountExample, isActive: false } },
        } },
      },
      400: adminManagementErrorResponses[400],
      401: adminManagementErrorResponses[401],
      403: adminManagementErrorResponses[403],
      404: adminManagementErrorResponses[404],
      409: adminManagementErrorResponses[409],
      415: adminManagementErrorResponses[415],
    },
  })

  for (const path of ['/users', '/users/*']) {
    adminRoutes.use(path, authCors(authRuntime))
    adminRoutes.use(path, requireTrustedOrigin(authRuntime))
    adminRoutes.use(path, requireAuthentication(authRuntime))
    adminRoutes.use(path, requireRole('SUPER_ADMIN'))
  }

  adminRoutes.get('/users', async (c) => {
    const query = parse(
      adminAccountListQuerySchema,
      queryObject(c.req.url),
    ) as AdminAccountListQuery
    return c.json(successResponse(await runtime.getService().list(query)), 200)
  })

  adminRoutes.patch('/users/:id', async (c) => {
    const { id } = parse(adminAccountIdParamSchema, { id: c.req.param('id') })
    const change = parse(
      adminAccountUpdateSchema,
      await readJson(c.req.raw),
    ) as AdminAccountChange
    return c.json(successResponse(await runtime.getService().update(
      c.get('authClaims').userId,
      id,
      change,
    )), 200)
  })

  routes.route('/admin', adminRoutes)
  return routes
}
