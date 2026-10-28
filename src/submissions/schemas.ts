import { z } from '@hono/zod-openapi'

import {
  errorResponseSchema,
  successEnvelopeSchema,
} from '../shared/http.js'

export const studentApplicationTypeSchema = z
  .enum(['UNIVERSITY_ADMISSION', 'SCHOLARSHIP_ASSISTANCE'])
  .openapi('StudentApplicationType')

export const submissionStatusSchema = z
  .enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'CLOSED'])
  .openapi('SubmissionStatus')

const fullNameSchema = z.string().trim().min(2).max(150).openapi({
  example: 'أحمد محمد',
  description: 'Student or inquirer full name.',
})
const emailSchema = z.string().trim().max(254).pipe(z.email()).transform(
  (value) => value.toLowerCase(),
).openapi({ example: 'student@example.invalid' })
const phoneSchema = z.string().trim().min(7).max(25).regex(
  /^\+?[0-9][0-9 ()-]{5,23}[0-9]$/,
  'Use a valid phone number containing digits and optional spaces, parentheses, hyphens, or a leading plus.',
).nullable().optional().openapi({ example: '+963 900 000 000' })
const messageSchema = z.string().trim().min(10).max(5_000).openapi({
  example: 'أرغب بالحصول على المساعدة في خطوات التقديم والمتطلبات المطلوبة.',
})
const optionalUuidSchema = z.uuid().nullable().optional()
const optionalShortTextSchema = z.string().trim().min(1).max(200).nullable().optional()
const privacyAcceptedSchema = z.literal(true).openapi({
  description: 'Must be true. The Backend stores the server acceptance timestamp.',
  example: true,
})
const honeypotSchema = z.string().max(200).optional().default('').openapi({
  description: 'Spam honeypot. Human users must leave this field empty.',
  example: '',
})

export const studentApplicationCreateSchema = z.object({
  applicationType: studentApplicationTypeSchema,
  scholarshipId: optionalUuidSchema.openapi({
    description: 'Optional published and currently open scholarship UUID.',
  }),
  countryId: optionalUuidSchema.openapi({
    description: 'Optional published Country UUID.',
  }),
  universityId: optionalUuidSchema.openapi({
    description: 'Optional published University UUID.',
  }),
  studyLevel: z.string().trim().min(1).max(120).nullable().optional().openapi({
    example: 'MASTERS',
  }),
  intendedMajor: optionalShortTextSchema.openapi({ example: 'Computer Science' }),
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  message: messageSchema,
  privacyAccepted: privacyAcceptedSchema,
  website: honeypotSchema,
}).strict().openapi('StudentApplicationCreateRequest')

export const generalInquiryCreateSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  subject: z.string().trim().min(3).max(200).openapi({
    example: 'استفسار عن خدمات القبول الجامعي',
  }),
  message: messageSchema,
  privacyAccepted: privacyAcceptedSchema,
  website: honeypotSchema,
}).strict().openapi('GeneralInquiryCreateRequest')

const isoDateSchema = z.iso.datetime({ offset: true })

export const studentApplicationSchema = z.object({
  id: z.uuid(),
  applicationType: studentApplicationTypeSchema,
  scholarshipId: z.uuid().nullable(),
  countryId: z.uuid().nullable(),
  universityId: z.uuid().nullable(),
  studyLevel: z.string().nullable(),
  intendedMajor: z.string().nullable(),
  fullName: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  message: z.string(),
  status: submissionStatusSchema,
  internalNote: z.string().nullable(),
  privacyAcceptedAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).openapi('StudentApplication')

export const generalInquirySchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  subject: z.string(),
  message: z.string(),
  status: submissionStatusSchema,
  internalNote: z.string().nullable(),
  privacyAcceptedAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).openapi('GeneralInquiry')

const pageQuery = {
  page: z.coerce.number().int().min(1).optional().default(1).openapi({
    description: 'One-based page number.', example: 1,
  }),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12).openapi({
    description: 'Items per page. Maximum 50.', example: 12,
  }),
  status: submissionStatusSchema.optional().openapi({
    description: 'Filter by workflow status.',
  }),
  sort: z.enum(['newest', 'oldest', 'updated']).optional().default('newest').openapi({
    description: 'Safe sort allowlist. Defaults to newest first.',
  }),
}

export const applicationListQuerySchema = z.object({
  ...pageQuery,
  applicationType: studentApplicationTypeSchema.optional().openapi({
    description: 'Filter by application type.',
  }),
}).strict()

export const inquiryListQuerySchema = z.object(pageQuery).strict()

export const submissionUuidParamSchema = z.object({
  id: z.uuid().openapi({
    description: 'Submission UUID.',
    example: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d',
  }),
})

export const submissionUpdateSchema = z.object({
  status: submissionStatusSchema.optional(),
  internalNote: z.string().trim().max(5_000).nullable().optional().openapi({
    description: 'Private administrative note. Never returned publicly.',
    example: 'تمت مراجعة الطلب والتواصل مع الطالب.',
  }),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided.',
}).openapi('SubmissionStatusUpdateRequest')

export const submissionConfirmationResponseSchema = successEnvelopeSchema(z.object({
  message: z.string(),
})).openapi('SubmissionConfirmationResponse')

export const studentApplicationResponseSchema = successEnvelopeSchema(
  studentApplicationSchema,
).openapi('StudentApplicationResponse')

export const inquiryResponseSchema = successEnvelopeSchema(
  generalInquirySchema,
).openapi('GeneralInquiryResponse')

const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

export const applicationListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(studentApplicationSchema),
  pagination: paginationSchema,
})).openapi('StudentApplicationListResponse')

export const inquiryListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(generalInquirySchema),
  pagination: paginationSchema,
})).openapi('GeneralInquiryListResponse')

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const submissionErrorResponses = {
  400: {
    description: 'Validation or related-record error.',
    content: errorContent({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: { fields: { privacyAccepted: ['Invalid input: expected true'] } },
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
    description: 'The browser origin is not allowed or the administrator lacks permission.',
    content: errorContent({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Request is forbidden.', details: {} },
    }),
  },
  404: {
    description: 'The requested submission was not found.',
    content: errorContent({
      success: false,
      error: { code: 'APPLICATION_NOT_FOUND', message: 'Student application not found.', details: {} },
    }),
  },
  413: {
    description: 'The JSON request exceeds 16 KiB.',
    content: errorContent({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', details: {} },
    }),
  },
  415: {
    description: 'The request body is not JSON.',
    content: errorContent({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.', details: {} },
    }),
  },
  429: {
    description: 'The shared submission limit was reached.',
    content: errorContent({
      success: false,
      error: {
        code: 'SUBMISSION_RATE_LIMITED',
        message: 'Too many submissions. Please try again later.',
        details: { retryAfterSeconds: 600 },
      },
    }),
  },
} as const
