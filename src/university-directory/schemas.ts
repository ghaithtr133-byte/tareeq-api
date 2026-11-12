import { z } from '@hono/zod-openapi'

import { publicationStatusSchema } from '../content/schemas.js'
import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import {
  programDurationUnits,
  programStudyLevels,
  teachingLanguages,
  tuitionBillingPeriods,
  universityTypes,
} from './types.js'

export const programStudyLevelSchema = z.enum(programStudyLevels).openapi('ProgramStudyLevel')
export const teachingLanguageSchema = z.enum(teachingLanguages).openapi('TeachingLanguage')
export const universityTypeSchema = z.enum(universityTypes).openapi('UniversityType')
export const programDurationUnitSchema = z.enum(programDurationUnits).openapi('ProgramDurationUnit')
export const tuitionBillingPeriodSchema = z.enum(tuitionBillingPeriods).openapi('TuitionBillingPeriod')
export const directorySlugSchema = z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const pageFields = {
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12),
}
const searchSchema = z.string().trim().min(1).max(200).optional()
const featuredSchema = z.enum(['true', 'false']).transform((value) => value === 'true').optional()

export const universityDirectoryFilterFields = {
  search: searchSchema,
  country: directorySlugSchema.optional(),
  featured: featuredSchema,
  major: directorySlugSchema.optional(),
  studyLevel: programStudyLevelSchema.optional(),
  language: teachingLanguageSchema.optional(),
  city: directorySlugSchema.optional(),
  universityType: universityTypeSchema.optional(),
}

export const filterOptionsQuerySchema = z.object(universityDirectoryFilterFields).strict()
const programFilterFields = {
  ...pageFields,
  search: searchSchema,
  studyLevel: programStudyLevelSchema.optional(),
  language: teachingLanguageSchema.optional(),
  faculty: z.string().trim().min(1).max(200).optional(),
}
export const programListQuerySchema = z.object(programFilterFields).strict()
export const adminProgramListQuerySchema = z.object({ ...programFilterFields, status: publicationStatusSchema.optional() }).strict()
export const majorListQuerySchema = z.object({ ...pageFields, search: searchSchema }).strict()
export const cityListQuerySchema = z.object({ ...pageFields, search: searchSchema, countryId: z.uuid().optional() }).strict()
export const universitySlugParamSchema = z.object({ slug: directorySlugSchema })
export const universityIdParamSchema = z.object({ universityId: z.uuid() })
export const directoryIdParamSchema = z.object({ id: z.uuid() })

const httpsUrlSchema = z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS official source URL.')
const localizedOptionalSchema = z.string().trim().min(1).max(300).nullable().optional()
const isoCurrencies = new Set(Intl.supportedValuesOf('currency'))
const tuitionFields = {
  amount: z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Use a non-negative decimal amount with at most two fractional digits.'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use an uppercase ISO 4217 currency code.').refine((value) => isoCurrencies.has(value), 'Use a recognized ISO 4217 currency code.'),
  billingPeriod: tuitionBillingPeriodSchema,
  academicYear: z.string().regex(/^\d{4}\/\d{4}$/, 'Use academic year format YYYY/YYYY.').refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 'Academic year must contain consecutive years.'),
}
const tuitionSchema = z.object(tuitionFields).strict().openapi('UniversityProgramTuitionInput')
const programFields = {
  academicMajorId: z.uuid(),
  nameAr: z.string().trim().min(1).max(300),
  nameEn: localizedOptionalSchema,
  facultyNameAr: localizedOptionalSchema,
  facultyNameEn: localizedOptionalSchema,
  durationValue: z.number().int().min(1).max(240).nullable().optional(),
  durationUnit: programDurationUnitSchema.nullable().optional(),
  studyLevel: programStudyLevelSchema,
  languages: z.array(teachingLanguageSchema).min(1).max(teachingLanguages.length).superRefine((items, context) => {
    if (new Set(items).size !== items.length) context.addIssue({ code: 'custom', message: 'Duplicate teaching languages are not allowed.' })
  }),
  status: publicationStatusSchema.optional().default('DRAFT'),
  officialSourceUrl: httpsUrlSchema,
  verifiedAt: z.iso.datetime({ offset: true }),
  tuition: tuitionSchema.optional(),
}
const durationPair = (value: { durationValue?: number | null | undefined; durationUnit?: string | null | undefined }, context: z.RefinementCtx) => {
  const hasValue = value.durationValue !== undefined && value.durationValue !== null
  const hasUnit = value.durationUnit !== undefined && value.durationUnit !== null
  if (hasValue !== hasUnit) context.addIssue({ code: 'custom', path: ['durationValue'], message: 'Duration value and unit must be provided or cleared together.' })
  if (hasValue && value.durationUnit === 'YEARS' && value.durationValue! > 20) context.addIssue({ code: 'custom', path: ['durationValue'], message: 'Duration in years cannot exceed 20.' })
}
export const programCreateSchema = z.object(programFields).strict().superRefine(durationPair).openapi('UniversityProgramCreateRequest')
export const programUpdateSchema = z.object(programFields).partial().strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided.' }).superRefine(durationPair).openapi('UniversityProgramUpdateRequest')
export const academicMajorCreateSchema = z.object({
  slug: directorySlugSchema,
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120).nullable().optional().default(null),
}).strict().openapi('AcademicMajorCreateRequest')
export const academicMajorUpdateSchema = academicMajorCreateSchema.partial().strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.').openapi('AcademicMajorUpdateRequest')
export const cityCreateSchema = z.object({
  countryId: z.uuid(), slug: directorySlugSchema,
  nameAr: z.string().trim().min(1).max(200), nameEn: z.string().trim().min(1).max(200),
}).strict().openapi('CityCreateRequest')
export const cityUpdateSchema = cityCreateSchema.partial().strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.').openapi('CityUpdateRequest')

const dateSchema = z.iso.datetime({ offset: true })
const majorSchema = z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string(), category: z.string().nullable() }).openapi('AcademicMajorSummary')
const tuitionResponseSchema = z.object({ ...tuitionFields, id: z.uuid(), createdAt: dateSchema, updatedAt: dateSchema }).strict().openapi('UniversityProgramTuition')
const programPublicSchema = z.object({
  id: z.uuid(), nameAr: z.string().nullable(), nameEn: z.string().nullable(),
  facultyNameAr: z.string().nullable(), facultyNameEn: z.string().nullable(),
  durationValue: z.number().int().nullable(), durationUnit: programDurationUnitSchema.nullable(),
  academicMajor: majorSchema, studyLevel: programStudyLevelSchema,
  languages: z.array(teachingLanguageSchema), officialSourceUrl: z.string(),
  verifiedAt: dateSchema, publishedAt: dateSchema.nullable(),
  tuition: tuitionResponseSchema.nullable(), tuitionFees: z.array(tuitionResponseSchema),
}).openapi('PublicUniversityProgram')
const programAdminSchema = programPublicSchema.extend({
  universityId: z.uuid(), academicMajorId: z.uuid(), status: publicationStatusSchema,
  createdAt: dateSchema, updatedAt: dateSchema,
}).openapi('AdminUniversityProgram')
const majorAdminSchema = majorSchema.extend({ createdAt: dateSchema, updatedAt: dateSchema }).openapi('AcademicMajor')
const citySchema = z.object({
  id: z.uuid(), countryId: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string(),
  createdAt: dateSchema, updatedAt: dateSchema,
  country: z.object({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string().nullable() }).optional(),
}).openapi('City')
const paginationSchema = z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int() })
const paginated = <T extends z.ZodType>(item: T) => successEnvelopeSchema(z.object({ items: z.array(item), pagination: paginationSchema }))

export const publicProgramListResponseSchema = paginated(programPublicSchema).openapi('PublicUniversityProgramListResponse')
export const adminProgramListResponseSchema = paginated(programAdminSchema).openapi('AdminUniversityProgramListResponse')
export const adminProgramResponseSchema = successEnvelopeSchema(programAdminSchema).openapi('AdminUniversityProgramResponse')
export const majorListResponseSchema = paginated(majorAdminSchema).openapi('AcademicMajorListResponse')
export const majorResponseSchema = successEnvelopeSchema(majorAdminSchema).openapi('AcademicMajorResponse')
export const cityListResponseSchema = paginated(citySchema).openapi('CityListResponse')
export const cityResponseSchema = successEnvelopeSchema(citySchema).openapi('CityResponse')

const facetSchema = z.object({ value: z.string(), count: z.number().int().min(1) })
export const filterOptionsResponseSchema = successEnvelopeSchema(z.object({
  majors: z.array(facetSchema.extend({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string(), category: z.string().nullable() })),
  studyLevels: z.array(facetSchema), languages: z.array(facetSchema),
  cities: z.array(facetSchema.extend({ id: z.uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string(), countryId: z.uuid() })),
  universityTypes: z.array(facetSchema),
})).openapi('UniversityFilterOptionsResponse')

const errorContent = (code: string, message: string) => ({ 'application/json': { schema: errorResponseSchema, example: { success: false, error: { code, message, details: {} } } } })
export const directoryErrorResponses = {
  400: { description: 'Validation, relationship, or publication prerequisite error.', content: errorContent('VALIDATION_ERROR', 'The request contains invalid fields.') },
  401: { description: 'Authentication is required.', content: errorContent('AUTHENTICATION_REQUIRED', 'Authentication is required.') },
  403: { description: 'ADMIN or SUPER_ADMIN permission and trusted origin are required.', content: errorContent('FORBIDDEN', 'Insufficient permissions.') },
  404: { description: 'University or program not found.', content: errorContent('UNIVERSITY_PROGRAM_NOT_FOUND', 'University program not found.') },
  409: { description: 'The slug or normalized program already exists.', content: errorContent('DIRECTORY_SLUG_OR_PROGRAM_CONFLICT', 'The slug or university program already exists.') },
  415: { description: 'Content-Type must be JSON.', content: errorContent('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.') },
} as const
