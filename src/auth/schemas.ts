import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'

export const adminRoleSchema = z.enum(['ADMIN', 'SUPER_ADMIN']).openapi('AdminRole')

export const publicAdminSchema = z
  .object({
    id: z.uuid().openapi({ example: 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20' }),
    name: z.string().openapi({ example: 'Admin Name' }),
    email: z.email().openapi({ example: 'admin@example.invalid' }),
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
    example: 'admin@example.invalid',
    format: 'email',
  })

export const loginRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .openapi('LoginRequest')

export const profileNameUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).transform((value) => value.replace(/\s+/g, ' ')).openapi({
      description: 'Administrator display name. Leading, trailing, and repeated whitespace is normalized.',
      example: 'Admin Name',
    }),
  })
  .strict()
  .openapi('ProfileNameUpdateRequest')

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

export const passwordRecoveryRequestSchema = z
  .object({ email: normalizedEmailSchema })
  .strict()
  .openapi('PasswordRecoveryRequest')

export const passwordRecoveryVerificationSchema = z
  .object({
    challengeId: z.uuid(),
    otp: z.string().regex(/^\d{6}$/, 'Recovery code must contain exactly six digits.'),
  })
  .strict()
  .openapi('PasswordRecoveryVerificationRequest')

export const passwordRecoveryResetSchema = z
  .object({
    challengeId: z.uuid(),
    resetAuthorization: z.string().min(32).max(256),
    newPassword: strongPasswordSchema,
  })
  .strict()
  .openapi('PasswordRecoveryResetRequest')

export const adminAccountIdParamSchema = z.object({ id: z.uuid() }).openapi('AdminAccountIdParam')

export const passwordRecoveryAcceptedResponseSchema = successEnvelopeSchema(
  z.object({ message: z.string() }),
).openapi('PasswordRecoveryAcceptedResponse')

export const passwordRecoveryRequestResponseSchema = successEnvelopeSchema(
  z.object({ message: z.string(), challengeId: z.uuid() }),
).openapi('PasswordRecoveryRequestResponse')

export const passwordRecoveryVerificationResponseSchema = successEnvelopeSchema(
  z.object({ resetAuthorization: z.string() }),
).openapi('PasswordRecoveryVerificationResponse')

export const authUserResponseSchema = successEnvelopeSchema(
  z.object({ user: publicAdminSchema }),
).openapi('AuthUserResponse')

export const emptySuccessResponseSchema = successEnvelopeSchema(z.object({})).openapi(
  'EmptySuccessResponse',
)

export const authErrorResponses = {
  400: {
    description: 'The request is invalid.',
    content: { 'application/json': { schema: errorResponseSchema, example: {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', details: [] },
    } } },
  },
  401: {
    description: 'Authentication failed or is required.',
    content: { 'application/json': { schema: errorResponseSchema, example: {
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: {} },
    } } },
  },
  403: {
    description: 'The request is forbidden due to permissions or origin validation.',
    content: { 'application/json': { schema: errorResponseSchema, example: {
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED', message: 'Request origin is not allowed.', details: {} },
    } } },
  },
  404: {
    description: 'The requested resource was not found.',
    content: { 'application/json': { schema: errorResponseSchema, example: {
      success: false,
      error: { code: 'ADMIN_ACCOUNT_NOT_FOUND', message: 'Administrator account was not found.', details: {} },
    } } },
  },
  415: {
    description: 'The request body is not application/json.',
    content: { 'application/json': { schema: errorResponseSchema, example: {
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type.', details: {} },
    } } },
  },
} as const
