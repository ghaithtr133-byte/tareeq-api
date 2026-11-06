import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'

const safeText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(
  (value) => !/[<>]/.test(value),
  'HTML markup is not supported.',
).nullable().optional()

const imageUrl = z.url().max(2_048).refine(
  (value) => new URL(value).protocol === 'https:',
  'Use an HTTPS image URL.',
).nullable().optional()

const updateFields = {
  heroTitleAr: safeText(200), heroTitleEn: safeText(200),
  heroSubtitleAr: safeText(1_000), heroSubtitleEn: safeText(1_000),
  heroImageUrl: imageUrl, heroImageAltAr: safeText(500), heroImageAltEn: safeText(500),
  introTitleAr: safeText(200), introTitleEn: safeText(200),
  introBodyAr: safeText(12_000), introBodyEn: safeText(12_000),
  introImageUrl: imageUrl, introImageAltAr: safeText(500), introImageAltEn: safeText(500),
  missionTitleAr: safeText(200), missionTitleEn: safeText(200),
  missionBodyAr: safeText(6_000), missionBodyEn: safeText(6_000),
  visionTitleAr: safeText(200), visionTitleEn: safeText(200),
  visionBodyAr: safeText(6_000), visionBodyEn: safeText(6_000),
  ctaTitleAr: safeText(200), ctaTitleEn: safeText(200),
  ctaDescriptionAr: safeText(2_000), ctaDescriptionEn: safeText(2_000),
  ctaButtonLabelAr: safeText(120), ctaButtonLabelEn: safeText(120),
  seoTitleAr: safeText(200), seoDescriptionAr: safeText(320),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
}

export const aboutUsUpdateSchema = z.object(updateFields).strict().refine(
  (value) => Object.keys(value).length > 0,
  'At least one About Us field must be provided.',
).openapi('AboutUsUpdateRequest')

const outputText = z.string().nullable()
const outputFields = {
  id: z.uuid(),
  heroTitleAr: outputText, heroTitleEn: outputText,
  heroSubtitleAr: outputText, heroSubtitleEn: outputText,
  heroImageUrl: z.url().nullable(), heroImageAltAr: outputText, heroImageAltEn: outputText,
  introTitleAr: outputText, introTitleEn: outputText,
  introBodyAr: outputText, introBodyEn: outputText,
  introImageUrl: z.url().nullable(), introImageAltAr: outputText, introImageAltEn: outputText,
  missionTitleAr: outputText, missionTitleEn: outputText,
  missionBodyAr: outputText, missionBodyEn: outputText,
  visionTitleAr: outputText, visionTitleEn: outputText,
  visionBodyAr: outputText, visionBodyEn: outputText,
  ctaTitleAr: outputText, ctaTitleEn: outputText,
  ctaDescriptionAr: outputText, ctaDescriptionEn: outputText,
  ctaButtonLabelAr: outputText, ctaButtonLabelEn: outputText,
  seoTitleAr: outputText, seoDescriptionAr: outputText,
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}

export const aboutUsPublicSchema = z.object(outputFields).openapi('AboutUsPublic')
export const aboutUsAdminSchema = z.object({
  ...outputFields,
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  createdAt: z.iso.datetime({ offset: true }),
}).openapi('AboutUsAdmin')

export const aboutUsPublicResponseSchema = successEnvelopeSchema(aboutUsPublicSchema)
  .openapi('AboutUsPublicResponse')
export const aboutUsAdminResponseSchema = successEnvelopeSchema(aboutUsAdminSchema)
  .openapi('AboutUsAdminResponse')

const error = (description: string, code: string, message: string, details: unknown = {}) => ({
  description,
  content: { 'application/json': { schema: errorResponseSchema, example: {
    success: false, error: { code, message, details },
  } } },
})

export const aboutUsErrorResponses = {
  400: error('The request is invalid or the fully merged record cannot be published.', 'PUBLICATION_REQUIREMENTS_NOT_MET', 'The About Us page cannot be published until required Arabic content is complete.', { fields: { heroTitleAr: ['Required before publication.'] } }),
  401: error('Authentication is required.', 'AUTHENTICATION_REQUIRED', 'Authentication is required.'),
  403: error('A trusted Admin origin and ADMIN or SUPER_ADMIN permission are required.', 'FORBIDDEN', 'Insufficient permissions.'),
  404: error('The singleton has not been created, or no published page exists.', 'CONTENT_NOT_FOUND', 'About Us content not found.'),
  415: error('The request body is not JSON.', 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'),
} as const
