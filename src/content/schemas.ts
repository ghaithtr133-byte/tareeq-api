import { z } from '@hono/zod-openapi'

import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import { programStudyLevels, teachingLanguages, universityTypes } from '../university-directory/types.js'
import type { ContentResource } from './types.js'
import { assignedIsoCountryCodes } from './iso-country-codes.js'

export const publicationStatusSchema = z
  .enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  .openapi('PublicationStatus')
export const applicationStatusSchema = z
  .enum(['OPEN', 'CLOSED'])
  .openapi('ScholarshipApplicationStatus')
export const scholarshipOptionTypeSchema = z.enum(['STUDY_LEVEL', 'FUNDING_TYPE']).openapi('ScholarshipOptionType')
export const scholarshipOptionQuerySchema = z.object({ type: scholarshipOptionTypeSchema }).strict()
export const adminScholarshipOptionQuerySchema = scholarshipOptionQuerySchema.extend({ activeOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional() }).strict()
export const scholarshipOptionCreateSchema = z.object({ type: scholarshipOptionTypeSchema, nameAr: z.string().trim().min(1).max(200), isActive: z.boolean().optional().default(true), sortOrder: z.number().int().min(0).max(1_000_000).optional().default(0) }).strict().openapi('ScholarshipOptionCreateRequest')
export const scholarshipOptionUpdateSchema = scholarshipOptionCreateSchema.omit({ type: true }).partial().strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.').openapi('ScholarshipOptionUpdateRequest')
export const universityTypeSchema = z.enum(universityTypes).openapi('UniversityType')
const nullableUniversityTypeSchema = z.enum(universityTypes).nullable()

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
const optionalNullableUrl = webUrlSchema.nullable().optional()
const optionalNullableArabicText = z.string().trim().min(1).max(20_000).nullable().optional()
const safeArabicRichText = z.string().trim().max(20_000).refine(
  (value) => !/(?:<\s*\/?\s*(?:script|style|iframe|object|embed)|\bon\w+\s*=|javascript\s*:)/i.test(value),
  'Rich text contains unsupported or unsafe markup.',
)
const studyGuideSectionSchema = z.object({
  section: z.enum(['ACADEMIC_SYSTEM', 'ADMISSION_DOCUMENTS', 'COSTS_STUDENT_LIFE']),
  contentAr: safeArabicRichText.nullable(),
}).strict()
const serviceDetailInputSchema = z.object({
  id: z.uuid().optional(),
  kind: z.enum(['STEP', 'BENEFIT']),
  titleAr: z.string().trim().min(1).max(300),
  descriptionAr: safeArabicRichText.nullable().optional(),
  iconKey: z.string().trim().min(1).max(80).nullable().optional(),
}).strict()
const countryCodeSchema = z.string().trim().toUpperCase().refine(
  (value) => assignedIsoCountryCodes.has(value),
  'Use an assigned ISO 3166-1 alpha-2 country code.',
)

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
    overviewImageUrl: optionalNullableUrl,
    overviewImageAltAr: z.string().trim().min(1).max(300).nullable().optional(),
    studyLanguageAr: optionalNullableArabicText,
    tuitionSummaryAr: optionalNullableArabicText,
    admissionSummaryAr: optionalNullableArabicText,
    applicationDatesSummaryAr: optionalNullableArabicText,
    studyGuideSections: z.array(studyGuideSectionSchema).max(3).superRefine((items, context) => {
      if (new Set(items.map((item) => item.section)).size !== items.length) context.addIssue({ code: 'custom', message: 'Each fixed study-guide section may be supplied only once.' })
    }).optional(),
    countryCode: countryCodeSchema.nullable().optional(),
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
    cityId: z.uuid().nullable().optional(),
    universityType: nullableUniversityTypeSchema.optional(),
    cityAr: z.string().trim().min(1).max(200),
    cityEn: z.string().trim().min(1).max(200).optional(),
    overviewAr: requiredArabicText,
    summaryAr: safeArabicRichText.nullable().optional(),
    overviewEn: optionalText,
    officialWebsite: optionalUrl,
    imageUrl: optionalUrl,
    imageAltAr: z.string().trim().min(1).max(300).optional(),
    imageAltEn: z.string().trim().min(1).max(300).optional(),
    logoUrl: optionalUrl,
    logoAltAr: z.string().trim().min(1).max(300).optional(),
    logoAltEn: z.string().trim().min(1).max(300).optional(),
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
    summaryAr: safeArabicRichText.nullable().optional(),
    requirementsAr: safeArabicRichText,
    requirementsEn: optionalText,
    descriptionAr: safeArabicRichText,
    descriptionEn: optionalText,
    imageUrl: optionalUrl,
    imageAltAr: z.string().trim().min(1).max(300).optional(),
    imageAltEn: z.string().trim().min(1).max(300).optional(),
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
    detailItems: z.array(serviceDetailInputSchema).max(100).superRefine((items, context) => {
      const ids = items.flatMap((item) => item.id ? [item.id] : [])
      if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate service detail IDs are not allowed.' })
    }).optional(),
    ...commonCreateFields,
  })
  .strict()
  .openapi('ServiceCreateRequest')

const articleFields = {
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
    scholarshipIds: z.array(z.uuid()).max(50).superRefine((items, context) => {
      if (new Set(items).size !== items.length) context.addIssue({ code: 'custom', message: 'Duplicate Scholarship IDs are not allowed.' })
    }).optional(),
    ...commonCreateFields,
  }
const articleAssociationRules = (value: { scholarshipId?: string | null | undefined; scholarshipIds?: string[] | undefined }, context: z.RefinementCtx) => {
  const hasLegacy = Object.prototype.hasOwnProperty.call(value, 'scholarshipId')
  const hasMultiple = Object.prototype.hasOwnProperty.call(value, 'scholarshipIds')
  if (!hasLegacy || !hasMultiple) return
  const ids = value.scholarshipIds ?? []
  const consistent = value.scholarshipId === null ? ids.length === 0 : ids[0] === value.scholarshipId
  if (!consistent) context.addIssue({ code: 'custom', path: ['scholarshipIds'], message: 'When both fields are supplied, scholarshipId must equal the first scholarshipIds item; null requires an empty array.' })
}
export const articleCreateSchema = z
  .object(articleFields)
  .strict()
  .superRefine(articleAssociationRules)
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
  articles: z.object(articleFields).partial().strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided.' })
    .superRefine(articleAssociationRules)
    .openapi('ArticlePatchRequest'),
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
  overviewImageUrl: z.string().nullable(), overviewImageAltAr: z.string().nullable(),
  studyLanguageAr: z.string().nullable(), tuitionSummaryAr: z.string().nullable(),
  admissionSummaryAr: z.string().nullable(), applicationDatesSummaryAr: z.string().nullable(),
  studyGuideSections: z.array(z.object({ id: z.uuid(), section: z.enum(['ACADEMIC_SYSTEM', 'ADMISSION_DOCUMENTS', 'COSTS_STUDENT_LIFE']).nullable(), titleAr: z.string(), bodyAr: z.string(), displayOrder: z.number().int() })).optional(),
  countryCode: z.string().nullable(),
  displayOrder: z.number().int(),
  ...adminFields,
}).openapi('Country')

export const universitySchema = z.object({
  ...entityBase,
  nameAr: z.string(), nameEn: z.string().nullable(), officialName: z.string(),
  countryId: z.uuid(), cityId: z.uuid().nullable(), universityType: nullableUniversityTypeSchema, cityAr: z.string(), cityEn: z.string().nullable(),
  overviewAr: z.string(), overviewEn: z.string().nullable(), summaryAr: z.string().nullable(), officialWebsite: z.string().nullable(),
  imageUrl: z.string().nullable(), imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(),
  logoUrl: z.string().nullable(), logoAltAr: z.string().nullable(), logoAltEn: z.string().nullable(),
  displayOrder: z.number().int(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), countryCode: z.string().nullable() }).optional(),
  city: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string() }).nullable().optional(),
  ...adminFields,
}).openapi('University')

export const scholarshipSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), countryId: z.uuid().nullable(), universityId: z.uuid().nullable(),
  studyLevel: z.string(), fundingType: z.string(), summaryAr: z.string().nullable(), requirementsAr: z.string(), requirementsEn: z.string().nullable(),
  descriptionAr: z.string(), descriptionEn: z.string().nullable(), verifiedDeadline: nullableDateSchema,
  imageUrl: z.string().nullable(), imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(),
  officialSourceUrl: z.string().nullable(), applicationStatus: applicationStatusSchema,
  displayOrder: z.number().int(),
  effectiveApplicationStatus: applicationStatusSchema.optional(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), countryCode: z.string().nullable() }).nullable().optional(),
  university: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  ...adminFields,
}).openapi('Scholarship')

export const serviceSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), summaryAr: z.string(), summaryEn: z.string().nullable(),
  descriptionAr: z.string(), descriptionEn: z.string().nullable(), imageUrl: z.string().nullable(),
  imageAltAr: z.string().nullable(), imageAltEn: z.string().nullable(), displayOrder: z.number().int(),
  detailItems: z.array(z.object({ id: z.uuid(), kind: z.enum(['STEP', 'BENEFIT']), titleAr: z.string(), descriptionAr: z.string().nullable(), iconKey: z.string().nullable(), displayOrder: z.number().int() })).optional(),
  ...adminFields,
}).openapi('Service')

export const articleSchema = z.object({
  ...entityBase,
  titleAr: z.string(), titleEn: z.string().nullable(), summaryAr: z.string(), summaryEn: z.string().nullable(),
  bodyAr: z.array(richTextBlockSchema), bodyEn: z.array(richTextBlockSchema).nullable(),
  coverImageUrl: z.string().nullable(), coverImageAltAr: z.string().nullable(), coverImageAltEn: z.string().nullable(),
  countryId: z.uuid().nullable(), universityId: z.uuid().nullable(), scholarshipId: z.uuid().nullable(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), countryCode: z.string().nullable() }).nullable().optional(),
  university: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable().optional(),
  scholarship: z.object({ id: z.uuid(), slug: z.string(), titleAr: z.string() }).nullable().optional(),
  displayOrder: z.number().int(),
  ...adminFields,
}).openapi('Article')

export const relatedScholarshipSchema = z.object({
  id: z.uuid(), slug: z.string(), titleAr: z.string(), imageUrl: z.string().nullable(),
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string() }).nullable(),
  effectiveApplicationStatus: applicationStatusSchema,
}).openapi('ArticleRelatedScholarship')

export const articleDetailSchema = articleSchema.extend({
  scholarshipIds: z.array(z.uuid()),
  relatedScholarships: z.array(relatedScholarshipSchema),
}).openapi('ArticleDetail')

const publicArticleDetailSchema = articleDetailSchema.omit({
  status: true, createdAt: true, updatedAt: true,
  country: true, university: true, scholarship: true,
  scholarshipIds: true,
})

const publicScholarshipDetailItemSchema = z.object({
  id: z.uuid(),
  scholarshipId: z.uuid(),
  kind: z.enum(['BENEFIT', 'REQUIREMENT', 'APPLICATION_STEP']),
  titleAr: z.string(),
  descriptionAr: z.string().nullable(),
  displayOrder: z.number().int(),
  category: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  coveragePeriod: z.string().nullable(),
  officialSourceUrl: z.string().nullable(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
})

export const contentEntitySchemas = {
  countries: countrySchema,
  universities: universitySchema,
  scholarships: scholarshipSchema,
  services: serviceSchema,
  articles: articleSchema,
} as const

export const publicContentEntitySchemas = {
  countries: countrySchema.omit({ status: true, createdAt: true, updatedAt: true, studyLanguageAr: true, tuitionSummaryAr: true, admissionSummaryAr: true, applicationDatesSummaryAr: true, studyGuideSections: true }).extend({
    studentFacts: z.object({ studyLanguageAr: z.string().nullable(), tuitionSummaryAr: z.string().nullable(), admissionSummaryAr: z.string().nullable(), applicationDatesSummaryAr: z.string().nullable() }),
    studyGuide: z.array(z.object({ id: z.uuid(), section: z.enum(['ACADEMIC_SYSTEM', 'ADMISSION_DOCUMENTS', 'COSTS_STUDENT_LIFE']).nullable(), titleAr: z.string(), bodyAr: z.string(), displayOrder: z.number().int() })),
  }).openapi('PublicCountry'),
  universities: universitySchema.omit({ status: true, createdAt: true, updatedAt: true }),
  scholarships: scholarshipSchema.omit({ status: true, createdAt: true, updatedAt: true }).extend({
    benefitsAr: z.array(publicScholarshipDetailItemSchema),
    requirementItemsAr: z.array(publicScholarshipDetailItemSchema),
    applicationStepsAr: z.array(publicScholarshipDetailItemSchema),
  }).openapi('PublicScholarship'),
  services: serviceSchema.omit({ status: true, createdAt: true, updatedAt: true }),
  articles: articleSchema.omit({ status: true, createdAt: true, updatedAt: true, scholarship: true }),
} as const

export const paginationSchema = z.object({
  page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
}).openapi('Pagination')
const scholarshipOptionSchema = z.object({ id: z.uuid(), type: scholarshipOptionTypeSchema, code: z.string(), nameAr: z.string(), isActive: z.boolean(), sortOrder: z.number().int(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }) }).openapi('ScholarshipOption')
export const scholarshipOptionListResponseSchema = successEnvelopeSchema(z.object({ items: z.array(scholarshipOptionSchema) })).openapi('ScholarshipOptionListResponse')
export const scholarshipOptionResponseSchema = successEnvelopeSchema(scholarshipOptionSchema).openapi('ScholarshipOptionResponse')

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
      major: slugSchema.optional().openapi({ description: 'Academic Major slug. Combined P1 filters must match one published program.' }),
      studyLevel: z.enum(programStudyLevels).optional().openapi({ example: 'BACHELORS' }),
      language: z.enum(teachingLanguages).optional().openapi({ example: 'ENGLISH' }),
      city: slugSchema.optional().openapi({ description: 'Normalized City slug.' }),
      universityType: universityTypeSchema.optional(),
      featured: featuredQuery,
        sort: z.enum(['newest', 'name']).optional().openapi({ description: 'When omitted on the public directory, use persisted editorial display order. Explicit values sort newest first or by Arabic name.' }),
    },
    scholarships: {
      search: searchQuery,
      country: slugSchema.optional().openapi({ description: 'Related Country slug.' }),
      university: slugSchema.optional().openapi({ description: 'Exact related University slug. This legacy filter keeps its existing meaning.' }),
      studyLevel: z.string().trim().min(1).max(120).optional().openapi({ description: 'Scholarship study-level field; this is distinct from universityStudyLevel.', example: 'MASTERS' }),
      fundingType: z.string().trim().min(1).max(120).optional().openapi({ example: 'FULL' }),
      applicationStatus: applicationStatusSchema.optional().openapi({ description: 'Effective OPEN/CLOSED state; passed verified deadlines count as CLOSED.' }),
      featured: featuredQuery,
      universitySearch: searchQuery.openapi({ description: 'Match the associated published University by Arabic/English name, official name, or Arabic city name.', example: 'Bucharest' }),
      universityCountry: slugSchema.optional().openapi({ description: 'Country slug of the associated published University; distinct from the Scholarship country filter.', example: 'romania' }),
      universityMajor: slugSchema.optional().openapi({ description: 'Academic Major slug on the same published University Program used by the other university program filters.', example: 'medicine' }),
      universityStudyLevel: z.enum(programStudyLevels).optional().openapi({ description: 'Controlled study level on the same published University Program; distinct from the Scholarship studyLevel field.', example: 'BACHELORS' }),
      universityLanguage: z.enum(teachingLanguages).optional().openapi({ description: 'Teaching language on the same published University Program.', example: 'ENGLISH' }),
      universityCity: slugSchema.optional().openapi({ description: 'Normalized City slug of the associated published University.', example: 'bucharest' }),
      universityType: universityTypeSchema.optional().openapi({ description: 'Type of the associated published University.' }),
      universityFeatured: featuredQuery.openapi({ description: 'Filter by the associated published University featured state.', example: 'true' }),
        sort: z.enum(['newest', 'deadline']).optional().openapi({ description: 'When omitted on the public directory, use persisted editorial display order. Featured Scholarships remain first for every sort; explicit values sort within each Featured tier.' }),
    },
    services: {
      featured: featuredQuery,
      sort: z.enum(['manual', 'newest']).optional().default('manual').openapi({ description: 'Sort by display order or newest creation time.' }),
    },
    articles: {
      search: searchQuery,
      country: slugSchema.optional().openapi({ description: 'Related Country slug.' }),
      featured: featuredQuery,
        sort: z.literal('newest').optional().openapi({ description: 'When omitted on the public directory, use persisted editorial display order. Explicit newest sorting remains available.' }),
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
export const contentReorderSchema = z.object({
  orderedIds: z.array(z.uuid()).max(500).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate IDs are not allowed.' })
  }),
}).strict().openapi('ContentReorderRequest')
export const contentReorderResponseSchema = successEnvelopeSchema(z.object({
  items: z.array(z.object({ id: z.uuid(), displayOrder: z.number().int() })),
})).openapi('ContentReorderResponse')
export const deletionImpactItemSchema = z.object({
  resourceType: z.string(), effect: z.enum(['DELETE', 'SET_NULL', 'UNLINK', 'PRESERVE', 'BLOCK', 'UNKNOWN']),
  count: z.number().int().nonnegative(), relationshipPath: z.string(), sampleIds: z.array(z.uuid()),
  code: z.string(), canConfirm: z.boolean(), blocked: z.boolean(),
}).openapi('DeletionImpactItem')
export const deletionImpactSchema = z.object({
  target: z.object({ resource: z.enum(['countries', 'universities', 'scholarships', 'services']), id: z.uuid(), slug: z.string(), status: publicationStatusSchema }),
  outcome: z.enum(['SAFE', 'REQUIRES_CONFIRMATION', 'BLOCKED']),
  items: z.array(deletionImpactItemSchema),
}).openapi('DeletionImpact')
export const contentDeleteResponseSchema = successEnvelopeSchema(z.object({
  id: z.uuid(),
  impact: deletionImpactSchema,
})).openapi('ContentDeleteResponse')
export const hardDeleteConfirmationSchema = z.object({
  challengeId: z.uuid(),
}).strict().openapi('HardDeleteConfirmationRequest')
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
    resource === 'articles'
      ? admin ? articleDetailSchema : publicArticleDetailSchema
      : admin ? contentEntitySchemas[resource] : publicContentEntitySchemas[resource],
  )
export const listResponseSchema = (resource: ContentResource, admin = false) =>
  successEnvelopeSchema(z.object({
    items: z.array(
      admin ? contentEntitySchemas[resource] : publicContentEntitySchemas[resource],
    ),
    pagination: paginationSchema,
  }))
