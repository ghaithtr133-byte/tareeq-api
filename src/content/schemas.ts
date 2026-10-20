import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import type { ContentResource } from './types.js'

export const publicationStatusSchema = z
  .enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  .openapi('PublicationStatus')
export const applicationStatusSchema = z
  .enum(['OPEN', 'CLOSED'])
  .openapi('ScholarshipApplicationStatus')

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only.')
  .openapi({ example: 'study-in-germany' })
const requiredArabicText = z.string().trim().min(1).max(20_000)
const optionalText = z.string().trim().min(1).max(20_000).optional()
const webUrlSchema = z.url().max(2_048).refine(
  (value) => ['http:', 'https:'].includes(new URL(value).protocol),
  'Use an HTTP or HTTPS URL.',
)
const optionalUrl = webUrlSchema.optional()

export const richTextBlockSchema = z
  .object({
    type: z.enum([
      'paragraph',
      'heading2',
      'heading3',
      'bulleted-list',
      'numbered-list',
      'quote',
    ]),
    text: z.string().min(1).max(10_000),
  })
  .strict()
  .openapi('ArticleRichTextBlock')

const commonCreateFields = {
  slug: slugSchema,
  featured: z.boolean().optional().default(false),
  status: publicationStatusSchema.optional().default('DRAFT'),
  seoTitleAr: z.string().trim().min(1).max(120).optional(),
  seoDescriptionAr: z.string().trim().min(1).max(320).optional(),
}

export const countryCreateSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200).optional(),
    introductionAr: requiredArabicText,
    introductionEn: optionalText,
    detailsAr: requiredArabicText,
    detailsEn: optionalText,
    imageUrl: optionalUrl,
    imageAltAr: z.string().trim().min(1).max(300).optional(),
    imageAltEn: z.string().trim().min(1).max(300).optional(),
    displayOrder: z.number().int().min(0).max(1_000_000).optional().default(0),
    ...commonCreateFields,
  })
  .strict()
  .openapi('CountryCreateRequest')

export const universityCreateSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200).optional(),
    officialName: z.string().trim().min(1).max(300),
    countryId: z.uuid(),
    cityAr: z.string().trim().min(1).max(200),
    cityEn: z.string().trim().min(1).max(200).optional(),
    overviewAr: requiredArabicText,
    overviewEn: optionalText,
    officialWebsite: optionalUrl,
    imageUrl: optionalUrl,
    imageAltAr: z.string().trim().min(1).max(300).optional(),
    imageAltEn: z.string().trim().min(1).max(300).optional(),
    ...commonCreateFields,
  })
  .strict()
  .openapi('UniversityCreateRequest')

export const scholarshipCreateSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(300).optional(),
    countryId: z.uuid().nullable().optional(),
    universityId: z.uuid().nullable().optional(),
    studyLevel: z.string().trim().min(1).max(120),
    fundingType: z.string().trim().min(1).max(120),
    requirementsAr: requiredArabicText,
    requirementsEn: optionalText,
    descriptionAr: requiredArabicText,
    descriptionEn: optionalText,
    verifiedDeadline: z.iso.datetime({ offset: true }).nullable().optional(),
    officialSourceUrl: webUrlSchema.nullable().optional(),
    applicationStatus: applicationStatusSchema.optional().default('OPEN'),
    ...commonCreateFields,
  })
  .strict()
  .openapi('ScholarshipCreateRequest')

export const serviceCreateSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(300).optional(),
    summaryAr: requiredArabicText,
    summaryEn: optionalText,
    descriptionAr: requiredArabicText,
    descriptionEn: optionalText,
    imageUrl: optionalUrl,
    imageAltAr: z.string().trim().min(1).max(300).optional(),
    imageAltEn: z.string().trim().min(1).max(300).optional(),
    displayOrder: z.number().int().min(0).max(1_000_000).optional().default(0),
    ...commonCreateFields,
  })
  .strict()
  .openapi('ServiceCreateRequest')

export const articleCreateSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(300).optional(),
    summaryAr: requiredArabicText,
    summaryEn: optionalText,
    bodyAr: z.array(richTextBlockSchema).min(1).max(500),
    bodyEn: z.array(richTextBlockSchema).min(1).max(500).nullable().optional(),
    coverImageUrl: optionalUrl,
    coverImageAltAr: z.string().trim().min(1).max(300).optional(),
    coverImageAltEn: z.string().trim().min(1).max(300).optional(),
    countryId: z.uuid().nullable().optional(),
    universityId: z.uuid().nullable().optional(),
    scholarshipId: z.uuid().nullable().optional(),
    ...commonCreateFields,
  })
  .strict()
  .openapi('ArticleCreateRequest')

const nonEmptyPatch = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  })

export const contentCreateSchemas = {
  countries: countryCreateSchema,
  universities: universityCreateSchema,
  scholarships: scholarshipCreateSchema,
  services: serviceCreateSchema,
  articles: articleCreateSchema,
} as const

export const contentPatchSchemas = {
  countries: nonEmptyPatch(countryCreateSchema).openapi('CountryPatchRequest'),
  universities: nonEmptyPatch(universityCreateSchema).openapi('UniversityPatchRequest'),
  scholarships: nonEmptyPatch(scholarshipCreateSchema).openapi('ScholarshipPatchRequest'),
  services: nonEmptyPatch(serviceCreateSchema).openapi('ServicePatchRequest'),
  articles: nonEmptyPatch(articleCreateSchema).openapi('ArticlePatchRequest'),
} as const

const dateSchema = z.iso.datetime({ offset: true })
const nullableDateSchema = dateSchema.nullable()
const entityBase = {
  id: z.uuid(),
  slug: z.string(),
  featured: z.boolean(),
  publishedAt: nullableDateSchema,
  seoTitleAr: z.string().nullable(),
  seoDescriptionAr: z.string().nullable(),
}
const adminFields = {
  status: publicationStatusSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
}

export const countrySchema = z.object({
  ...entityBase,
  nameAr: z.string(), nameEn: z.string().nullable(),
  introductionAr: z.string(), introductionEn: z.string().nullable(),
  detailsAr: z.string(), detailsEn: z.string().nullable(),
  imageUrl: z.string().nullable(), imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(),
  displayOrder: z.number().int(),
  ...adminFields,
}).openapi('Country')

export const universitySchema = z.object({
  ...entityBase,
  nameAr: z.string(), nameEn: z.string().nullable(), officialName: z.string(),
  countryId: z.uuid(), cityAr: z.string(), cityEn: z.string().nullable(),
  overviewAr: z.string(), overviewEn: z.string().nullable(), officialWebsite: z.string().nullable(),
  imageUrl: z.string().nullable(), imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string().nullable() }).optional(),
  ...adminFields,
}).openapi('University')

export const scholarshipSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), countryId: z.uuid().nullable(), universityId: z.uuid().nullable(),
  studyLevel: z.string(), fundingType: z.string(), requirementsAr: z.string(), requirementsEn: z.string().nullable(),
  descriptionAr: z.string(), descriptionEn: z.string().nullable(), verifiedDeadline: nullableDateSchema,
  officialSourceUrl: z.string().nullable(), applicationStatus: applicationStatusSchema,
  effectiveApplicationStatus: applicationStatusSchema.optional(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  university: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  ...adminFields,
}).openapi('Scholarship')

export const serviceSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), summaryAr: z.string(), summaryEn: z.string().nullable(),
  descriptionAr: z.string(), descriptionEn: z.string().nullable(), imageUrl: z.string().nullable(),
  imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(), displayOrder: z.number().int(),
  ...adminFields,
}).openapi('Service')

export const articleSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), summaryAr: z.string(), summaryEn: z.string().nullable(),
  bodyAr: z.array(richTextBlockSchema), bodyEn: z.array(richTextBlockSchema).nullable(),
  coverImageUrl: z.string().nullable(), coverImageAltAr: z.string().nullable(), coverImageAltEn: z.string().nullable(),
  countryId: z.uuid().nullable(), universityId: z.uuid().nullable(), scholarshipId: z.uuid().nullable(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  university: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  scholarship: z.object({ id: z.uuid(), slug: z.string(), titleAr: z.string() }).nullable().optional(),
  ...adminFields,
}).openapi('Article')

export const contentEntitySchemas = {
  countries: countrySchema,
  universities: universitySchema,
  scholarships: scholarshipSchema,
  services: serviceSchema,
  articles: articleSchema,
} as const

export const publicContentEntitySchemas = {
  countries: countrySchema.omit({ status: true, createdAt: true, updatedAt: true }),
  universities: universitySchema.omit({ status: true, createdAt: true, updatedAt: true, country: true }),
  scholarships: scholarshipSchema.omit({ status: true, createdAt: true, updatedAt: true, country: true, university: true }),
  services: serviceSchema.omit({ status: true, createdAt: true, updatedAt: true }),
  articles: articleSchema.omit({ status: true, createdAt: true, updatedAt: true, country: true, university: true, scholarship: true }),
} as const

export const paginationSchema = z.object({
  page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
}).openapi('Pagination')

const pageQuery = {
  page: z.coerce.number().int().min(1).optional().default(1).openapi({
    description: 'One-based page number.', example: 1,
  }),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12).openapi({
    description: 'Items per page. The maximum is 50.', example: 12,
  }),
}
const featuredQuery = z.enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional()
  .openapi({ description: 'Filter by featured state.', example: 'true' })
const searchQuery = z.string().trim().min(1).max(200).optional().openapi({
  description: 'Case-insensitive text search.', example: 'الدراسة',
})

const queryFor = (resource: ContentResource) => {
  const resourceFields = {
    countries: {
      search: searchQuery,
      featured: featuredQuery,
      sort: z.enum(['manual', 'newest']).optional().default('manual').openapi({ description: 'Sort by display order or newest creation time.' }),
    },
    universities: {
      search: searchQuery,
      country: slugSchema.optional().openapi({ description: 'Related Country slug.' }),
      featured: featuredQuery,
      sort: z.enum(['newest', 'name']).optional().default('newest').openapi({ description: 'Sort newest first or by Arabic name.' }),
    },
    scholarships: {
      search: searchQuery,
      country: slugSchema.optional().openapi({ description: 'Related Country slug.' }),
      university: slugSchema.optional().openapi({ description: 'Related University slug.' }),
      studyLevel: z.string().trim().min(1).max(120).optional().openapi({ example: 'MASTERS' }),
      fundingType: z.string().trim().min(1).max(120).optional().openapi({ example: 'FULL' }),
      applicationStatus: applicationStatusSchema.optional().openapi({ description: 'Effective OPEN/CLOSED state; passed verified deadlines count as CLOSED.' }),
      featured: featuredQuery,
      sort: z.enum(['newest', 'deadline']).optional().default('newest').openapi({ description: 'Sort newest first or by earliest non-null deadline.' }),
    },
    services: {
      featured: featuredQuery,
      sort: z.enum(['manual', 'newest']).optional().default('manual').openapi({ description: 'Sort by display order or newest creation time.' }),
    },
    articles: {
      search: searchQuery,
      country: slugSchema.optional().openapi({ description: 'Related Country slug.' }),
      featured: featuredQuery,
      sort: z.literal('newest').optional().default('newest').openapi({ description: 'Sort newest first.' }),
    },
  }[resource]
  return z.object({ ...pageQuery, ...resourceFields }).strict()
}

export const publicQuerySchemas = {
  countries: queryFor('countries'),
  universities: queryFor('universities'),
  scholarships: queryFor('scholarships'),
  services: queryFor('services'),
  articles: queryFor('articles'),
} as const

export const adminQuerySchemas = {
  countries: queryFor('countries').extend({ status: publicationStatusSchema.optional().openapi({ description: 'Editorial publication status.' }) }),
  universities: queryFor('universities').extend({ status: publicationStatusSchema.optional().openapi({ description: 'Editorial publication status.' }) }),
  scholarships: queryFor('scholarships').extend({ status: publicationStatusSchema.optional().openapi({ description: 'Editorial publication status.' }) }),
  services: queryFor('services').extend({ status: publicationStatusSchema.optional().openapi({ description: 'Editorial publication status.' }) }),
  articles: queryFor('articles').extend({ status: publicationStatusSchema.optional().openapi({ description: 'Editorial publication status.' }) }),
} as const

export const uuidParamSchema = z.object({
  id: z.uuid().openapi({
    description: 'Administrative content UUID.',
    example: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d',
  }),
})
export const slugParamSchema = z.object({
  slug: slugSchema.openapi({ description: 'Stable public content slug.' }),
})

const contentErrorExample = {
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'The request contains invalid fields.',
    details: { fields: { titleAr: ['Invalid input: expected string, received undefined'] } },
  },
}

const errorContent = (example: unknown) => ({
  'application/json': { schema: errorResponseSchema, example },
})

export const contentErrorResponses = {
  400: {
    description: 'Validation, publication prerequisite, or relationship error.',
    content: errorContent(contentErrorExample),
  },
  401: {
    description: 'Authentication is required.',
    content: errorContent({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: {} },
    }),
  },
  403: {
    description: 'The administrator lacks permission or the request origin is not trusted.',
    content: errorContent({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions.', details: {} },
    }),
  },
  404: {
    description: 'The content record was not found or is not publicly available.',
    content: errorContent({
      success: false,
      error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found.', details: {} },
    }),
  },
  409: {
    description: 'The slug conflicts with an existing record or a published slug is immutable.',
    content: errorContent({
      success: false,
      error: {
        code: 'SLUG_CONFLICT',
        message: 'The slug is already in use.',
        details: { fields: { slug: ['Choose a unique slug.'] } },
      },
    }),
  },
  415: {
    description: 'The request body is not application/json.',
    content: errorContent({
      success: false,
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json.',
        details: {},
      },
    }),
  },
} as const

export const entityResponseSchema = (resource: ContentResource, admin = false) =>
  successEnvelopeSchema(
    admin ? contentEntitySchemas[resource] : publicContentEntitySchemas[resource],
  )
export const listResponseSchema = (resource: ContentResource, admin = false) =>
  successEnvelopeSchema(z.object({
    items: z.array(
      admin ? contentEntitySchemas[resource] : publicContentEntitySchemas[resource],
    ),
    pagination: paginationSchema,
  }))
