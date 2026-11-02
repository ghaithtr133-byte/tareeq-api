import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, publicReadCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { UniversityDetailsRuntime } from './runtime.js'
import {
  adminAdmissionListResponseSchema,
  adminAdmissionResponseSchema,
  adminGalleryListResponseSchema,
  adminGalleryResponseSchema,
  admissionCreateSchema,
  admissionListQuerySchema,
  admissionUpdateSchema,
  detailIdParamSchema,
  detailsListQuerySchema,
  detailSlugParamSchema,
  detailUniversityParamSchema,
  galleryCreateSchema,
  galleryDetachResponseSchema,
  galleryReorderResponseSchema,
  galleryReorderSchema,
  galleryUpdateSchema,
  publicAdmissionResponseSchema,
  publicGalleryResponseSchema,
  universityDetailsErrors,
} from './schemas.js'
import type { AdmissionRequirementInput, AdmissionRequirementUpdate, DetailsListQuery, GalleryImageInput, GalleryImageUpdate } from './types.js'

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) (fields[issue.path.length ? issue.path.join('.') : '_request'] ??= []).push(issue.message)
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
  try { return await request.json() } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.') }
}
const success = (schema: z.ZodType, example: unknown, description: string) => ({ description, content: { 'application/json': { schema, example } } })
const UNIVERSITY_ID = '88008b68-b698-4725-93e9-801537e7797c'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'
const REQUIREMENT_ID = '40000000-0000-4000-8000-000000000001'
const IMAGE_ID = '50000000-0000-4000-8000-000000000001'
const requirement = { id: REQUIREMENT_ID, universityId: UNIVERSITY_ID, scope: 'STUDY_LEVEL', studyLevel: 'BACHELORS', programId: null, contentAr: 'شهادة ثانوية معتمدة.', contentEn: 'An accredited secondary certificate.', status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/admissions', verifiedAt: '2026-11-01T12:00:00.000Z', publishedAt: '2026-11-02T12:00:00.000Z', createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z', program: null }
const image = { id: IMAGE_ID, universityId: UNIVERSITY_ID, imageUrl: 'https://res.cloudinary.com/example/image/upload/university-campus.webp', altAr: 'حرم الجامعة', altEn: 'University campus', displayOrder: 0, status: 'PUBLISHED', publishedAt: '2026-11-02T12:00:00.000Z', createdAt: '2026-11-02T11:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z' }
const pagination = { page: 1, limit: 50, total: 1, totalPages: 1 }

export const createUniversityDetailsRoutes = (runtime: UniversityDetailsRuntime, authRuntime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/universities/{slug}/admission-requirements', tags: ['Public — University Details'], summary: 'Get published University admission requirements',
    description: 'Returns separate University-level, study-level, and program-specific collections. General requirements are never relabeled as program-specific; missing data produces empty arrays.',
    request: { params: detailSlugParamSchema }, responses: { 200: success(publicAdmissionResponseSchema, { success: true, data: { university: [], studyLevels: [{ ...requirement, universityId: undefined, status: undefined, createdAt: undefined, updatedAt: undefined }], programs: [] } }, 'Published scoped admission requirements.'), 400: universityDetailsErrors[400], 404: universityDetailsErrors[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/universities/{slug}/gallery', tags: ['Public — University Details'], summary: 'Get the published University gallery',
    description: 'Returns published gallery associations ordered by displayOrder then stable ID. The existing University cover image is independent; an empty gallery returns items=[].',
    request: { params: detailSlugParamSchema }, responses: { 200: success(publicGalleryResponseSchema, { success: true, data: { items: [{ ...image, universityId: undefined, status: undefined, createdAt: undefined, updatedAt: undefined }] } }, 'Published gallery images.'), 400: universityDetailsErrors[400], 404: universityDetailsErrors[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/universities/{universityId}/admission-requirements', tags: ['Admin — University Details'], summary: 'List scoped admission requirements', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Lists one University’s draft, published, and archived scoped requirements with bounded pagination and optional scope/status filters.',
    request: { params: detailUniversityParamSchema, query: admissionListQuerySchema }, responses: { 200: success(adminAdmissionListResponseSchema, { success: true, data: { items: [requirement], pagination } }, 'Administrative admission requirements.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/universities/{universityId}/admission-requirements', tags: ['Admin — University Details'], summary: 'Create a scoped admission requirement', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Scope is explicit and immutable. UNIVERSITY has no target, STUDY_LEVEL targets one controlled level, and PROGRAM targets a program belonging to this University. Publication requires an HTTPS official source and non-future verification time.',
    request: { params: detailUniversityParamSchema, body: { required: true, content: { 'application/json': { schema: admissionCreateSchema, example: { scope: 'PROGRAM', programId: PROGRAM_ID, contentAr: 'متطلبات البرنامج.', status: 'DRAFT', officialSourceUrl: null, verifiedAt: null } } } } }, responses: { 201: success(adminAdmissionResponseSchema, { success: true, data: requirement }, 'Admission requirement created.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404], 415: universityDetailsErrors[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/university-admission-requirements/{id}', tags: ['Admin — University Details'], summary: 'Edit or publish an admission requirement', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Updates content and publication/source metadata. Scope and target are immutable; archive instead of deleting.', request: { params: detailIdParamSchema, body: { required: true, content: { 'application/json': { schema: admissionUpdateSchema, example: { status: 'PUBLISHED', officialSourceUrl: requirement.officialSourceUrl, verifiedAt: requirement.verifiedAt } } } } }, responses: { 200: success(adminAdmissionResponseSchema, { success: true, data: requirement }, 'Admission requirement updated.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404], 415: universityDetailsErrors[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/universities/{universityId}/gallery', tags: ['Admin — University Details'], summary: 'List University gallery associations', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Lists one University’s gallery associations, including draft and archived entries, with deterministic ordering and bounded pagination.',
    request: { params: detailUniversityParamSchema, query: detailsListQuerySchema }, responses: { 200: success(adminGalleryListResponseSchema, { success: true, data: { items: [image], pagination } }, 'Administrative gallery.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/universities/{universityId}/gallery', tags: ['Admin — University Details'], summary: 'Attach an uploaded image to a University gallery', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. First upload through /admin/uploads/images with resource=universities, then submit its secureUrl here. This operation creates only the University association and never deletes a Cloudinary asset.', request: { params: detailUniversityParamSchema, body: { required: true, content: { 'application/json': { schema: galleryCreateSchema, example: { imageUrl: image.imageUrl, altAr: image.altAr, altEn: image.altEn, status: 'DRAFT' } } } } }, responses: { 201: success(adminGalleryResponseSchema, { success: true, data: image }, 'Gallery image attached.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404], 415: universityDetailsErrors[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/university-gallery/{id}', tags: ['Admin — University Details'], summary: 'Edit or publish a gallery image', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Updates the secure URL, localized alternative text, or publication state without touching the Cloudinary asset.',
    request: { params: detailIdParamSchema, body: { required: true, content: { 'application/json': { schema: galleryUpdateSchema, example: { altAr: 'المبنى الرئيسي', status: 'PUBLISHED' } } } } }, responses: { 200: success(adminGalleryResponseSchema, { success: true, data: image }, 'Gallery image updated.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404], 415: universityDetailsErrors[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/universities/{universityId}/gallery/order', tags: ['Admin — University Details'], summary: 'Atomically reorder a University gallery', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Submit every non-archived image association for exactly one University in the desired order.', request: { params: detailUniversityParamSchema, body: { required: true, content: { 'application/json': { schema: galleryReorderSchema, example: { orderedIds: [IMAGE_ID] } } } } }, responses: { 200: success(galleryReorderResponseSchema, { success: true, data: { items: [image] } }, 'Gallery reordered.'), 400: universityDetailsErrors[400], 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404], 409: universityDetailsErrors[409], 415: universityDetailsErrors[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'delete', path: '/admin/university-gallery/{id}', tags: ['Admin — University Details'], summary: 'Detach a gallery image association', security: [{ accessCookie: [] }],
    description: 'ADMIN or SUPER_ADMIN only. Removes only the database association. The Cloudinary asset and University cover image are never deleted.', request: { params: detailIdParamSchema }, responses: { 200: success(galleryDetachResponseSchema, { success: true, data: { id: IMAGE_ID } }, 'Gallery association detached.'), 401: universityDetailsErrors[401], 403: universityDetailsErrors[403], 404: universityDetailsErrors[404] },
  })

  publicRoutes.use('/universities/:slug/admission-requirements', publicReadCors(authRuntime))
  publicRoutes.use('/universities/:slug/gallery', publicReadCors(authRuntime))
  adminRoutes.use('*', authCors(authRuntime))
  adminRoutes.use('*', requireTrustedOrigin(authRuntime))
  adminRoutes.use('*', requireAuthentication(authRuntime))
  adminRoutes.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))

  publicRoutes.get('/universities/:slug/admission-requirements', async (c) => {
    const { slug } = parse(detailSlugParamSchema, { slug: c.req.param('slug') })
    return c.json(successResponse(await runtime.getService().publicAdmissionRequirements(slug)), 200)
  })
  publicRoutes.get('/universities/:slug/gallery', async (c) => {
    const { slug } = parse(detailSlugParamSchema, { slug: c.req.param('slug') })
    return c.json(successResponse(await runtime.getService().publicGallery(slug)), 200)
  })
  adminRoutes.get('/universities/:universityId/admission-requirements', async (c) => {
    const { universityId } = parse(detailUniversityParamSchema, { universityId: c.req.param('universityId') })
    const query = parse(admissionListQuerySchema, queryObject(c.req.url)) as DetailsListQuery
    return c.json(successResponse(await runtime.getService().adminAdmissionRequirements(universityId, query)), 200)
  })
  adminRoutes.post('/universities/:universityId/admission-requirements', async (c) => {
    const { universityId } = parse(detailUniversityParamSchema, { universityId: c.req.param('universityId') })
    const body = parse(admissionCreateSchema, await readJson(c.req.raw))
    const input = { ...body, verifiedAt: body.verifiedAt ? new Date(body.verifiedAt) : null } as AdmissionRequirementInput
    return c.json(successResponse(await runtime.getService().createAdmissionRequirement(universityId, input, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/university-admission-requirements/:id', async (c) => {
    const { id } = parse(detailIdParamSchema, { id: c.req.param('id') })
    const body = parse(admissionUpdateSchema, await readJson(c.req.raw))
    const input = { ...body, ...(body.verifiedAt === undefined ? {} : { verifiedAt: body.verifiedAt ? new Date(body.verifiedAt) : null }) } as AdmissionRequirementUpdate
    return c.json(successResponse(await runtime.getService().updateAdmissionRequirement(id, input, c.get('authClaims').userId)), 200)
  })
  adminRoutes.get('/universities/:universityId/gallery', async (c) => {
    const { universityId } = parse(detailUniversityParamSchema, { universityId: c.req.param('universityId') })
    const query = parse(detailsListQuerySchema, queryObject(c.req.url)) as DetailsListQuery
    return c.json(successResponse(await runtime.getService().adminGallery(universityId, query)), 200)
  })
  adminRoutes.post('/universities/:universityId/gallery', async (c) => {
    const { universityId } = parse(detailUniversityParamSchema, { universityId: c.req.param('universityId') })
    const input = parse(galleryCreateSchema, await readJson(c.req.raw)) as GalleryImageInput
    return c.json(successResponse(await runtime.getService().createGalleryImage(universityId, input, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/university-gallery/:id', async (c) => {
    const { id } = parse(detailIdParamSchema, { id: c.req.param('id') })
    const input = parse(galleryUpdateSchema, await readJson(c.req.raw)) as GalleryImageUpdate
    return c.json(successResponse(await runtime.getService().updateGalleryImage(id, input, c.get('authClaims').userId)), 200)
  })
  adminRoutes.patch('/universities/:universityId/gallery/order', async (c) => {
    const { universityId } = parse(detailUniversityParamSchema, { universityId: c.req.param('universityId') })
    const { orderedIds } = parse(galleryReorderSchema, await readJson(c.req.raw))
    return c.json(successResponse(await runtime.getService().reorderGallery(universityId, orderedIds, c.get('authClaims').userId)), 200)
  })
  adminRoutes.delete('/university-gallery/:id', async (c) => {
    const { id } = parse(detailIdParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(await runtime.getService().detachGalleryImage(id, c.get('authClaims').userId)), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
