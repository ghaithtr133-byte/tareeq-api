import { bodyLimit } from 'hono/body-limit'
import { OpenAPIHono, type z } from '@hono/zod-openapi'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import { authCors, requireTrustedOrigin } from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import {
  ApiError,
  errorResponse,
  successResponse,
} from '../shared/http.js'
import type { MediaRuntime } from './runtime.js'
import {
  imageUploadErrorResponses,
  imageUploadExample,
  imageUploadFormSchema,
  imageUploadRequestSchema,
  imageUploadResponseSchema,
} from './schemas.js'
import { ImageProviderError } from './types.js'
import {
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_BODY_BYTES,
} from './validation.js'

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'The request contains invalid fields.',
    { fields },
  )
}

const parseForm = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be multipart/form-data.',
    )
  }
  let body: Record<string, string | File>
  try {
    body = await request.formData().then((form) => Object.fromEntries(form))
  } catch {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'The multipart request body is invalid.',
      { fields: { _request: ['Provide valid multipart form data.'] } },
    )
  }
  const parsed = imageUploadFormSchema.safeParse(body)
  if (!parsed.success) throw validationError(parsed.error.issues)
  return parsed.data
}

export const createMediaRoutes = (
  mediaRuntime: MediaRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/admin/uploads/images',
    tags: ['Admin — Media'],
    summary: 'Upload a content image',
    description: `ADMIN or SUPER_ADMIN only. Accepts one verified JPEG, PNG, or WebP image up to ${MAX_IMAGE_BYTES} bytes for a Country, University, Scholarship, Service, Article, About Us page, or fixed marketing page. The complete multipart body is limited to ${MAX_MULTIPART_BODY_BYTES} bytes for Vercel Functions compatibility. Returns the Cloudinary secure URL and stable identifiers; use \`secureUrl\` in the existing content image field. This endpoint does not create, update, replace, or delete a content record.`,
    security: [{ accessCookie: [] }],
    request: {
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: imageUploadRequestSchema,
            example: { resource: 'countries', file: '(binary image file)' },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Image uploaded to Cloudinary.',
        content: {
          'application/json': {
            schema: imageUploadResponseSchema,
            example: imageUploadExample,
          },
        },
      },
      ...imageUploadErrorResponses,
    },
  })

  adminRoutes.use('*', authCors(authRuntime))
  adminRoutes.use('*', requireTrustedOrigin(authRuntime))
  adminRoutes.use('*', requireAuthentication(authRuntime))
  adminRoutes.use('*', requireRole('ADMIN', 'SUPER_ADMIN'))
  adminRoutes.use('*', bodyLimit({
    maxSize: MAX_MULTIPART_BODY_BYTES,
    onError: (c) => errorResponse(
      c,
      413,
      'IMAGE_TOO_LARGE',
      'The uploaded image is too large.',
      { maxBytes: MAX_IMAGE_BYTES },
    ),
  }))

  adminRoutes.post('/uploads/images', async (c) => {
    const { resource, file } = await parseForm(c.req.raw)
    try {
      return c.json(successResponse(
        await mediaRuntime.getService().uploadImage(resource, file),
      ), 201)
    } catch (error) {
      if (!(error instanceof ImageProviderError)) throw error
      if (error.code === 'PROVIDER_NOT_CONFIGURED') {
        throw new ApiError(
          503,
          'MEDIA_UPLOAD_UNAVAILABLE',
          'Image uploads are temporarily unavailable.',
        )
      }
      console.error('Cloudinary image upload failed.', {
        requestId: c.get('requestId'),
        error: error.code,
      })
      throw new ApiError(
        502,
        'MEDIA_UPLOAD_FAILED',
        'Image upload failed. Please try again.',
      )
    }
  })

  routes.route('/admin', adminRoutes)
  return routes
}
