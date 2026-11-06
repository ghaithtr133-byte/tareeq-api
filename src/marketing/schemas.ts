import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import { marketingPageKeys } from './types.js'

const image = z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS image URL.').nullable().optional()
const alt = z.string().trim().min(1).max(500).nullable().optional()
export const marketingPageKeySchema = z.enum(marketingPageKeys)
export const marketingPageParamsSchema = z.object({ pageKey: marketingPageKeySchema })
export const marketingPageUpdateSchema = z.object({ heroImageUrl: image, heroImageAltAr: alt, ctaImageUrl: image, ctaImageAltAr: alt }).strict().refine((value) => Object.keys(value).length > 0, 'At least one image field must be provided.')
export const marketingPageSchema = z.object({
  pageKey: marketingPageKeySchema,
  heroImageUrl: z.url().nullable(), heroImageAltAr: z.string().nullable(),
  ctaImageUrl: z.url().nullable(), ctaImageAltAr: z.string().nullable(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
}).openapi('MarketingPageImages')
export const marketingPageResponseSchema = successEnvelopeSchema(marketingPageSchema).openapi('MarketingPageImagesResponse')
export const marketingErrors = {
  400: { description: 'Invalid page key or image fields.', content: { 'application/json': { schema: errorResponseSchema } } },
  401: { description: 'Authentication is required.', content: { 'application/json': { schema: errorResponseSchema } } },
  403: { description: 'Trusted ADMIN or SUPER_ADMIN permission is required.', content: { 'application/json': { schema: errorResponseSchema } } },
  415: { description: 'Content-Type must be application/json.', content: { 'application/json': { schema: errorResponseSchema } } },
} as const
