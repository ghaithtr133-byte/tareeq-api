import { OpenAPIHono, z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import {
  authCors,
  publicReadCors,
  requireTrustedOrigin,
} from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successEnvelopeSchema, successResponse } from '../shared/http.js'
import type { ContentRuntime } from './runtime.js'
import {
  adminQuerySchemas,
  contentCreateSchemas,
  contentErrorResponses,
  contentPatchSchemas,
  contentDeleteResponseSchema,
  hardDeleteConfirmationSchema,
  deletionImpactSchema,
  entityResponseSchema,
  listResponseSchema,
  publicQuerySchemas,
  contentReorderSchema,
  contentReorderResponseSchema,
  slugParamSchema,
  uuidParamSchema,
} from './schemas.js'
import { contentResources } from './types.js'
import type {
  ContentListQuery,
  ContentResource,
  ContentWriteData,
} from './types.js'

const metadata: Record<ContentResource, {
  publicTag: string
  adminTag: string
  singular: string
  article: 'a' | 'an'
}> = {
  countries: { publicTag: 'Public — Countries', adminTag: 'Admin — Countries', singular: 'country', article: 'a' },
  universities: { publicTag: 'Public — Universities', adminTag: 'Admin — Universities', singular: 'university', article: 'a' },
  scholarships: { publicTag: 'Public — Scholarships', adminTag: 'Admin — Scholarships', singular: 'scholarship', article: 'a' },
  services: { publicTag: 'Public — Services', adminTag: 'Admin — Services', singular: 'service', article: 'a' },
  articles: { publicTag: 'Public — Articles', adminTag: 'Admin — Articles', singular: 'article', article: 'an' },
}

const createExamples: Record<ContentResource, Record<string, unknown>> = {
  countries: {
    nameAr: 'ألمانيا', slug: 'germany', introductionAr: 'مقدمة عن الدراسة في ألمانيا',
    detailsAr: 'تفاصيل الدراسة والمعيشة', status: 'DRAFT',
  },
  universities: {
    nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-university',
    countryId: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d', cityAr: 'برلين',
    cityId: null, universityType: null,
    overviewAr: 'نظرة عامة أكاديمية', status: 'DRAFT',
  },
  scholarships: {
    titleAr: 'منحة الدراسات العليا', slug: 'graduate-scholarship', studyLevel: 'MASTERS',
    fundingType: 'FULL', requirementsAr: 'متطلبات التقديم', descriptionAr: 'تفاصيل المنحة',
    status: 'DRAFT',
  },
  services: {
    titleAr: 'الاستشارة الجامعية', slug: 'university-consulting', summaryAr: 'ملخص الخدمة',
    descriptionAr: 'تفاصيل الخدمة', status: 'DRAFT',
  },
  articles: {
    titleAr: 'دليل الدراسة', slug: 'study-guide', summaryAr: 'ملخص المقال',
    bodyAr: [{ type: 'paragraph', text: 'محتوى المقال كنص منظم وآمن.' }],
    scholarshipIds: ['9f414dec-fcbc-49dd-994f-086d2ef40e1f'], status: 'DRAFT',
  },
}

const exampleId = 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d'
const exampleCountryId = '9879d0a4-9b7e-48d1-850a-da51be9de671'
const exampleUniversityId = '88008b68-b698-4725-93e9-801537e7797c'
const exampleScholarshipId = '9f414dec-fcbc-49dd-994f-086d2ef40e1f'
const exampleDates = {
  status: 'PUBLISHED',
  publishedAt: '2026-10-19T12:00:00.000Z',
  createdAt: '2026-10-19T11:00:00.000Z',
  updatedAt: '2026-10-19T12:00:00.000Z',
}

const adminEntityExamples: Record<ContentResource, Record<string, unknown>> = {
  countries: {
    id: exampleCountryId, nameAr: 'ألمانيا', nameEn: 'Germany', slug: 'germany',
    introductionAr: 'مقدمة عن الدراسة في ألمانيا', introductionEn: null,
    detailsAr: 'تفاصيل الدراسة والمعيشة', detailsEn: null,
    imageUrl: null, imageAltAr: null, imageAltEn: null, countryCode: null,
    featured: true, displayOrder: 10, seoTitleAr: null, seoDescriptionAr: null,
    ...exampleDates,
  },
  universities: {
    id: exampleUniversityId, nameAr: 'جامعة تجريبية', nameEn: 'Example University',
    officialName: 'Example University', slug: 'example-university', countryId: exampleCountryId,
    cityId: null, universityType: null, cityAr: 'مدينة تجريبية', cityEn: 'Example City', overviewAr: 'نظرة عامة أكاديمية',
    overviewEn: null, officialWebsite: 'https://example.edu', imageUrl: null,
    imageAltAr: null, imageAltEn: null, logoUrl: null, logoAltAr: null, logoAltEn: null, featured: false, displayOrder: 0,
    seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا', nameEn: 'Germany', countryCode: 'DE' },
    ...exampleDates,
  },
  scholarships: {
    id: exampleScholarshipId, titleAr: 'منحة تجريبية', titleEn: 'Example Scholarship',
    slug: 'example-scholarship', countryId: exampleCountryId, universityId: exampleUniversityId,
    studyLevel: 'MASTERS', fundingType: 'FULL', requirementsAr: 'متطلبات التقديم',
    requirementsEn: null, descriptionAr: 'تفاصيل المنحة', descriptionEn: null,
    imageUrl: null, imageAltAr: null, imageAltEn: null,
    verifiedDeadline: '2027-01-31T23:59:59.000Z', officialSourceUrl: 'https://example.edu/scholarship',
    applicationStatus: 'OPEN', effectiveApplicationStatus: 'OPEN', featured: true, displayOrder: 0,
    seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا', countryCode: 'DE' },
    university: { id: exampleUniversityId, slug: 'example-university', nameAr: 'جامعة تجريبية' },
    ...exampleDates,
  },
  services: {
    id: exampleId, titleAr: 'الاستشارة الجامعية', titleEn: null,
    slug: 'university-consulting', summaryAr: 'ملخص الخدمة', summaryEn: null,
    descriptionAr: 'تفاصيل الخدمة', descriptionEn: null, imageUrl: null,
    imageAltAr: null, imageAltEn: null, featured: true, displayOrder: 10,
    seoTitleAr: null, seoDescriptionAr: null, ...exampleDates,
  },
  articles: {
    id: exampleId, titleAr: 'دليل الدراسة', titleEn: null, slug: 'study-guide',
    summaryAr: 'ملخص المقال', summaryEn: null,
    bodyAr: [{ type: 'paragraph', text: 'محتوى المقال كنص منظم وآمن.' }], bodyEn: null,
    coverImageUrl: null, coverImageAltAr: null, coverImageAltEn: null,
    countryId: exampleCountryId, universityId: null, scholarshipId: null,
    scholarshipIds: [exampleScholarshipId],
    relatedScholarships: [{
      id: exampleScholarshipId, slug: 'example-scholarship', titleAr: 'منحة تجريبية',
      imageUrl: null, country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا' },
      effectiveApplicationStatus: 'OPEN',
    }],
    featured: true, displayOrder: 0, seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا', countryCode: 'DE' },
    ...exampleDates,
  },
}

const publicEntityExample = (resource: ContentResource) => {
  const example = { ...adminEntityExamples[resource] }
  delete example.status
  delete example.createdAt
  delete example.updatedAt
  delete example.scholarship
  delete example.scholarshipIds
  return example
}

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', {
    fields,
  })
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error.issues)
  return result.data
}

const queryObject = (url: string) =>
  Object.fromEntries(new URL(url).searchParams.entries())

const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', {
      fields: { _request: ['Provide a valid JSON request body.'] },
    })
  }
}

const successContent = (schema: z.ZodType, example: unknown) => ({
  'application/json': { schema, example },
})

const deletionConflictSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(['DELETE_REQUIRES_CONFIRMATION', 'DELETE_BLOCKED']),
    message: z.string(),
    details: z.object({
      impact: deletionImpactSchema,
      confirmation: z.object({ challengeId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) }).optional(),
    }),
  }),
})
const deletionConflictExample = (code: 'DELETE_REQUIRES_CONFIRMATION' | 'DELETE_BLOCKED', outcome: 'REQUIRES_CONFIRMATION' | 'BLOCKED') => ({
  success: false,
  error: {
    code,
    message: outcome === 'BLOCKED' ? 'Deletion is blocked by protected or unverifiable dependencies.' : 'Deletion would affect related records or published content.',
    details: {
      impact: {
      target: { resource: 'scholarships', id: exampleScholarshipId, slug: 'example-scholarship', status: 'DRAFT' },
      outcome,
      items: [{ resourceType: outcome === 'BLOCKED' ? 'STUDENT_APPLICATION' : 'SCHOLARSHIP_DETAIL_ITEM', effect: outcome === 'BLOCKED' ? 'BLOCK' : 'DELETE', count: 1, relationshipPath: outcome === 'BLOCKED' ? 'scholarship.studentApplications' : 'scholarship.detailItems', sampleIds: ['20000000-0000-4000-8000-000000000001'], code: outcome === 'BLOCKED' ? 'STUDENT_APPLICATION_HISTORY_PROTECTED' : 'SCHOLARSHIP_DETAILS_EXPLICIT_DELETE', canConfirm: outcome !== 'BLOCKED', blocked: outcome === 'BLOCKED' }],
      },
      ...(outcome === 'REQUIRES_CONFIRMATION' ? { confirmation: { challengeId: exampleId, expiresAt: '2026-11-11T12:05:00.000Z' } } : {}),
    },
  },
})
const deletionConflictContent = () => ({
  'application/json': {
    schema: deletionConflictSchema,
    example: deletionConflictExample('DELETE_REQUIRES_CONFIRMATION', 'REQUIRES_CONFIRMATION'),
    examples: {
      confirmation: { value: deletionConflictExample('DELETE_REQUIRES_CONFIRMATION', 'REQUIRES_CONFIRMATION') },
      blocked: { value: deletionConflictExample('DELETE_BLOCKED', 'BLOCKED') },
    },
  },
})

const registerDocumentation = (
  routes: OpenAPIHono<AuthEnv>,
  resource: ContentResource,
) => {
  const names = metadata[resource]
  const listExample = {
    success: true,
    data: { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } },
  }
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: `/${resource}`,
    tags: [names.publicTag],
    summary: `List published ${resource}`,
    description: resource === 'universities'
      ? 'Public collection. Returns PUBLISHED Universities only. When sort is omitted, records use persisted editorial displayOrder, then creation time and ID. Explicit newest and name sorts remain compatible. Existing filters remain compatible; optional Major, Study Level, and Teaching Language filters must match the same PUBLISHED UniversityProgram, while normalized City and University Type apply at University level.'
      : resource === 'scholarships'
        ? 'Public collection. Returns PUBLISHED Scholarships with authoritative effective OPEN/CLOSED filtering. Matching Featured Scholarships always precede non-Featured Scholarships before pagination. When sort is omitted, persisted editorial displayOrder applies within each Featured tier; newest and deadline sorts apply within each Featured tier when explicitly requested. Existing Scholarship filters keep their meanings. Optional universitySearch, universityCountry, universityMajor, universityStudyLevel, universityLanguage, universityCity, universityType, and universityFeatured filters require an associated PUBLISHED University; Program filters must match the same PUBLISHED UniversityProgram across the complete University result set.'
        : resource === 'articles'
          ? 'Public collection. Returns PUBLISHED records only. When sort is omitted, records use persisted editorial displayOrder, then creation time and ID; explicit newest sorting remains available.'
          : 'Public collection. Returns PUBLISHED records only with validated pagination and documented filters. Countries and Services use persisted editorial displayOrder by default; their explicit newest sort remains available.',
    request: { query: publicQuerySchemas[resource] },
    responses: {
      200: { description: `Published ${resource}.`, content: successContent(listResponseSchema(resource), listExample) },
      400: contentErrorResponses[400],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: `/${resource}/{slug}`,
    tags: [names.publicTag],
    summary: `Get a published ${names.singular}`,
    description: resource === 'articles'
      ? 'Looks up one PUBLISHED Article by its stable public slug. relatedScholarships contains only PUBLISHED Scholarships in the Admin-selected order, including authoritative effective application status; legacy scholarshipId remains compatible.'
      : 'Looks up one PUBLISHED record by its stable public slug.',
    request: { params: slugParamSchema },
    responses: {
      200: { description: `Published ${names.singular}.`, content: successContent(entityResponseSchema(resource), { success: true, data: publicEntityExample(resource) }) },
      400: contentErrorResponses[400],
      404: contentErrorResponses[404],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: `/admin/${resource}`,
    tags: [names.adminTag],
    summary: `List ${resource} for administration`,
    description: 'ADMIN or SUPER_ADMIN only. Includes draft, published, and archived records and supports publication-status filtering.',
    security: [{ accessCookie: [] }],
    request: { query: adminQuerySchemas[resource] },
    responses: {
      200: { description: `Administrative ${resource} collection.`, content: successContent(listResponseSchema(resource, true), listExample) },
      400: contentErrorResponses[400], 401: contentErrorResponses[401], 403: contentErrorResponses[403],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: `/admin/${resource}/{id}`,
    tags: [names.adminTag],
    summary: `Get ${names.article} ${names.singular} for administration`,
    description: resource === 'articles'
      ? 'ADMIN or SUPER_ADMIN only. Uses the UUID identifier and includes editable publication fields plus the ordered scholarshipIds association set. Legacy scholarshipId mirrors the first selected ID.'
      : 'ADMIN or SUPER_ADMIN only. Uses the UUID identifier and includes editable publication fields.',
    security: [{ accessCookie: [] }],
    request: { params: uuidParamSchema },
    responses: {
      200: { description: `Administrative ${names.singular}.`, content: successContent(entityResponseSchema(resource, true), { success: true, data: adminEntityExamples[resource] }) },
      400: contentErrorResponses[400], 401: contentErrorResponses[401], 403: contentErrorResponses[403], 404: contentErrorResponses[404],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: `/admin/${resource}`,
    tags: [names.adminTag],
    summary: `Create ${names.article} ${names.singular}`,
    description: resource === 'articles'
      ? 'ADMIN or SUPER_ADMIN only. New Articles accept an ordered, duplicate-free scholarshipIds array. If both fields are supplied, legacy scholarshipId must equal the first array item. New records default to DRAFT.'
      : 'ADMIN or SUPER_ADMIN only. New records default to DRAFT unless a valid PUBLISHED state is explicitly requested.',
    security: [{ accessCookie: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: contentCreateSchemas[resource], example: createExamples[resource] } } } },
    responses: {
      201: { description: `${names.singular} created.`, content: successContent(entityResponseSchema(resource, true), { success: true, data: adminEntityExamples[resource] }) },
      400: contentErrorResponses[400],
      401: contentErrorResponses[401],
      403: contentErrorResponses[403],
      409: contentErrorResponses[409],
      415: contentErrorResponses[415],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch',
    path: `/admin/${resource}/{id}`,
    tags: [names.adminTag],
    summary: `Update ${names.article} ${names.singular}`,
    description: resource === 'articles'
      ? 'ADMIN or SUPER_ADMIN only. Omitted scholarship association fields preserve links; scholarshipIds replaces them in order, [] clears them, and legacy scholarshipId alone maps to zero or one link. Supports publication transitions while preserving first publication time and published slugs.'
      : 'ADMIN or SUPER_ADMIN only. Supports publication transitions; the first publication timestamp and any previously published slug are preserved.',
    security: [{ accessCookie: [] }],
    request: {
      params: uuidParamSchema,
      body: { required: true, content: { 'application/json': { schema: contentPatchSchemas[resource], example: { status: 'PUBLISHED' } } } },
    },
    responses: {
      200: { description: `${names.singular} updated.`, content: successContent(entityResponseSchema(resource, true), { success: true, data: adminEntityExamples[resource] }) },
      400: contentErrorResponses[400],
      401: contentErrorResponses[401],
      403: contentErrorResponses[403],
      404: contentErrorResponses[404],
      409: contentErrorResponses[409],
      415: contentErrorResponses[415],
    },
  })
  if (resource !== 'articles') {
    routes.openAPIRegistry.registerPath({
      method: 'delete', path: `/admin/${resource}/{id}`, tags: [names.adminTag], summary: `Safely hard delete ${names.article} ${names.singular}`,
      description: 'ADMIN or SUPER_ADMIN only. Initial hard deletion succeeds only for DRAFT or ARCHIVED records with a freshly verified empty destructive-impact graph. PUBLISHED records or CASCADE effects require a future SUPER_ADMIN confirmation flow. Protected, RESTRICT, Demo-fixture, historical-student, or unknown dependencies are blocked without deletion.',
      security: [{ accessCookie: [] }], request: { params: uuidParamSchema },
      responses: {
        200: { description: `${names.singular} safely deleted and audited.`, content: successContent(contentDeleteResponseSchema, { success: true, data: { id: exampleId, impact: { target: { resource: resource, id: exampleId, slug: 'example-record', status: 'DRAFT' }, outcome: 'SAFE', items: [] } } }) },
        401: contentErrorResponses[401], 403: contentErrorResponses[403], 404: contentErrorResponses[404],
        409: { description: 'Deletion requires confirmation or is blocked; the impact graph is returned in error.details.impact.', content: deletionConflictContent() },
      },
    })
    routes.openAPIRegistry.registerPath({
      method: 'post', path: `/admin/${resource}/{id}/hard-delete/confirm`, tags: [names.adminTag], summary: `Confirm hard deletion of ${names.article} ${names.singular}`,
      description: 'SUPER_ADMIN only. Submits the short-lived, actor-bound confirmation challenge returned by a prior DELETE preflight. The complete impact graph is locked and revalidated before explicit child deletion or unlinking. A stale or changed graph returns 409 with an updated impact; protected dependencies remain blocked.',
      security: [{ accessCookie: [] }],
      request: { params: uuidParamSchema, body: { required: true, content: { 'application/json': { schema: hardDeleteConfirmationSchema, example: { challengeId: exampleId } } } } },
      responses: {
        200: { description: `${names.singular} and approved editorial effects were deleted atomically.`, content: successContent(contentDeleteResponseSchema, { success: true, data: { id: exampleId, impact: { target: { resource, id: exampleId, slug: 'example-record', status: 'PUBLISHED' }, outcome: 'REQUIRES_CONFIRMATION', items: [{ resourceType: 'SERVICE_DETAIL_ITEM', effect: 'DELETE', count: 2, relationshipPath: 'service.detailItems', sampleIds: [], code: 'SERVICE_DETAILS_EXPLICIT_DELETE', canConfirm: true, blocked: false }] } } }) },
        400: contentErrorResponses[400], 401: contentErrorResponses[401], 403: contentErrorResponses[403], 404: contentErrorResponses[404],
        409: { description: 'The challenge is stale, the graph changed, or deletion is blocked; the latest impact is returned.', content: deletionConflictContent() },
        415: contentErrorResponses[415],
      },
    })
  }
}

export const createContentRoutes = (
  contentRuntime: ContentRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  publicRoutes.use('*', publicReadCors(authRuntime))
  adminRoutes.use('*', authCors(authRuntime))
  adminRoutes.use('*', requireTrustedOrigin(authRuntime))
  adminRoutes.use('*', requireAuthentication(authRuntime))
  adminRoutes.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))

  for (const resource of contentResources) {
    const names = metadata[resource]
    routes.openAPIRegistry.registerPath({
      method: 'patch', path: `/admin/${resource}/order`, tags: [names.adminTag], summary: `Atomically reorder ${resource}`,
      description: 'ADMIN or SUPER_ADMIN only. Submit the complete, unfiltered set of every non-archived record exactly once. The operation, audit record when records exist, and persisted displayOrder changes are atomic; empty orderedIds is valid only when no non-archived records exist.',
      security: [{ accessCookie: [] }], request: { body: { required: true, content: { 'application/json': { schema: contentReorderSchema, example: { orderedIds: ['b2b21ee5-f955-46ca-972f-6b6b81aa4a3d'] } } } } },
      responses: { 200: { description: 'Persisted editorial order.', content: successContent(contentReorderResponseSchema, { success: true, data: { items: [{ id: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d', displayOrder: 0 }] } }) }, 400: contentErrorResponses[400], 401: contentErrorResponses[401], 403: contentErrorResponses[403], 409: contentErrorResponses[409], 415: contentErrorResponses[415] },
    })
    adminRoutes.patch(`/${resource}/order`, async (c) => {
      const { orderedIds } = parse(contentReorderSchema, await readJson(c.req.raw))
      return c.json(successResponse(await contentRuntime.getService().reorder(resource, orderedIds, c.get('authClaims').userId)), 200)
    })
  }

  const scholarshipFilterOptionsSchema = z.object({
    studyLevels: z.array(z.object({ value: z.string(), labelAr: z.string().nullable(), count: z.number().int() })),
    fundingTypes: z.array(z.object({ value: z.string(), labelAr: z.string().nullable(), count: z.number().int() })),
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/scholarships/filter-options', tags: ['Public — Scholarships'], summary: 'Get published Scholarship filter options',
    description: 'Distinct studyLevel and fundingType values across the complete PUBLISHED Scholarship dataset, independent of listing pagination. Unknown values are retained with labelAr=null rather than receiving a speculative label.',
    responses: { 200: { description: 'Published Scholarship facets.', content: { 'application/json': { schema: successEnvelopeSchema(scholarshipFilterOptionsSchema), example: { success: true, data: { studyLevels: [{ value: 'MASTERS', labelAr: 'ماجستير', count: 4 }], fundingTypes: [{ value: 'FULL', labelAr: 'تمويل كامل', count: 3 }] } } } } } },
  })
  publicRoutes.get('/scholarships/filter-options', async (c) => c.json(successResponse(await contentRuntime.getService().scholarshipFilterOptions()), 200))

  for (const resource of contentResources) {
    registerDocumentation(routes, resource)

    publicRoutes.get(`/${resource}`, async (c) => {
      const query = parse(
        publicQuerySchemas[resource],
        queryObject(c.req.url),
      ) as ContentListQuery
      return c.json(
        successResponse(await contentRuntime.getService().list(resource, query, true)),
        200,
      )
    })

    publicRoutes.get(`/${resource}/:slug`, async (c) => {
      const { slug } = parse(slugParamSchema, { slug: c.req.param('slug') })
      return c.json(
        successResponse(await contentRuntime.getService().getPublic(resource, slug)),
        200,
      )
    })

    if (resource !== 'articles') {
      adminRoutes.post(`/${resource}/:id/hard-delete/confirm`, async (c) => {
        const claims = c.get('authClaims')
        if (claims.role !== 'SUPER_ADMIN') throw new ApiError(403, 'FORBIDDEN', 'SUPER_ADMIN permission is required.')
        const { id } = parse(uuidParamSchema, { id: c.req.param('id') })
        const { challengeId } = parse(hardDeleteConfirmationSchema, await readJson(c.req.raw))
        return c.json(successResponse(await contentRuntime.getService().confirmHardDelete(resource, id, challengeId, claims.userId)), 200)
      })
    }

    adminRoutes.get(`/${resource}`, async (c) => {
      const query = parse(
        adminQuerySchemas[resource],
        queryObject(c.req.url),
      ) as ContentListQuery
      return c.json(
        successResponse(await contentRuntime.getService().list(resource, query, false)),
        200,
      )
    })

    adminRoutes.get(`/${resource}/:id`, async (c) => {
      const { id } = parse(uuidParamSchema, { id: c.req.param('id') })
      return c.json(
        successResponse(await contentRuntime.getService().getAdmin(resource, id)),
        200,
      )
    })

    adminRoutes.post(`/${resource}`, async (c) => {
      const input = parse(
        contentCreateSchemas[resource] as z.ZodType<unknown>,
        await readJson(c.req.raw),
      ) as ContentWriteData
      return c.json(
        successResponse(await contentRuntime.getService().create(
          resource,
          input,
          c.get('authClaims').userId,
        )),
        201,
      )
    })

    adminRoutes.patch(`/${resource}/:id`, async (c) => {
      const { id } = parse(uuidParamSchema, { id: c.req.param('id') })
      const input = parse(
        contentPatchSchemas[resource] as z.ZodType<unknown>,
        await readJson(c.req.raw),
      ) as ContentWriteData
      return c.json(
        successResponse(await contentRuntime.getService().update(
          resource,
          id,
          input,
          c.get('authClaims').userId,
        )),
        200,
      )
    })
    if (resource !== 'articles') {
      adminRoutes.delete(`/${resource}/:id`, async (c) => {
        const { id } = parse(uuidParamSchema, { id: c.req.param('id') })
        const claims = c.get('authClaims')
        return c.json(successResponse(await contentRuntime.getService().delete(resource, id, claims.userId, claims.role)), 200)
      })
    }
  }

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)

  return routes
}
