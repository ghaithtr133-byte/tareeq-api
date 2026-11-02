import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import { AuthService } from '../src/auth/service.js'
import type { AdminRole } from '../src/auth/types.js'
import type { AuthConfig } from '../src/config/env.js'
import {
  ImageProviderError,
  type ImageProvider,
  type ImageUploadInput,
} from '../src/media/types.js'
import { UnavailableImageProvider } from '../src/media/provider.js'
import type { MediaRuntime } from '../src/media/runtime.js'
import { MediaService } from '../src/media/service.js'
import {
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_BODY_BYTES,
} from '../src/media/validation.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'

const ORIGIN = 'https://admin.tareeq-academy.com'
const JWT_SECRET = 'media-api-test-secret-that-is-longer-than-thirty-two-characters'
const ADMIN_ID = 'a4a2ec6a-c2e0-48ca-99e4-d11353120b20'
const SUPER_ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const crc32 = (value: Buffer) => {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngWithSize = (size: number) => {
  const chunkPayloadSize = size - PNG.length - 12
  if (chunkPayloadSize < 0) throw new Error('Requested PNG size is too small.')
  const chunkType = Buffer.from('npAD', 'ascii')
  const chunkPayload = Buffer.alloc(chunkPayloadSize)
  const chunk = Buffer.alloc(12 + chunkPayloadSize)
  chunk.writeUInt32BE(chunkPayloadSize, 0)
  chunkType.copy(chunk, 4)
  chunkPayload.copy(chunk, 8)
  chunk.writeUInt32BE(
    crc32(Buffer.concat([chunkType, chunkPayload])),
    8 + chunkPayloadSize,
  )
  return Buffer.concat([
    PNG.subarray(0, PNG.length - 12),
    chunk,
    PNG.subarray(PNG.length - 12),
  ])
}

const config: AuthConfig = {
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  jwtSecret: JWT_SECRET,
  allowedOrigins: [ORIGIN],
  publicAllowedOrigins: [],
  isProduction: false,
}

class MockImageProvider implements ImageProvider {
  readonly available = true
  readonly calls: ImageUploadInput[] = []

  constructor(private readonly failureCode?: string) {}

  async upload(input: ImageUploadInput) {
    this.calls.push(input)
    if (this.failureCode) throw new ImageProviderError(this.failureCode)
    return {
      assetId: 'asset-123',
      publicId: input.publicId,
      secureUrl: `https://res.cloudinary.com/example/image/upload/v1/${input.publicId}.png`,
      format: input.format,
      bytes: input.buffer.length,
      width: 1,
      height: 1,
    }
  }
}

describe('Task #7 Cloudinary media upload API', () => {
  let adminToken: string
  let superAdminToken: string
  let provider: MockImageProvider
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    adminToken = await signAccessToken({ id: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET)
    superAdminToken = await signAccessToken({
      id: SUPER_ADMIN_ID,
      role: 'SUPER_ADMIN',
    }, JWT_SECRET)
  })

  const buildApp = (imageProvider: ImageProvider) => {
    const authRepository = new InMemoryAuthRepository()
    authRepository.addUser({
      id: ADMIN_ID,
      name: 'Content Admin',
      email: 'content-admin@example.invalid',
      passwordHash: '$argon2id$test-only',
      role: 'ADMIN',
      isActive: true,
    })
    authRepository.addUser({
      id: SUPER_ADMIN_ID,
      name: 'Super Admin',
      email: 'super-admin@example.invalid',
      passwordHash: '$argon2id$test-only',
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    const authRuntime: AuthRuntime = {
      getConfig: () => config,
      getService: () => new AuthService(authRepository, JWT_SECRET),
    }
    const mediaRuntime: MediaRuntime = {
      getService: () => new MediaService(
        imageProvider,
        'tareeq-academy',
        () => '11111111-2222-4333-8444-555555555555',
      ),
    }
    return createApp({ authRuntime, mediaRuntime })
  }

  beforeEach(() => {
    provider = new MockImageProvider()
    app = buildApp(provider)
  })

  const upload = (
    file: File,
    options: {
      resource?: string
      role?: AdminRole
      token?: string | null
      origin?: string
    } = {},
  ) => {
    const form = new FormData()
    form.set('resource', options.resource ?? 'countries')
    form.set('file', file)
    const roleToken = options.role === 'SUPER_ADMIN' ? superAdminToken : adminToken
    const token = options.token === undefined ? roleToken : options.token
    return app.request('/api/v1/admin/uploads/images', {
      method: 'POST',
      headers: {
        Origin: options.origin ?? ORIGIN,
        ...(token ? { Cookie: `${ACCESS_COOKIE_NAME}=${token}` } : {}),
      },
      body: form,
    })
  }

  const pngFile = () => new File([PNG], 'country.png', { type: 'image/png' })

  it('requires an authenticated approved role and a trusted origin before upload', async () => {
    const unauthenticated = await upload(pngFile(), { token: null })
    expect(unauthenticated.status).toBe(401)
    await expect(unauthenticated.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    })

    const untrusted = await upload(pngFile(), { origin: 'https://invalid.example' })
    expect(untrusted.status).toBe(403)
    await expect(untrusted.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED' },
    })
    expect(provider.calls).toHaveLength(0)
  })

  it('rejects unsupported, mismatched, and malformed image contents', async () => {
    const svg = await upload(new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>'],
      'unsafe.svg',
      { type: 'image/svg+xml' },
    ))
    expect(svg.status).toBe(415)
    await expect(svg.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'UNSUPPORTED_IMAGE_TYPE' },
    })

    const mismatch = await upload(new File([PNG], 'wrong.jpg', { type: 'image/jpeg' }))
    expect(mismatch.status).toBe(415)
    await expect(mismatch.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'IMAGE_TYPE_MISMATCH' },
    })

    const malformed = await upload(new File(
      [PNG.subarray(0, 20)],
      'truncated.png',
      { type: 'image/png' },
    ))
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'INVALID_IMAGE_FILE',
        details: { fields: { file: expect.any(Array) } },
      },
    })
    expect(provider.calls).toHaveLength(0)
  })

  it('accepts exactly 4,000,000 image bytes and rejects one byte more', async () => {
    const boundaryImage = pngWithSize(MAX_IMAGE_BYTES)
    expect(boundaryImage).toHaveLength(4_000_000)
    const accepted = await upload(new File(
      [boundaryImage],
      'boundary.png',
      { type: 'image/png' },
    ))
    expect(accepted.status).toBe(201)
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]?.buffer).toHaveLength(MAX_IMAGE_BYTES)

    const rejected = await upload(new File(
      [pngWithSize(MAX_IMAGE_BYTES + 1)],
      'one-byte-over.png',
      { type: 'image/png' },
    ))
    expect(rejected.status).toBe(413)
    await expect(rejected.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'IMAGE_TOO_LARGE',
        details: { maxBytes: 4_000_000 },
      },
    })
    expect(provider.calls).toHaveLength(1)
  })

  it('rejects multipart bodies above 4,100,000 bytes and invalid fields', async () => {
    const oversizedForm = new FormData()
    oversizedForm.set('resource', 'countries')
    oversizedForm.set('file', pngFile())
    oversizedForm.set('padding', 'x'.repeat(MAX_MULTIPART_BODY_BYTES))
    const oversizedRequest = await app.request('/api/v1/admin/uploads/images', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: `${ACCESS_COOKIE_NAME}=${adminToken}`,
      },
      body: oversizedForm,
    })
    expect(oversizedRequest.status).toBe(413)
    await expect(oversizedRequest.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'IMAGE_TOO_LARGE' },
    })
    expect(provider.calls).toHaveLength(0)

    const invalidResource = await upload(pngFile(), { resource: 'users' })
    expect(invalidResource.status).toBe(400)
    await expect(invalidResource.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { fields: { resource: expect.any(Array) } },
      },
    })
  })

  it('fails safely when Cloudinary is missing or rejects the upload', async () => {
    app = buildApp(new UnavailableImageProvider())
    const unavailable = await upload(pngFile())
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'MEDIA_UPLOAD_UNAVAILABLE',
        message: 'Image uploads are temporarily unavailable.',
        details: {},
      },
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    app = buildApp(new MockImageProvider('PROVIDER_AUTHENTICATION_FAILED'))
    const failed = await upload(pngFile())
    expect(failed.status).toBe(502)
    await expect(failed.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'MEDIA_UPLOAD_FAILED',
        message: 'Image upload failed. Please try again.',
        details: {},
      },
    })
    expect(consoleError).toHaveBeenCalledWith(
      'Cloudinary image upload failed.',
      expect.objectContaining({ error: 'PROVIDER_AUTHENTICATION_FAILED' }),
    )
    consoleError.mockRestore()
  })

  it('uploads verified images with stable identifiers for both Admin roles', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const response = await upload(pngFile(), { role, resource: 'articles' })
      expect(response.status).toBe(201)
      expect(response.headers.get('x-request-id')).toBeTruthy()
      await expect(response.json()).resolves.toEqual({
        success: true,
        data: {
          assetId: 'asset-123',
          publicId: 'tareeq-academy/articles/11111111-2222-4333-8444-555555555555',
          secureUrl: 'https://res.cloudinary.com/example/image/upload/v1/tareeq-academy/articles/11111111-2222-4333-8444-555555555555.png',
          format: 'png',
          bytes: PNG.length,
          width: 1,
          height: 1,
        },
      })
    }
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls.every(({ publicId, format }) =>
      publicId.startsWith('tareeq-academy/articles/') && format === 'png',
    )).toBe(true)
  })

  it('documents the multipart request and safe response contract', async () => {
    const response = await app.request('/openapi.json')
    const document = await response.json() as {
      components: {
        schemas: Record<string, {
          required?: string[]
          properties?: Record<string, { type?: string; format?: string }>
        }>
      }
      paths: Record<string, Record<string, {
        security?: Array<Record<string, unknown>>
        requestBody?: { content?: Record<string, unknown> }
        responses: Record<string, unknown>
      }>>
    }
    const operation = document.paths['/api/v1/admin/uploads/images']?.post
    expect(operation?.security).toEqual([{ accessCookie: [] }])
    expect(operation?.requestBody?.content).toHaveProperty('multipart/form-data')
    expect(document.components.schemas.ImageUploadRequest?.required).toEqual([
      'resource',
      'file',
    ])
    expect(document.components.schemas.ImageUploadRequest?.properties?.file).toMatchObject({
      type: 'string',
      format: 'binary',
    })
    expect(operation?.responses).toHaveProperty('201')
    expect(operation?.responses).toHaveProperty('502')
    expect(operation?.responses).toHaveProperty('503')
  })
})
