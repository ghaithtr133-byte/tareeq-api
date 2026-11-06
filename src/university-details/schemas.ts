import { z } from '@hono/zod-openapi'

import { publicationStatusSchema } from '../content/schemas.js'
import { errorResponseSchema, successEnvelopeSchema } from '../shared/http.js'
import { programStudyLevelSchema } from '../university-directory/schemas.js'
import { programStudyLevels } from '../university-directory/types.js'
import { admissionRequirementScopes } from './types.js'

export const admissionRequirementScopeSchema = z.enum(admissionRequirementScopes).openapi('AdmissionRequirementScope')
const uuid = z.uuid()
const date = z.iso.datetime({ offset: true })
const httpsUrl = z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS URL.')
const pageFields = { page: z.coerce.number().int().min(1).optional().default(1), limit: z.coerce.number().int().min(1).max(100).optional().default(50) }

export const detailSlugParamSchema = z.object({ slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })
export const detailUniversityParamSchema = z.object({ universityId: uuid })
export const detailIdParamSchema = z.object({ id: uuid })
export const detailsListQuerySchema = z.object({ ...pageFields, status: publicationStatusSchema.optional() }).strict()
export const admissionListQuerySchema = z.object({ ...pageFields, status: publicationStatusSchema.optional(), scope: admissionRequirementScopeSchema.optional() }).strict()

const nullableText = z.string().trim().min(1).max(20_000).nullable().optional()
const nullableProgramStudyLevelSchema = z.enum(programStudyLevels).nullable()
const admissionCreateBase = z.object({
  scope: admissionRequirementScopeSchema,
  studyLevel: nullableProgramStudyLevelSchema.optional().default(null),
  programId: uuid.nullable().optional().default(null),
  contentAr: z.string().trim().min(1).max(20_000),
  contentEn: nullableText,
  status: publicationStatusSchema.optional().default('DRAFT'),
  officialSourceUrl: httpsUrl.nullable().optional().default(null),
  verifiedAt: date.nullable().optional().default(null),
}).strict()
const scopeShape = (value: { scope: string; studyLevel?: string | null; programId?: string | null }, context: z.RefinementCtx) => {
  const valid = value.scope === 'UNIVERSITY'
    ? !value.studyLevel && !value.programId
    : value.scope === 'STUDY_LEVEL'
      ? Boolean(value.studyLevel) && !value.programId
      : !value.studyLevel && Boolean(value.programId)
  if (!valid) context.addIssue({ code: 'custom', path: ['scope'], message: 'UNIVERSITY has no target, STUDY_LEVEL requires studyLevel, and PROGRAM requires programId.' })
}
export const admissionCreateSchema = admissionCreateBase.superRefine(scopeShape).openapi('UniversityAdmissionRequirementCreateRequest')
export const admissionUpdateSchema = z.object({
  contentAr: z.string().trim().min(1).max(20_000).optional(),
  contentEn: nullableText,
  status: publicationStatusSchema.optional(),
  officialSourceUrl: httpsUrl.nullable().optional(),
  verifiedAt: date.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.').openapi('UniversityAdmissionRequirementUpdateRequest')

export const galleryCreateSchema = z.object({
  imageUrl: httpsUrl,
  altAr: z.string().trim().min(1).max(500).nullable().optional().default(null),
  altEn: z.string().trim().min(1).max(500).nullable().optional().default(null),
  status: publicationStatusSchema.optional().default('DRAFT'),
}).strict().openapi('UniversityGalleryImageCreateRequest')
export const galleryUpdateSchema = galleryCreateSchema.partial().strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.').openapi('UniversityGalleryImageUpdateRequest')
export const galleryReorderSchema = z.object({ orderedIds: z.array(uuid).max(100).superRefine((items, context) => {
  if (new Set(items).size !== items.length) context.addIssue({ code: 'custom', message: 'Duplicate image IDs are not allowed.' })
}) }).strict().openapi('UniversityGalleryReorderRequest')

const programSummarySchema = z.object({ id: uuid, nameAr: z.string().nullable(), nameEn: z.string().nullable(), studyLevel: programStudyLevelSchema })
const admissionPublicSchema = z.object({
  id: uuid, scope: admissionRequirementScopeSchema, studyLevel: nullableProgramStudyLevelSchema, programId: uuid.nullable(),
  contentAr: z.string(), contentEn: z.string().nullable(), officialSourceUrl: z.string().nullable(), verifiedAt: date.nullable(), publishedAt: date.nullable(), program: programSummarySchema.nullable(),
})
const admissionAdminSchema = admissionPublicSchema.extend({ universityId: uuid, status: publicationStatusSchema, createdAt: date, updatedAt: date })
const galleryPublicSchema = z.object({ id: uuid, imageUrl: z.string(), altAr: z.string().nullable(), altEn: z.string().nullable(), displayOrder: z.number().int(), publishedAt: date.nullable() })
const galleryAdminSchema = galleryPublicSchema.extend({ universityId: uuid, status: publicationStatusSchema, createdAt: date, updatedAt: date })
const pagination = z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int() })

export const publicAdmissionResponseSchema = successEnvelopeSchema(z.object({ university: z.array(admissionPublicSchema), studyLevels: z.array(admissionPublicSchema), programs: z.array(admissionPublicSchema) })).openapi('PublicUniversityAdmissionRequirementsResponse')
export const adminAdmissionListResponseSchema = successEnvelopeSchema(z.object({ items: z.array(admissionAdminSchema), pagination })).openapi('AdminUniversityAdmissionRequirementListResponse')
export const adminAdmissionResponseSchema = successEnvelopeSchema(admissionAdminSchema).openapi('AdminUniversityAdmissionRequirementResponse')
export const publicGalleryResponseSchema = successEnvelopeSchema(z.object({ items: z.array(galleryPublicSchema) })).openapi('PublicUniversityGalleryResponse')
export const adminGalleryListResponseSchema = successEnvelopeSchema(z.object({ items: z.array(galleryAdminSchema), pagination })).openapi('AdminUniversityGalleryListResponse')
export const adminGalleryResponseSchema = successEnvelopeSchema(galleryAdminSchema).openapi('AdminUniversityGalleryResponse')
export const galleryReorderResponseSchema = successEnvelopeSchema(z.object({ items: z.array(galleryAdminSchema) })).openapi('AdminUniversityGalleryReorderResponse')
export const galleryDetachResponseSchema = successEnvelopeSchema(z.object({ id: uuid })).openapi('AdminUniversityGalleryDetachResponse')

const errorContent = (code: string, message: string) => ({ 'application/json': { schema: errorResponseSchema, example: { success: false, error: { code, message, details: {} } } } })
export const universityDetailsErrors = {
  400: { description: 'Validation or relationship error.', content: errorContent('VALIDATION_ERROR', 'The request contains invalid fields.') },
  401: { description: 'Authentication required.', content: errorContent('AUTHENTICATION_REQUIRED', 'Authentication is required.') },
  403: { description: 'Trusted ADMIN or SUPER_ADMIN required.', content: errorContent('FORBIDDEN', 'Insufficient permissions.') },
  404: { description: 'University or detail entry not found.', content: errorContent('UNIVERSITY_DETAIL_NOT_FOUND', 'University detail entry not found.') },
  409: { description: 'Reorder set is stale or incomplete.', content: errorContent('GALLERY_ORDER_SET_MISMATCH', 'Submit every active gallery image exactly once.') },
  415: { description: 'JSON Content-Type required.', content: errorContent('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.') },
} as const
