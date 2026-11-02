import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'

const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional()

const socialUrl = (
  label: string,
  allowedDomains: string[],
) => z.url().max(2_048).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && allowedDomains.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  )
}, `Use an HTTPS ${label} URL.`).nullable().optional()

const fields = {
  academyNameAr: nullableText(200),
  academyNameEn: nullableText(200),
  contactEmail: z.string().trim().max(254).pipe(z.email()).transform(
    (value) => value.toLowerCase(),
  ).nullable().optional(),
  contactPhone: z.string().trim().min(7).max(25).regex(
    /^\+?[0-9][0-9 ()-]{5,23}[0-9]$/,
    'Use a valid public phone number.',
  ).nullable().optional(),
  addressAr: nullableText(1_000),
  addressEn: nullableText(1_000),
  facebookUrl: socialUrl('Facebook', ['facebook.com']),
  instagramUrl: socialUrl('Instagram', ['instagram.com']),
  linkedinUrl: socialUrl('LinkedIn', ['linkedin.com']),
  youtubeUrl: socialUrl('YouTube', ['youtube.com', 'youtu.be']),
}

export const siteSettingsUpdateSchema = z.object(fields).strict().refine(
  (value) => Object.keys(value).length > 0,
  'At least one setting must be provided.',
).openapi('SiteSettingsUpdateRequest')

const outputFields = {
  academyNameAr: z.string().nullable(),
  academyNameEn: z.string().nullable(),
  contactEmail: z.email().nullable(),
  contactPhone: z.string().nullable(),
  addressAr: z.string().nullable(),
  addressEn: z.string().nullable(),
  facebookUrl: z.url().nullable(),
  instagramUrl: z.url().nullable(),
  linkedinUrl: z.url().nullable(),
  youtubeUrl: z.url().nullable(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
}

export const siteSettingsSchema = z.object(outputFields).openapi('SiteSettings')
export const siteSettingsResponseSchema = successEnvelopeSchema(
  siteSettingsSchema,
).openapi('SiteSettingsResponse')

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const siteSettingsErrorResponses = {
  400: {
    description: 'A settings field is invalid or the update is empty.',
    content: errorContent({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: { fields: { facebookUrl: ['Use an HTTPS Facebook URL.'] } },
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
  415: {
    description: 'The request body is not JSON.',
    content: errorContent({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.', details: {} },
    }),
  },
} as const
