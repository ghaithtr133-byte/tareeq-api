import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { requireAuthentication, requireRole } from '../auth/middleware.js'
import { authCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthRuntime } from '../auth/runtime.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { ContentDetailsService, DetailInput, DetailKind, DetailParent } from './service.js'

const id = z.object({ id: z.uuid() })
const parentId = z.object({ parentId: z.uuid() })
const kind = z.enum(['STEP', 'BENEFIT', 'REQUIREMENT', 'APPLICATION_STEP'])
const input = z.object({ kind, titleAr: z.string().trim().min(1).max(300), descriptionAr: z.string().trim().min(1).max(20_000).nullable().optional(), bodyAr: z.string().trim().min(1).max(20_000).nullable().optional(), category: z.string().trim().min(1).max(80).nullable().optional(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(), coveragePeriod: z.string().trim().min(1).max(120).nullable().optional(), officialSourceUrl: z.url().nullable().optional(), verifiedAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict()
const update = input.partial().omit({ kind: true }).refine((value) => Object.keys(value).length > 0)
const reorder = z.object({ kind, orderedIds: z.array(z.uuid()).max(500).superRefine((ids, ctx) => { if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate IDs are not allowed.' }) }) }).strict()
const parse = <T>(schema: z.ZodType<T>, value: unknown) => { const result = schema.safeParse(value); if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', { fields: { _request: result.error.issues.map((issue) => issue.message) } }); return result.data }
const json = async (request: Request) => { if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'); try { return await request.json() } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.') } }
const settings: Array<{ parent: DetailParent; plural: string; child: string; tag: string }> = [
  { parent: 'COUNTRY_GUIDE', plural: 'countries', child: 'study-guide', tag: 'Admin — Countries' },
  { parent: 'SERVICE', plural: 'services', child: 'service-detail-items', tag: 'Admin — Services' },
  { parent: 'SCHOLARSHIP', plural: 'scholarships', child: 'scholarship-detail-items', tag: 'Admin — Scholarships' },
]

export const createContentDetailsRoutes = (service: ContentDetailsService, auth: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>(); const admin = new OpenAPIHono<AuthEnv>()
  admin.use('*', authCors(auth)); admin.use('*', requireTrustedOrigin(auth)); admin.use('*', requireAuthentication(auth)); admin.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))
  for (const setting of settings) {
    const base = `/admin/${setting.plural}/{parentId}/${setting.child}`
    routes.openAPIRegistry.registerPath({ method: 'get', path: base, tags: [setting.tag], summary: `List ${setting.child}`, description: 'ADMIN or SUPER_ADMIN only. Returns deterministic ordered entries for exactly one parent.', security: [{ accessCookie: [] }], request: { params: parentId, query: z.object({ kind: kind.optional() }) }, responses: { 200: { description: 'Ordered content detail entries.', content: { 'application/json': { example: { success: true, data: { items: [] } } } } } } })
    routes.openAPIRegistry.registerPath({ method: 'post', path: base, tags: [setting.tag], summary: `Create ${setting.child} entry`, description: 'ADMIN or SUPER_ADMIN only. Appends an entry atomically and writes an audit record.', security: [{ accessCookie: [] }], request: { params: parentId, body: { required: true, content: { 'application/json': { schema: input, example: { kind: 'STEP', titleAr: 'عنوان' } } } } }, responses: { 201: { description: 'Created.', content: { 'application/json': { example: { success: true, data: { id: '20000000-0000-4000-8000-000000000001' } } } } } } })
    routes.openAPIRegistry.registerPath({ method: 'patch', path: `${base}/order`, tags: [setting.tag], summary: `Atomically reorder ${setting.child}`, description: 'ADMIN or SUPER_ADMIN only. The submitted IDs must exactly match the parent and kind collection.', security: [{ accessCookie: [] }], request: { params: parentId, body: { required: true, content: { 'application/json': { schema: reorder, example: { kind: 'STEP', orderedIds: ['20000000-0000-4000-8000-000000000001'] } } } } }, responses: { 200: { description: 'Reordered.', content: { 'application/json': { example: { success: true, data: { items: [] } } } } } } })
    routes.openAPIRegistry.registerPath({ method: 'patch', path: `/admin/${setting.child}/{id}`, tags: [setting.tag], summary: `Update ${setting.child} entry`, description: 'ADMIN or SUPER_ADMIN only. Partial update; parent and kind are immutable.', security: [{ accessCookie: [] }], request: { params: id, body: { required: true, content: { 'application/json': { schema: update, example: { titleAr: 'عنوان محدّث' } } } } }, responses: { 200: { description: 'Updated.', content: { 'application/json': { example: { success: true, data: { id: '20000000-0000-4000-8000-000000000001' } } } } } } })
    routes.openAPIRegistry.registerPath({ method: 'delete', path: `/admin/${setting.child}/{id}`, tags: [setting.tag], summary: `Delete ${setting.child} entry`, description: 'ADMIN or SUPER_ADMIN only. Deletes only the selected database detail entry and writes an audit record.', security: [{ accessCookie: [] }], request: { params: id }, responses: { 200: { description: 'Deleted.', content: { 'application/json': { example: { success: true, data: { id: '20000000-0000-4000-8000-000000000001' } } } } } } })
    admin.get(`/${setting.plural}/:parentId/${setting.child}`, async (c) => c.json(successResponse(await service.list(setting.parent, parse(parentId, { parentId: c.req.param('parentId') }).parentId, new URL(c.req.url).searchParams.get('kind') as DetailKind | null ?? undefined)), 200))
    admin.post(`/${setting.plural}/:parentId/${setting.child}`, async (c) => { const body = parse(input, await json(c.req.raw)); return c.json(successResponse(await service.create(setting.parent, parse(parentId, { parentId: c.req.param('parentId') }).parentId, { ...body, verifiedAt: body.verifiedAt ? new Date(body.verifiedAt) : body.verifiedAt } as DetailInput & { kind: DetailKind; titleAr: string }, c.get('authClaims').userId)), 201) })
    admin.patch(`/${setting.plural}/:parentId/${setting.child}/order`, async (c) => { const body = parse(reorder, await json(c.req.raw)); return c.json(successResponse(await service.reorder(setting.parent, parse(parentId, { parentId: c.req.param('parentId') }).parentId, body.kind, body.orderedIds, c.get('authClaims').userId)), 200) })
    admin.patch(`/${setting.child}/:id`, async (c) => { const body = parse(update, await json(c.req.raw)); const value = { ...body, ...(body.verifiedAt === undefined ? {} : { verifiedAt: body.verifiedAt ? new Date(body.verifiedAt) : null }) } as DetailInput; return c.json(successResponse(await service.update(setting.parent, parse(id, { id: c.req.param('id') }).id, value, c.get('authClaims').userId)), 200) })
    admin.delete(`/${setting.child}/:id`, async (c) => c.json(successResponse(await service.remove(setting.parent, parse(id, { id: c.req.param('id') }).id, c.get('authClaims').userId)), 200))
  }
  routes.route('/admin', admin); return routes
}
