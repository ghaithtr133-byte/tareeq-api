import { z } from '@hono/zod-openapi'

import {
  errorResponseSchema,
  successEnvelopeSchema,
} from '../shared/http.js'
import { auditResourceTypes } from './types.js'

export const auditResourceTypeSchema = z
  .enum(auditResourceTypes)
  .openapi('AuditResourceType')

const dateTimeSchema = z.iso.datetime({ offset: true })

export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1).openapi({
    description: 'One-based page number.',
    example: 1,
  }),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20).openapi({
    description: 'Items per page. Maximum 100.',
    example: 20,
  }),
  actorId: z.uuid().optional().openapi({
    description: 'Filter by the acting administrator UUID.',
  }),
  action: z.string().trim().min(3).max(100).regex(
    /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/,
    'Use a structured lowercase action identifier.',
  ).optional().openapi({
    description: 'Filter by an exact structured action identifier.',
    example: 'content.country.status_changed',
  }),
  resourceType: auditResourceTypeSchema.optional().openapi({
    description: 'Filter by audited resource type.',
  }),
  from: dateTimeSchema.optional().openapi({
    description: 'Inclusive lower bound for event creation time.',
    example: '2026-10-01T00:00:00.000Z',
  }),
  to: dateTimeSchema.optional().openapi({
    description: 'Inclusive upper bound for event creation time.',
    example: '2026-10-31T23:59:59.999Z',
  }),
}).strict()

export const auditLogSchema = z.object({
  id: z.uuid(),
  actorAdminId: z.uuid(),
  action: z.string(),
  resourceType: auditResourceTypeSchema,
  resourceId: z.uuid(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: dateTimeSchema,
  actor: z.object({
    id: z.uuid(),
    name: z.string(),
  }),
}).openapi('AdminAuditLog')

const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

export const auditListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(auditLogSchema),
  pagination: paginationSchema,
})).openapi('AdminAuditLogListResponse')

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const auditErrorResponses = {
  400: {
    description: 'The pagination or filter input is invalid.',
    content: errorContent({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: { fields: { from: ['The start date must not be after the end date.'] } },
      },
    }),
  },
  401: {
    description: 'Authentication is required.',
    content: errorContent({
      success: false,
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        details: {},
      },
    }),
  },
  403: {
    description: 'SUPER_ADMIN permission and a trusted Admin origin are required.',
    content: errorContent({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions.',
        details: {},
      },
    }),
  },
} as const
