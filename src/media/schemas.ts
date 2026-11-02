import { z } from '@hono/zod-openapi'

import {
  errorResponseSchema,
  successEnvelopeSchema,
} from '../shared/http.js'
import { mediaResources } from './types.js'
import {
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_BODY_BYTES,
} from './validation.js'

export const mediaResourceSchema = z.enum(mediaResources).openapi('MediaResource')

export const imageUploadFormSchema = z.object({
  resource: mediaResourceSchema,
  file: z.custom<File>(
    (value) => typeof File !== 'undefined' && value instanceof File,
    'Select one image file.',
  ),
}).strict()

export const imageUploadRequestSchema = z.object({
  resource: mediaResourceSchema.openapi({
    description: 'Content resource that will use the uploaded image.',
    example: 'countries',
  }),
  file: z.string().openapi({
    type: 'string',
    format: 'binary',
    description: `JPEG, PNG, or WebP image up to ${MAX_IMAGE_BYTES} bytes. The complete multipart body must not exceed ${MAX_MULTIPART_BODY_BYTES} bytes.`,
  }),
}).openapi('ImageUploadRequest')

export const uploadedImageSchema = z.object({
  assetId: z.string(),
  publicId: z.string(),
  secureUrl: z.url().refine((value) => value.startsWith('https://')),
  format: z.enum(['jpg', 'png', 'webp']),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).openapi('UploadedImage')

export const imageUploadResponseSchema = successEnvelopeSchema(uploadedImageSchema)
  .openapi('ImageUploadResponse')

const jsonError = (description: string, code: string, message: string, details: unknown = {}) => ({
  description,
  content: {
    'application/json': {
      schema: errorResponseSchema,
      example: { success: false, error: { code, message, details } },
    },
  },
})

export const imageUploadErrorResponses = {
  400: jsonError(
    'The multipart fields or image contents are invalid.',
    'INVALID_IMAGE_FILE',
    'The uploaded file is not a valid supported image.',
    { fields: { file: ['Provide a complete JPEG, PNG, or WebP image.'] } },
  ),
  401: jsonError(
    'Authentication is required.',
    'AUTHENTICATION_REQUIRED',
    'Authentication is required.',
  ),
  403: jsonError(
    'The browser origin is not trusted or the administrator lacks permission.',
    'FORBIDDEN',
    'Request is forbidden.',
  ),
  413: jsonError(
    'The image or multipart request is too large.',
    'IMAGE_TOO_LARGE',
    'The uploaded image is too large.',
    { maxBytes: MAX_IMAGE_BYTES },
  ),
  415: jsonError(
    'The request is not multipart form data or the image format is unsupported.',
    'UNSUPPORTED_IMAGE_TYPE',
    'Only JPEG, PNG, and WebP images are supported.',
  ),
  502: jsonError(
    'Cloudinary rejected or could not complete the upload.',
    'MEDIA_UPLOAD_FAILED',
    'Image upload failed. Please try again.',
  ),
  503: jsonError(
    'Cloudinary is not configured for this Backend environment.',
    'MEDIA_UPLOAD_UNAVAILABLE',
    'Image uploads are temporarily unavailable.',
  ),
} as const

export const imageUploadExample = {
  success: true,
  data: {
    assetId: '5c2f098df3b6a4f6cda3aee7a9f8ca14',
    publicId: 'tareeq-academy/countries/4a75898e-c65a-44c0-b91a-aef84e0b31c7',
    secureUrl: 'https://res.cloudinary.com/example/image/upload/v1700000000/tareeq-academy/countries/4a75898e-c65a-44c0-b91a-aef84e0b31c7.webp',
    format: 'webp',
    bytes: 183204,
    width: 1600,
    height: 900,
  },
}
