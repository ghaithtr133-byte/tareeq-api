import { z } from '@hono/zod-openapi'

import { publicationStatusSchema } from '../content/schemas.js'
import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import { faqScopes } from './types.js'

export const faqScopeSchema = z.enum(faqScopes).openapi('FaqScope')
const pageFields = {
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(5),
}
const parentFields = {
  scope: faqScopeSchema,
  parentId: z.uuid().nullable().optional().default(null),
}
const parentShape = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().superRefine((value, context) => {
  const parent = value as { scope?: unknown; parentId?: unknown }
  const parentId = parent.parentId
  if (parent.scope === 'GLOBAL' ? parentId != null : parentId == null) {
    context.addIssue({
      code: 'custom', path: ['parentId'],
      message: parent.scope === 'GLOBAL' ? 'GLOBAL FAQs cannot have a parent.' : 'A parentId is required for this scope.',
    })
  }
})

export const globalFaqQuerySchema = z.object({
  scope: z.literal('GLOBAL'),
  ...pageFields,
}).strict()
export const nestedFaqQuerySchema = z.object(pageFields).strict()
export const adminFaqListQuerySchema = parentShape({
  ...parentFields,
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  status: publicationStatusSchema.optional(),
})

const faqTextFields = {
  questionAr: z.string().trim().min(2).max(500),
  answerAr: z.string().trim().min(2).max(10_000),
  questionEn: z.string().trim().min(2).max(500).nullable().optional(),
  answerEn: z.string().trim().min(2).max(10_000).nullable().optional(),
}

export const faqCreateSchema = parentShape({
  ...parentFields,
  ...faqTextFields,
  status: publicationStatusSchema.optional().default('DRAFT'),
}).superRefine((value, context) => {
  if ((value.questionEn == null) !== (value.answerEn == null)) {
    context.addIssue({ code: 'custom', path: ['questionEn'], message: 'English question and answer must be provided together.' })
  }
}).openapi('FaqCreateRequest')

export const faqUpdateSchema = z.object({
  questionAr: faqTextFields.questionAr.optional(),
  answerAr: faqTextFields.answerAr.optional(),
  questionEn: faqTextFields.questionEn,
  answerEn: faqTextFields.answerEn,
  status: publicationStatusSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided.',
}).openapi('FaqUpdateRequest')

export const faqIdParamSchema = z.object({ id: z.uuid() })
export const faqSlugParamSchema = z.object({ slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })
export const faqReorderSchema = parentShape({
  ...parentFields,
  orderedIds: z.array(z.uuid()).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate FAQ IDs are not allowed.' })
  }),
}).openapi('FaqReorderRequest')

const dateSchema = z.iso.datetime({ offset: true })
const publicFaqSchema = z.object({
  id: z.uuid(), scope: faqScopeSchema,
  questionAr: z.string(), answerAr: z.string(),
  questionEn: z.string().nullable(), answerEn: z.string().nullable(),
  displayOrder: z.number().int(), publishedAt: dateSchema.nullable(),
}).openapi('PublicFaqEntry')
const adminFaqSchema = publicFaqSchema.extend({
  parentId: z.uuid().nullable(), status: publicationStatusSchema,
  createdAt: dateSchema, updatedAt: dateSchema,
}).openapi('AdminFaqEntry')
const paginationSchema = z.object({
  page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
})

export const publicFaqListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(publicFaqSchema), pagination: paginationSchema,
})).openapi('PublicFaqListResponse')
export const adminFaqListResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(adminFaqSchema), pagination: paginationSchema,
})).openapi('AdminFaqListResponse')
export const adminFaqResponseSchema = successEnvelopeSchema(adminFaqSchema).openapi('AdminFaqResponse')
export const faqOrderResponseSchema = successEnvelopeSchema(z.object({ items: z.array(adminFaqSchema) })).openapi('FaqOrderResponse')

const errorContent = (example: unknown) => ({ 'application/json': { schema: errorResponseSchema, example } })
export const faqErrorResponses = {
  400: { description: 'FAQ validation or parent relationship error.', content: errorContent({ success: false, error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid fields.', details: { fields: { parentId: ['A parentId is required for this scope.'] } } } }) },
  401: { description: 'Authentication is required.', content: errorContent({ success: false, error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: {} } }) },
  403: { description: 'ADMIN or SUPER_ADMIN permission and a trusted origin are required.', content: errorContent({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions.', details: {} } }) },
  404: { description: 'FAQ or public parent resource not found.', content: errorContent({ success: false, error: { code: 'FAQ_NOT_FOUND', message: 'FAQ entry not found.', details: {} } }) },
  409: { description: 'The submitted order is stale or contains another parent’s FAQs.', content: errorContent({ success: false, error: { code: 'FAQ_ORDER_SET_MISMATCH', message: 'The ordered IDs must contain every non-archived FAQ for exactly one parent.', details: {} } }) },
  415: { description: 'The request body is not JSON.', content: errorContent({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.', details: {} } }) },
} as const
