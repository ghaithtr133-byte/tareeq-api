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
import type { SiteSettingsRuntime } from './runtime.js'
import {
  siteSettingsErrorResponses,
  siteSettingsResponseSchema,
  siteSettingsUpdateSchema,
} from './schemas.js'
import type { SiteSettingsUpdate } from './types.js'

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

const settingsExample = {
  academyNameAr: 'أكاديمية طريق',
  academyNameEn: 'Tareeq Academy',
  contactEmail: 'contact@example.invalid',
  contactPhone: '+963 900 000 000',
  addressAr: 'دمشق، سوريا',
  addressEn: 'Damascus, Syria',
  facebookUrl: 'https://www.facebook.com/tareeqacademy',
  instagramUrl: 'https://www.instagram.com/tareeqacademy',
  linkedinUrl: 'https://www.linkedin.com/company/tareeqacademy',
  youtubeUrl: 'https://www.youtube.com/@tareeqacademy',
  updatedAt: '2026-11-01T10:00:00.000Z',
}

export const createSiteSettingsRoutes = (
  runtime: SiteSettingsRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/site-settings',
    tags: ['Public — Site Settings'],
    summary: 'Get public site settings',
    description: 'Public organizational display and contact settings. Before the singleton is initialized, every allowlisted field and `updatedAt` safely returns null.',
    responses: {
      200: {
        description: 'Public site settings.',
        content: { 'application/json': {
          schema: siteSettingsResponseSchema,
          example: { success: true, data: settingsExample },
        } },
      },
    },
  })

  routes.openAPIRegistry.registerPath({
    method: 'patch',
    path: '/admin/site-settings',
    tags: ['Admin — Site Settings'],
    summary: 'Update public site settings',
    description: 'SUPER_ADMIN only. Updates only explicitly allowlisted public organization, contact, address, and supported social-link fields. Null clears a field. Environment variables, credentials, and arbitrary keys are never accepted.',
    security: [{ accessCookie: [] }],
    request: { body: { required: true, content: {
      'application/json': {
        schema: siteSettingsUpdateSchema,
        example: {
          contactEmail: 'contact@example.invalid',
          facebookUrl: 'https://www.facebook.com/tareeqacademy',
        },
      },
    } } },
    responses: {
      200: {
        description: 'Updated public site settings.',
        content: { 'application/json': {
          schema: siteSettingsResponseSchema,
          example: { success: true, data: settingsExample },
        } },
      },
      400: siteSettingsErrorResponses[400],
      401: siteSettingsErrorResponses[401],
      403: siteSettingsErrorResponses[403],
      415: siteSettingsErrorResponses[415],
    },
  })

  publicRoutes.use('/site-settings', publicReadCors(authRuntime))
  adminRoutes.use('/site-settings', authCors(authRuntime))
  adminRoutes.use('/site-settings', requireTrustedOrigin(authRuntime))
  adminRoutes.use('/site-settings', requireAuthentication(authRuntime))
  adminRoutes.use('/site-settings', requireRole('SUPER_ADMIN'))

  publicRoutes.get('/site-settings', async (c) =>
    c.json(successResponse(await runtime.getService().getPublic()), 200))

  adminRoutes.patch('/site-settings', async (c) => {
    const result = siteSettingsUpdateSchema.safeParse(await readJson(c.req.raw))
    if (!result.success) throw validationError(result.error.issues)
    return c.json(successResponse(await runtime.getService().update(
      c.get('authClaims').userId,
      result.data as SiteSettingsUpdate,
    )), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
