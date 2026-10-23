import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import {
  authCors,
  publicReadCors,
  requireTrustedOrigin,
} from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { ContentRuntime } from './runtime.js'
import {
  adminQuerySchemas,
  contentCreateSchemas,
  contentErrorResponses,
  contentPatchSchemas,
  entityResponseSchema,
  listResponseSchema,
  publicQuerySchemas,
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
  countries: { publicTag: 'Countries', adminTag: 'Admin Countries', singular: 'country', article: 'a' },
  universities: { publicTag: 'Universities', adminTag: 'Admin Universities', singular: 'university', article: 'a' },
  scholarships: { publicTag: 'Scholarships', adminTag: 'Admin Scholarships', singular: 'scholarship', article: 'a' },
  services: { publicTag: 'Services', adminTag: 'Admin Services', singular: 'service', article: 'a' },
  articles: { publicTag: 'Articles', adminTag: 'Admin Articles', singular: 'article', article: 'an' },
}

const createExamples: Record<ContentResource, Record<string, unknown>> = {
  countries: {
    nameAr: 'ألمانيا', slug: 'germany', introductionAr: 'مقدمة عن الدراسة في ألمانيا',
    detailsAr: 'تفاصيل الدراسة والمعيشة', status: 'DRAFT',
  },
  universities: {
    nameAr: 'جامعة برلين', officialName: 'Berlin University', slug: 'berlin-university',
    countryId: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d', cityAr: 'برلين',
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
    bodyAr: [{ type: 'paragraph', text: 'محتوى المقال كنص منظم وآمن.' }], status: 'DRAFT',
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
    imageUrl: null, imageAltAr: null, imageAltEn: null,
    featured: true, displayOrder: 10, seoTitleAr: null, seoDescriptionAr: null,
    ...exampleDates,
  },
  universities: {
    id: exampleUniversityId, nameAr: 'جامعة تجريبية', nameEn: 'Example University',
    officialName: 'Example University', slug: 'example-university', countryId: exampleCountryId,
    cityAr: 'مدينة تجريبية', cityEn: 'Example City', overviewAr: 'نظرة عامة أكاديمية',
    overviewEn: null, officialWebsite: 'https://example.edu', imageUrl: null,
    imageAltAr: null, imageAltEn: null, featured: false,
    seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا', nameEn: 'Germany' },
    ...exampleDates,
  },
  scholarships: {
    id: exampleScholarshipId, titleAr: 'منحة تجريبية', titleEn: 'Example Scholarship',
    slug: 'example-scholarship', countryId: exampleCountryId, universityId: exampleUniversityId,
    studyLevel: 'MASTERS', fundingType: 'FULL', requirementsAr: 'متطلبات التقديم',
    requirementsEn: null, descriptionAr: 'تفاصيل المنحة', descriptionEn: null,
    verifiedDeadline: '2027-01-31T23:59:59.000Z', officialSourceUrl: 'https://example.edu/scholarship',
    applicationStatus: 'OPEN', effectiveApplicationStatus: 'OPEN', featured: true,
    seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا' },
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
    featured: true, seoTitleAr: null, seoDescriptionAr: null,
    country: { id: exampleCountryId, slug: 'germany', nameAr: 'ألمانيا' },
    ...exampleDates,
  },
}

const publicEntityExample = (resource: ContentResource) => {
  const example = { ...adminEntityExamples[resource] }
  delete example.status
  delete example.createdAt
  delete example.updatedAt
  delete example.country
  delete example.university
  delete example.scholarship
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
    description: 'Public collection. Returns PUBLISHED records only with validated pagination and documented filters.',
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
    description: 'Looks up one PUBLISHED record by its stable public slug.',
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
    description: 'ADMIN or SUPER_ADMIN only. Uses the UUID identifier and includes editable publication fields.',
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
    description: 'ADMIN or SUPER_ADMIN only. New records default to DRAFT unless a valid PUBLISHED state is explicitly requested.',
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
    description: 'ADMIN or SUPER_ADMIN only. Supports publication transitions; the first publication timestamp and any previously published slug are preserved.',
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
        successResponse(await contentRuntime.getService().create(resource, input)),
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
        successResponse(await contentRuntime.getService().update(resource, id, input)),
        200,
      )
    })
  }

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)

  return routes
}
