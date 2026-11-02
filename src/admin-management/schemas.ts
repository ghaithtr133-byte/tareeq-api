import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'

export const managedAdminRoleSchema = z
  .enum(['ADMIN', 'SUPER_ADMIN'])
  .openapi('ManagedAdminRole')

export const adminAccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: managedAdminRoleSchema,
  isActive: z.boolean(),
}).openapi('ManagedAdminAccount')

const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

export const adminAccountListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1).openapi({
    description: 'One-based page number.', example: 1,
  }),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20).openapi({
    description: 'Items per page. Maximum 50.', example: 20,
  }),
}).strict()

export const adminAccountIdParamSchema = z.object({
  id: z.uuid().openapi({
    description: 'Target administrator UUID.',
    example: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20',
  }),
})

export const adminAccountUpdateSchema = z.union([
  z.object({ isActive: z.boolean() }).strict(),
  z.object({ role: managedAdminRoleSchema }).strict(),
]).openapi('AdminAccountUpdateRequest')

export const adminAccountResponseSchema = successEnvelopeSchema(
  adminAccountSchema,
).openapi('ManagedAdminAccountResponse')

export const adminAccountListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(adminAccountSchema),
  pagination: paginationSchema,
})).openapi('ManagedAdminAccountListResponse')

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const adminManagementErrorResponses = {
  400: {
    description: 'The pagination, target identifier, or update body is invalid.',
    content: errorContent({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: { fields: { role: ['Invalid option.'] } },
      },
    }),
  },
  401: {
    description: 'Authentication is required.',
    content: errorContent({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: {} },
    }),
  },
  403: {
    description: 'SUPER_ADMIN permission and a trusted Admin origin are required.',
    content: errorContent({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions.', details: {} },
    }),
  },
  404: {
    description: 'The target administrator does not exist.',
    content: errorContent({
      success: false,
      error: { code: 'ADMIN_ACCOUNT_NOT_FOUND', message: 'Administrator account not found.', details: {} },
    }),
  },
  409: {
    description: 'The requested change violates administrator safety invariants or changes nothing.',
    content: errorContent({
      success: false,
      error: {
        code: 'LAST_ACTIVE_SUPER_ADMIN_REQUIRED',
        message: 'At least one active SUPER_ADMIN account must remain.',
        details: {},
      },
    }),
  },
  415: {
    description: 'The request body is not JSON.',
    content: errorContent({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.', details: {} },
    }),
  },
} as const
