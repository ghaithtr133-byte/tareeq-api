import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'

export const adminRoleSchema = z.enum(['ADMIN', 'SUPER_ADMIN']).openapi('AdminRole')

export const publicAdminSchema = z
  .object({
    id: z.uuid().openapi({ example: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20' }),
    name: z.string().openapi({ example: 'Admin Name' }),
    email: z.email().openapi({ example: 'admin@example.com' }),
    role: adminRoleSchema,
  })
  .openapi('AdminUser')

export const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .openapi({
    description: 'Administrator email. Input is trimmed and normalized to lowercase.',
    example: 'admin@example.com',
    format: 'email',
  })

export const loginRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .openapi('LoginRequest')

export const strongPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/[0-9]/, 'Password must contain a number.')
  .openapi({
    description:
      'A 12-128 character password containing lowercase, uppercase, and numeric characters.',
  })

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: strongPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current password.',
    path: ['newPassword'],
  })
  .openapi('ChangePasswordRequest')

export const authUserResponseSchema = successEnvelopeSchema(
  z.object({ user: publicAdminSchema }),
).openapi('AuthUserResponse')

export const emptySuccessResponseSchema = successEnvelopeSchema(z.object({})).openapi(
  'EmptySuccessResponse',
)

export const authErrorResponses = {
  400: {
    description: 'The request is invalid.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  401: {
    description: 'Authentication failed or is required.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  403: {
    description: 'The request is forbidden due to permissions or origin validation.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  415: {
    description: 'The request body is not application/json.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const
