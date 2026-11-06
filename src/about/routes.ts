import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, publicReadCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, successResponse } from '../shared/http.js'
import type { AboutUsRuntime } from './runtime.js'
import { aboutUsAdminResponseSchema, aboutUsErrorResponses, aboutUsPublicResponseSchema, aboutUsUpdateSchema } from './schemas.js'
import type { AboutUsUpdate } from './types.js'

const example = {
  id: '00000000-0000-4000-8000-000000000010',
  heroTitleAr: 'عن أكاديمية طريق', heroTitleEn: 'About Tareeq Academy',
  heroSubtitleAr: 'نساعد الطلاب على اتخاذ قرارات دراسية مستنيرة.', heroSubtitleEn: null,
  heroImageUrl: 'https://res.cloudinary.com/example/image/upload/tareeq-academy/about/hero.webp', heroImageAltAr: 'طلاب في حرم جامعي', heroImageAltEn: null,
  introTitleAr: 'من نحن', introTitleEn: 'Who we are', introBodyAr: 'محتوى تعريفي متعدد الأسطر.\nيُدار من لوحة الإدارة.', introBodyEn: null,
  introImageUrl: null, introImageAltAr: null, introImageAltEn: null,
  missionTitleAr: null, missionTitleEn: null, missionBodyAr: null, missionBodyEn: null,
  visionTitleAr: null, visionTitleEn: null, visionBodyAr: null, visionBodyEn: null,
  ctaTitleAr: null, ctaTitleEn: null, ctaDescriptionAr: null, ctaDescriptionEn: null, ctaButtonLabelAr: null, ctaButtonLabelEn: null,
  seoTitleAr: 'عن أكاديمية طريق', seoDescriptionAr: null,
  publishedAt: '2026-11-04T12:00:00.000Z', createdAt: '2026-11-04T11:00:00.000Z', updatedAt: '2026-11-04T12:00:00.000Z', status: 'PUBLISHED',
}

const validationError = (issues: z.core.$ZodIssue[]) => new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', {
  fields: issues.reduce<Record<string, string[]>>((fields, issue) => {
    const field = issue.path.join('.') || '_request'
    ;(fields[field] ??= []).push(issue.message)
    return fields
  }, {}),
})

const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try { return await request.json() } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', { fields: { _request: ['Provide a valid JSON request body.'] } })
  }
}

export const createAboutUsRoutes = (runtime: AboutUsRuntime, authRuntime: AuthRuntime) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()
  const publicExample = { ...example }
  delete (publicExample as Partial<typeof example>).status
  delete (publicExample as Partial<typeof example>).createdAt

  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/about', tags: ['Public — About Us'], summary: 'Get published About Us content',
    description: 'Returns the singleton About Us page only when its status is PUBLISHED. Missing, DRAFT, and ARCHIVED states return CONTENT_NOT_FOUND.', security: [],
    responses: { 200: { description: 'Published About Us content.', content: { 'application/json': { schema: aboutUsPublicResponseSchema, example: { success: true, data: publicExample } } } }, 404: aboutUsErrorResponses[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get', path: '/admin/about', tags: ['Admin — About Us'], summary: 'Get editable About Us content',
    description: 'ADMIN or SUPER_ADMIN only. Returns the singleton in any publication state. If no record has been created, returns CONTENT_NOT_FOUND.', security: [{ accessCookie: [] }],
    responses: { 200: { description: 'Editable About Us content.', content: { 'application/json': { schema: aboutUsAdminResponseSchema, example: { success: true, data: example } } } }, 401: aboutUsErrorResponses[401], 403: aboutUsErrorResponses[403], 404: aboutUsErrorResponses[404] },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch', path: '/admin/about', tags: ['Admin — About Us'], summary: 'Create or update About Us content',
    description: 'ADMIN or SUPER_ADMIN only. Creates the singleton on its first PATCH or merges supplied fields into it. Omitted fields are preserved. Publishing validates the fully merged record: heroTitleAr, heroSubtitleAr, introTitleAr, and introBodyAr are required. The first publishedAt timestamp is retained across later updates and unpublishing.', security: [{ accessCookie: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: aboutUsUpdateSchema, example: { heroTitleAr: 'عن أكاديمية طريق', heroSubtitleAr: 'نساعد الطلاب على اتخاذ قرارات دراسية مستنيرة.', introTitleAr: 'من نحن', introBodyAr: 'نص تعريفي متعدد الأسطر.\nيُحفظ كما هو.', status: 'PUBLISHED' } } } } },
    responses: { 200: { description: 'About Us content created or updated.', content: { 'application/json': { schema: aboutUsAdminResponseSchema, example: { success: true, data: example } } } }, 400: aboutUsErrorResponses[400], 401: aboutUsErrorResponses[401], 403: aboutUsErrorResponses[403], 415: aboutUsErrorResponses[415] },
  })

  publicRoutes.use('/about', publicReadCors(authRuntime))
  adminRoutes.use('/about', authCors(authRuntime))
  adminRoutes.use('/about', requireTrustedOrigin(authRuntime))
  adminRoutes.use('/about', requireAuthentication(authRuntime))
  adminRoutes.use('/about', requireRole('ADMIN', 'SUPER_ADMIN'))
  publicRoutes.get('/about', async (c) => c.json(successResponse(await runtime.getService().getPublic()), 200))
  adminRoutes.get('/about', async (c) => c.json(successResponse(await runtime.getService().getAdmin()), 200))
  adminRoutes.patch('/about', async (c) => {
    const parsed = aboutUsUpdateSchema.safeParse(await readJson(c.req.raw))
    if (!parsed.success) throw validationError(parsed.error.issues)
    return c.json(successResponse(await runtime.getService().update(c.get('authClaims').userId, parsed.data as AboutUsUpdate)), 200)
  })
  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
