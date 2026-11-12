import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, publicReadCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { FaqRuntime } from './runtime.js'
import {
  adminFaqListQuerySchema,
  adminFaqListResponseSchema,
  adminFaqResponseSchema,
  faqCreateSchema,
  faqDeleteResponseSchema,
  faqErrorResponses,
  faqIdParamSchema,
  faqOrderResponseSchema,
  faqReorderSchema,
  faqSlugParamSchema,
  faqUpdateSchema,
  globalFaqQuerySchema,
  nestedFaqQuerySchema,
  publicFaqListResponseSchema,
} from './schemas.js'
import type { FaqCreateInput, FaqListQuery, FaqParent, FaqUpdateInput } from './types.js'

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
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try { return await request.json() } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', {
      fields: { _request: ['Provide a valid JSON request body.'] },
    })
  }
}

const faqExample = {
  id: 'f0000000-0000-4000-8000-000000000001', scope: 'COUNTRY',
  parentId: '9879d0a4-9b7e-48d1-850a-da51be9de671',
  questionAr: 'ما هي متطلبات الدراسة؟', answerAr: 'تختلف المتطلبات حسب الجامعة والبرنامج.',
  questionEn: 'What are the study requirements?', answerEn: 'Requirements vary by university and program.',
  status: 'PUBLISHED', displayOrder: 0, publishedAt: '2026-11-02T12:00:00.000Z',
  createdAt: '2026-11-02T12:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z',
}
const publicFaqExample = {
  id: faqExample.id,
  scope: faqExample.scope,
  questionAr: faqExample.questionAr,
  answerAr: faqExample.answerAr,
  questionEn: faqExample.questionEn,
  answerEn: faqExample.answerEn,
  displayOrder: faqExample.displayOrder,
  publishedAt: faqExample.publishedAt,
}
const publicListExample = { success: true, data: { items: [publicFaqExample], pagination: { page: 1, limit: 5, total: 1, totalPages: 1 } } }
const adminListExample = { success: true, data: { items: [faqExample], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } } }

const nested = [
  { resource: 'countries', scope: 'COUNTRY' },
  { resource: 'universities', scope: 'UNIVERSITY' },
  { resource: 'services', scope: 'SERVICE' },
  { resource: 'scholarships', scope: 'SCHOLARSHIP' },
] as const

export const createFaqRoutes = (runtime: FaqRuntime, authRuntime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/faqs', tags: ['Public — FAQs'], summary: 'List published Homepage FAQs',
    description: 'Public GLOBAL FAQ collection. Returns only PUBLISHED entries, ordered by displayOrder then ID. Defaults to the first five and supports pagination for loading more.',
    request: { query: globalFaqQuerySchema },
    responses: { 200: { description: 'Published Homepage FAQs.', content: { 'application/json': { schema: publicFaqListResponseSchema, example: publicListExample } } }, 400: faqErrorResponses[400] },
  })
  for (const item of nested) {
    routes.openAPIRegistry.registerPath({
      method: 'get', path: `/${item.resource}/{slug}/faqs`, tags: ['Public — FAQs'],
      summary: `List published ${item.scope.toLowerCase()} FAQs`,
      description: `Public ${item.scope} FAQ collection. The parent must exist and be PUBLISHED. Results cannot include another parent’s FAQs and default to five entries.`,
      request: { params: faqSlugParamSchema, query: nestedFaqQuerySchema },
      responses: {
        200: { description: `Published ${item.scope.toLowerCase()} FAQs.`, content: { 'application/json': { schema: publicFaqListResponseSchema, example: publicListExample } } },
        400: faqErrorResponses[400], 404: faqErrorResponses[404],
      },
    })
  }
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/faqs', tags: ['Admin — FAQs'], summary: 'List FAQs for one scope and parent',
    description: 'ADMIN or SUPER_ADMIN only. GLOBAL requires no parentId; every resource scope requires its current content UUID. Includes drafts, published, and archived entries through bounded pagination.',
    security: [{ accessCookie: [] }], request: { query: adminFaqListQuerySchema },
    responses: { 200: { description: 'Scoped administrative FAQ collection.', content: { 'application/json': { schema: adminFaqListResponseSchema, example: adminListExample } } }, 400: faqErrorResponses[400], 401: faqErrorResponses[401], 403: faqErrorResponses[403] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post', path: '/admin/faqs', tags: ['Admin — FAQs'], summary: 'Create a scoped FAQ',
    description: 'ADMIN or SUPER_ADMIN only. The supplied parent UUID is validated against scope; GLOBAL accepts no parent. New entries append to the parent order. Full FAQ answers are never copied into audit metadata.',
    security: [{ accessCookie: [] }], request: { body: { required: true, content: { 'application/json': { schema: faqCreateSchema, example: { scope: 'COUNTRY', parentId: faqExample.parentId, questionAr: faqExample.questionAr, answerAr: faqExample.answerAr, status: 'DRAFT' } } } } },
    responses: { 201: { description: 'FAQ created.', content: { 'application/json': { schema: adminFaqResponseSchema, example: { success: true, data: faqExample } } } }, 400: faqErrorResponses[400], 401: faqErrorResponses[401], 403: faqErrorResponses[403], 415: faqErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/faqs/{id}', tags: ['Admin — FAQs'], summary: 'Edit, publish, unpublish, or archive an FAQ',
    description: 'ADMIN or SUPER_ADMIN only. A PATCH may atomically move an FAQ by supplying both scope and parentId; ordering is repaired in the previous group and the FAQ appends in its new group.',
    security: [{ accessCookie: [] }], request: { params: faqIdParamSchema, body: { required: true, content: { 'application/json': { schema: faqUpdateSchema, example: { status: 'PUBLISHED' } } } } },
    responses: { 200: { description: 'FAQ updated.', content: { 'application/json': { schema: adminFaqResponseSchema, example: { success: true, data: faqExample } } } }, 400: faqErrorResponses[400], 401: faqErrorResponses[401], 403: faqErrorResponses[403], 404: faqErrorResponses[404], 415: faqErrorResponses[415] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'delete', path: '/admin/faqs/{id}', tags: ['Admin — FAQs'], summary: 'Delete a draft or archived FAQ',
    description: 'ADMIN or SUPER_ADMIN only. Published FAQs are protected and must be archived first. This never affects the linked parent resource.', security: [{ accessCookie: [] }], request: { params: faqIdParamSchema },
    responses: { 200: { description: 'FAQ deleted.', content: { 'application/json': { schema: faqDeleteResponseSchema, example: { success: true, data: { id: faqExample.id } } } } }, 401: faqErrorResponses[401], 403: faqErrorResponses[403], 404: faqErrorResponses[404], 409: faqErrorResponses[409] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/faqs/order', tags: ['Admin — FAQs'], summary: 'Atomically reorder one parent’s active FAQs',
    description: 'ADMIN or SUPER_ADMIN only. Submit every non-archived FAQ ID for exactly one scope/parent in desired order. Duplicate, missing, stale, or cross-parent IDs are rejected atomically.',
    security: [{ accessCookie: [] }], request: { body: { required: true, content: { 'application/json': { schema: faqReorderSchema, example: { scope: 'COUNTRY', parentId: faqExample.parentId, orderedIds: [faqExample.id] } } } } },
    responses: {
      200: {
        description: 'Reordered non-archived FAQs.',
        content: { 'application/json': {
          schema: faqOrderResponseSchema,
          example: { success: true, data: { items: [faqExample] } },
        } },
      },
      400: faqErrorResponses[400], 401: faqErrorResponses[401],
      403: faqErrorResponses[403], 409: faqErrorResponses[409],
      415: faqErrorResponses[415],
    },
  })

  publicRoutes.use('/faqs', publicReadCors(authRuntime))
  for (const item of nested) {
    publicRoutes.use(`/${item.resource}/:slug/faqs`, publicReadCors(authRuntime))
  }
  adminRoutes.use('*', authCors(authRuntime))
  adminRoutes.use('*', requireTrustedOrigin(authRuntime))
  adminRoutes.use('*', requireAuthentication(authRuntime))
  adminRoutes.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))

  publicRoutes.get('/faqs', async (c) => {
    const query = parse(globalFaqQuerySchema, queryObject(c.req.url))
    return c.json(successResponse(await runtime.getService().listGlobal(query.page, query.limit)), 200)
  })
  for (const item of nested) {
    publicRoutes.get(`/${item.resource}/:slug/faqs`, async (c) => {
      const { slug } = parse(faqSlugParamSchema, { slug: c.req.param('slug') })
      const query = parse(nestedFaqQuerySchema, queryObject(c.req.url))
      return c.json(successResponse(await runtime.getService().listPublic(item.scope, slug, query.page, query.limit)), 200)
    })
  }
  adminRoutes.get('/faqs', async (c) => {
    const query = parse(adminFaqListQuerySchema, queryObject(c.req.url)) as FaqListQuery
    return c.json(successResponse(await runtime.getService().listAdmin(query)), 200)
  })
  adminRoutes.post('/faqs', async (c) => {
    const input = parse(faqCreateSchema, await readJson(c.req.raw)) as FaqCreateInput
    return c.json(successResponse(await runtime.getService().create(input, c.get('authClaims').userId)), 201)
  })
  adminRoutes.patch('/faqs/order', async (c) => {
    const input = parse(faqReorderSchema, await readJson(c.req.raw)) as FaqParent & { orderedIds: string[] }
    return c.json(successResponse(await runtime.getService().reorder(input, input.orderedIds, c.get('authClaims').userId)), 200)
  })
  adminRoutes.patch('/faqs/:id', async (c) => {
    const { id } = parse(faqIdParamSchema, { id: c.req.param('id') })
    const input = parse(faqUpdateSchema, await readJson(c.req.raw)) as FaqUpdateInput
    return c.json(successResponse(await runtime.getService().update(id, input, c.get('authClaims').userId)), 200)
  })
  adminRoutes.delete('/faqs/:id', async (c) => {
    const { id } = parse(faqIdParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(await runtime.getService().delete(id, c.get('authClaims').userId)), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
