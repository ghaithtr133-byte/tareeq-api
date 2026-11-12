import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, publicReadCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { UniversityDirectoryRuntime } from './runtime.js'
import {
  academicMajorCreateSchema,
  academicMajorUpdateSchema,
  adminProgramListQuerySchema,
  adminProgramListResponseSchema,
  adminProgramResponseSchema,
  cityListQuerySchema,
  cityCreateSchema,
  cityUpdateSchema,
  cityListResponseSchema,
  cityResponseSchema,
  directoryErrorResponses,
  directoryIdParamSchema,
  filterOptionsQuerySchema,
  filterOptionsResponseSchema,
  majorListResponseSchema,
  majorListQuerySchema,
  majorResponseSchema,
  programCreateSchema,
  programListQuerySchema,
  programUpdateSchema,
  publicProgramListResponseSchema,
  universityIdParamSchema,
  universitySlugParamSchema,
} from './schemas.js'
import type { ProgramCreateInput, ProgramUpdateInput, AcademicMajorUpdateInput, CityUpdateInput } from './types.js'
import type { CatalogListQuery, ProgramListQuery, UniversityDirectoryFilters } from './types.js'

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', { fields })
}
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error.issues)
  return result.data
}
const queryObject = (url: string) => Object.fromEntries(new URL(url).searchParams.entries())
const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  try { return await request.json() } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', { fields: { _request: ['Provide valid JSON.'] } })
  }
}

const majorExample = { id: '10000000-0000-4000-8000-000000000001', slug: 'medicine', nameAr: 'الطب', nameEn: 'Medicine', category: 'Health Sciences' }
const programExample = {
  id: '20000000-0000-4000-8000-000000000001', universityId: '88008b68-b698-4725-93e9-801537e7797c', academicMajorId: majorExample.id,
  nameAr: 'بكالوريوس الطب والجراحة', nameEn: 'Bachelor of Medicine and Surgery',
  facultyNameAr: 'كلية الطب', facultyNameEn: 'Faculty of Medicine', durationValue: 6, durationUnit: 'YEARS',
  academicMajor: majorExample, studyLevel: 'BACHELORS', languages: ['ENGLISH'], status: 'PUBLISHED',
  officialSourceUrl: 'https://example.edu/programs/medicine', verifiedAt: '2026-11-01T12:00:00.000Z', publishedAt: '2026-11-02T12:00:00.000Z',
  tuition: { id: '21000000-0000-4000-8000-000000000001', amount: '12000.00', currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027', createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T11:00:00.000Z' },
  tuitionFees: [{ id: '21000000-0000-4000-8000-000000000001', amount: '12000.00', currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027', createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T11:00:00.000Z' }],
  createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z',
}
const cityExample = { id: '30000000-0000-4000-8000-000000000001', countryId: '9879d0a4-9b7e-48d1-850a-da51be9de671', slug: 'bucharest', nameAr: 'بوخارست', nameEn: 'Bucharest', createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T11:00:00.000Z' }
const pagination = { page: 1, limit: 12, total: 1, totalPages: 1 }
const success = (schema: z.ZodType, example: unknown, description: string) => ({ description, content: { 'application/json': { schema, example } } })

export const createUniversityDirectoryRoutes = (runtime: UniversityDirectoryRuntime, authRuntime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/universities/filter-options', tags: ['Public — University Directory'], summary: 'Get dynamic university filter options',
    description: 'Returns supported P1/P2 facet options with distinct matching-University counts. Each facet excludes its own current value while respecting all other filters; combined major, study-level, and language conditions must match one published program.',
    request: { query: filterOptionsQuerySchema },
    responses: { 200: success(filterOptionsResponseSchema, { success: true, data: { majors: [{ ...majorExample, value: 'medicine', count: 2 }], studyLevels: [{ value: 'BACHELORS', count: 2 }], languages: [{ value: 'ENGLISH', count: 2 }], cities: [{ ...cityExample, value: 'bucharest', count: 1 }], universityTypes: [{ value: 'PUBLIC', count: 1 }] } }, 'Available filter options.'), 400: directoryErrorResponses[400] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/universities/{slug}/programs', tags: ['Public — University Directory'], summary: 'List published University programs',
    description: 'Returns published programs for one published University. Supports localized program/major search, study-level, teaching-language, and faculty filters with deterministic pagination. Tuition is null when no verified schedule exists; historical academic-year schedules are preserved.',
    request: { params: universitySlugParamSchema, query: programListQuerySchema },
    responses: { 200: success(publicProgramListResponseSchema, { success: true, data: { items: [{ ...programExample, universityId: undefined, academicMajorId: undefined, status: undefined, createdAt: undefined, updatedAt: undefined }], pagination } }, 'Published University programs.'), 400: directoryErrorResponses[400], 404: directoryErrorResponses[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/universities/{universityId}/programs', tags: ['Admin — University Programs'], summary: 'List programs for a University',
    description: 'ADMIN or SUPER_ADMIN only. Lists draft, published, and archived programs for exactly one University with search, study-level, language, faculty, and status filters.', security: [{ accessCookie: [] }],
    request: { params: universityIdParamSchema, query: adminProgramListQuerySchema },
    responses: { 200: success(adminProgramListResponseSchema, { success: true, data: { items: [programExample], pagination } }, 'Administrative program list.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/universities/{universityId}/programs', tags: ['Admin — University Programs'], summary: 'Create a verified University program',
    description: 'ADMIN or SUPER_ADMIN only. Creates a localized program distinct from its major taxonomy, with optional faculty, paired duration value/unit, and an optional academic-year tuition schedule. Tuition is never inferred.', security: [{ accessCookie: [] }],
    request: { params: universityIdParamSchema, body: { required: true, content: { 'application/json': { schema: programCreateSchema, example: { academicMajorId: majorExample.id, nameAr: programExample.nameAr, nameEn: programExample.nameEn, facultyNameAr: programExample.facultyNameAr, durationValue: 6, durationUnit: 'YEARS', studyLevel: 'BACHELORS', languages: ['ENGLISH'], tuition: { amount: '12000.00', currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027' }, status: 'DRAFT', officialSourceUrl: programExample.officialSourceUrl, verifiedAt: programExample.verifiedAt } } } } },
    responses: { 201: success(adminProgramResponseSchema, { success: true, data: programExample }, 'Program created.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/university-programs/{id}', tags: ['Admin — University Programs'], summary: 'Update, publish, or archive a University program',
    description: 'ADMIN or SUPER_ADMIN only. Updates verified program data and teaching languages atomically. Supplying tuition upserts only that academic year and preserves older schedules. Set status=ARCHIVED instead of deleting.', security: [{ accessCookie: [] }],
    request: { params: directoryIdParamSchema, body: { required: true, content: { 'application/json': { schema: programUpdateSchema, example: { status: 'PUBLISHED', languages: ['ENGLISH', 'ROMANIAN'] } } } } },
    responses: { 200: success(adminProgramResponseSchema, { success: true, data: programExample }, 'Program updated.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 404: directoryErrorResponses[404], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/academic-majors', tags: ['Admin — Directory Catalogs'], summary: 'List normalized academic majors',
    description: 'ADMIN or SUPER_ADMIN only. Bounded lookup for program data entry.', security: [{ accessCookie: [] }], request: { query: majorListQuerySchema },
    responses: { 200: success(majorListResponseSchema, { success: true, data: { items: [{ ...majorExample, createdAt: cityExample.createdAt, updatedAt: cityExample.updatedAt }], pagination } }, 'Academic majors.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/academic-majors', tags: ['Admin — Directory Catalogs'], summary: 'Create a normalized academic major',
    description: 'ADMIN or SUPER_ADMIN only. Creates a stable bilingual major lookup without assigning it to any University.', security: [{ accessCookie: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: academicMajorCreateSchema, example: { slug: 'medicine', nameAr: 'الطب', nameEn: 'Medicine', category: 'Health Sciences' } } } } },
    responses: { 201: success(majorResponseSchema, { success: true, data: { ...majorExample, createdAt: cityExample.createdAt, updatedAt: cityExample.updatedAt } }, 'Major created.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/academic-majors/{id}', tags: ['Admin — Directory Catalogs'], summary: 'Update a normalized academic major',
    description: 'ADMIN or SUPER_ADMIN only. Stable IDs and slugs are preserved unless slug is explicitly supplied. Arabic and English normalized names are globally unique.', security: [{ accessCookie: [] }], request: { params: directoryIdParamSchema, body: { required: true, content: { 'application/json': { schema: academicMajorUpdateSchema, example: { nameAr: 'الطب البشري' } } } } },
    responses: { 200: success(majorResponseSchema, { success: true, data: { ...majorExample, createdAt: cityExample.createdAt, updatedAt: cityExample.updatedAt } }, 'Major updated.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 404: directoryErrorResponses[404], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'delete', path: '/admin/academic-majors/{id}', tags: ['Admin — Directory Catalogs'], summary: 'Delete an unused academic major',
    description: 'ADMIN or SUPER_ADMIN only. A major referenced by any University Program is rejected with 409; no Program is cascaded or changed.', security: [{ accessCookie: [] }], request: { params: directoryIdParamSchema },
    responses: { 200: success(majorResponseSchema, { success: true, data: { id: majorExample.id } }, 'Major deleted.'), 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 404: directoryErrorResponses[404], 409: directoryErrorResponses[409] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/cities', tags: ['Admin — Directory Catalogs'], summary: 'List normalized cities',
    description: 'ADMIN or SUPER_ADMIN only. Bounded city lookup with optional Country UUID filtering.', security: [{ accessCookie: [] }], request: { query: cityListQuerySchema },
    responses: { 200: success(cityListResponseSchema, { success: true, data: { items: [cityExample], pagination } }, 'Cities.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/cities', tags: ['Admin — Directory Catalogs'], summary: 'Create a normalized city',
    description: 'ADMIN or SUPER_ADMIN only. Creates a stable bilingual city under an existing Country; it does not alter existing Universities.', security: [{ accessCookie: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: cityCreateSchema, example: { countryId: cityExample.countryId, slug: 'bucharest', nameAr: 'بوخارست', nameEn: 'Bucharest' } } } } },
    responses: { 201: success(cityResponseSchema, { success: true, data: cityExample }, 'City created.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/cities/{id}', tags: ['Admin — Directory Catalogs'], summary: 'Update a normalized city',
    description: 'ADMIN or SUPER_ADMIN only. Name uniqueness is scoped to Country. A referenced city cannot be moved to another Country.', security: [{ accessCookie: [] }], request: { params: directoryIdParamSchema, body: { required: true, content: { 'application/json': { schema: cityUpdateSchema, example: { nameAr: 'بوخارست الجديدة' } } } } },
    responses: { 200: success(cityResponseSchema, { success: true, data: cityExample }, 'City updated.'), 400: directoryErrorResponses[400], 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 404: directoryErrorResponses[404], 409: directoryErrorResponses[409], 415: directoryErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'delete', path: '/admin/cities/{id}', tags: ['Admin — Directory Catalogs'], summary: 'Delete an unused city',
    description: 'ADMIN or SUPER_ADMIN only. A city referenced by any University is rejected with 409; no University is unlinked or deleted.', security: [{ accessCookie: [] }], request: { params: directoryIdParamSchema },
    responses: { 200: success(cityResponseSchema, { success: true, data: { id: cityExample.id } }, 'City deleted.'), 401: directoryErrorResponses[401], 403: directoryErrorResponses[403], 404: directoryErrorResponses[404], 409: directoryErrorResponses[409] },
  })

  publicRoutes.use('/universities/filter-options', publicReadCors(authRuntime))
  publicRoutes.use('/universities/:slug/programs', publicReadCors(authRuntime))
  adminRoutes.use('*', authCors(authRuntime))
  adminRoutes.use('*', requireTrustedOrigin(authRuntime))
  adminRoutes.use('*', requireAuthentication(authRuntime))
  adminRoutes.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))

  publicRoutes.get('/universities/filter-options', async (c) => {
    const query = parse(filterOptionsQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().filterOptions(query as UniversityDirectoryFilters)), 200)
  })
  publicRoutes.get('/universities/:slug/programs', async (c) => {
    const { slug } = parse(universitySlugParamSchema, { slug: c.req.param('slug') })
    const query = parse(programListQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().listPublicPrograms(slug, query as ProgramListQuery)), 200)
  })
  adminRoutes.get('/universities/:universityId/programs', async (c) => {
    const { universityId } = parse(universityIdParamSchema, { universityId: c.req.param('universityId') })
    const query = parse(adminProgramListQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().listAdminPrograms(universityId, query as ProgramListQuery)), 200)
  })
  adminRoutes.post('/universities/:universityId/programs', async (c) => {
    const { universityId } = parse(universityIdParamSchema, { universityId: c.req.param('universityId') })
    const body = parse(programCreateSchema, await readJson(c.req.raw))
    const input = Object.fromEntries(Object.entries({ ...body, universityId, verifiedAt: new Date(body.verifiedAt) }).filter(([, value]) => value !== undefined)) as unknown as ProgramCreateInput
    return c.json(successResponse(await runtime.getService().createProgram(input, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/university-programs/:id', async (c) => {
    const { id } = parse(directoryIdParamSchema, { id: c.req.param('id') })
    const body = parse(programUpdateSchema, await readJson(c.req.raw))
    const input = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as unknown as ProgramUpdateInput
    if (body.verifiedAt) input.verifiedAt = new Date(body.verifiedAt)
    return c.json(successResponse(await runtime.getService().updateProgram(id, input, c.get('authClaims').userId)), 200)
  })
  adminRoutes.get('/academic-majors', async (c) => {
    const query = parse(majorListQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().listMajors(query as CatalogListQuery)), 200)
  })
  adminRoutes.post('/academic-majors', async (c) => {
    const body = parse(academicMajorCreateSchema, await readJson(c.req.raw))
    return c.json(successResponse(await runtime.getService().createMajor(body, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/academic-majors/:id', async (c) => {
    const { id } = parse(directoryIdParamSchema, { id: c.req.param('id') })
    const body = parse(academicMajorUpdateSchema, await readJson(c.req.raw))
    return c.json(successResponse(await runtime.getService().updateMajor(id, body as AcademicMajorUpdateInput, c.get('authClaims').userId)), 200)
  })
  adminRoutes.delete('/academic-majors/:id', async (c) => {
    const { id } = parse(directoryIdParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(await runtime.getService().deleteMajor(id, c.get('authClaims').userId)), 200)
  })
  adminRoutes.get('/cities', async (c) => {
    const query = parse(cityListQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().listCities(query as CatalogListQuery)), 200)
  })
  adminRoutes.post('/cities', async (c) => {
    const body = parse(cityCreateSchema, await readJson(c.req.raw))
    return c.json(successResponse(await runtime.getService().createCity(body, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/cities/:id', async (c) => {
    const { id } = parse(directoryIdParamSchema, { id: c.req.param('id') })
    const body = parse(cityUpdateSchema, await readJson(c.req.raw))
    return c.json(successResponse(await runtime.getService().updateCity(id, body as CityUpdateInput, c.get('authClaims').userId)), 200)
  })
  adminRoutes.delete('/cities/:id', async (c) => {
    const { id } = parse(directoryIdParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(await runtime.getService().deleteCity(id, c.get('authClaims').userId)), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
