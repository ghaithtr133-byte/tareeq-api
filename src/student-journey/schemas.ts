import { z } from '@hono/zod-openapi'
import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
export const journeySlotSchema = z.coerce.number().int().min(1).max(4)
export const journeyParams = z.object({ slot: journeySlotSchema })
const field = (max: number) => z.string().trim().min(1).max(max).nullable().optional()
export const journeyUpdate = z.object({ titleAr: field(200), titleEn: field(200), descriptionAr: field(2_000), descriptionEn: field(2_000), displayOrder: journeySlotSchema.optional(), iconKey: z.string().trim().min(1).max(100).nullable().optional(), isActive: z.boolean().optional() }).strict().refine((x) => Object.keys(x).length > 0, 'At least one field is required.')
export const journeyOrder = z.object({ slots: z.array(journeySlotSchema).length(4).refine((items) => new Set(items).size === 4, 'Each fixed slot must appear once.') }).strict()
export const journeyStepSchema = z.object({ id: z.string(), slot: journeySlotSchema, titleAr: z.string().nullable(), titleEn: z.string().nullable(), descriptionAr: z.string().nullable(), descriptionEn: z.string().nullable(), displayOrder: journeySlotSchema, iconKey: z.string().nullable(), isActive: z.boolean(), updatedAt: z.iso.datetime({ offset: true }).nullable() })
export const journeyResponse = successEnvelopeSchema(z.object({ items: z.array(journeyStepSchema) })).openapi('StudentJourneyStepsResponse')
export const journeyStepResponse = successEnvelopeSchema(journeyStepSchema).openapi('StudentJourneyStepResponse')
export const journeyErrors = { 400: { description: 'Invalid Journey fields or unapproved activation.', content: { 'application/json': { schema: errorResponseSchema } } }, 401: { description: 'Authentication required.', content: { 'application/json': { schema: errorResponseSchema } } }, 403: { description: 'ADMIN or SUPER_ADMIN required.', content: { 'application/json': { schema: errorResponseSchema } } }, 415: { description: 'JSON required.', content: { 'application/json': { schema: errorResponseSchema } } } } as const
