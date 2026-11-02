import { v2 as cloudinary } from 'cloudinary'

import type { CloudinaryConfig } from '../config/env.js'
import {
  ImageProviderError,
  type ImageProvider,
  type ImageUploadInput,
  type SupportedImageFormat,
  type UploadedImage,
} from './types.js'

const CLOUDINARY_TIMEOUT_MS = 10_000
const supportedFormats = new Set<SupportedImageFormat>(['jpg', 'png', 'webp'])

const safeProviderCode = (status: number | undefined) => {
  if (status === 401 || status === 403) return 'PROVIDER_AUTHENTICATION_FAILED'
  if (status === 408 || status === 504) return 'PROVIDER_TIMEOUT'
  if (status === 429) return 'PROVIDER_RATE_LIMITED'
  if (status !== undefined && status >= 400 && status < 500) {
    return 'PROVIDER_REJECTED_UPLOAD'
  }
  return 'PROVIDER_FAILURE'
}

export class UnavailableImageProvider implements ImageProvider {
  readonly available = false

  async upload(): Promise<never> {
    throw new ImageProviderError('PROVIDER_NOT_CONFIGURED')
  }
}

export class CloudinaryImageProvider implements ImageProvider {
  readonly available = true

  constructor(config: CloudinaryConfig) {
    if (
      config.status !== 'CONFIGURED' ||
      !config.cloudName ||
      !config.apiKey ||
      !config.apiSecret
    ) {
      throw new Error('CloudinaryImageProvider requires valid server-only configuration.')
    }
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    })
  }

  upload(input: ImageUploadInput): Promise<UploadedImage> {
    return new Promise((resolve, reject) => {
      let settled = false
      const state: { timeout?: NodeJS.Timeout } = {}
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        if (state.timeout) clearTimeout(state.timeout)
        callback()
      }

      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          public_id: input.publicId,
          allowed_formats: ['jpg', 'png', 'webp'],
          overwrite: false,
          use_filename: false,
          unique_filename: false,
          discard_original_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            finish(() => reject(new ImageProviderError(
              safeProviderCode(error?.http_code),
            )))
            return
          }

          const assetId = result.asset_id
          const secureUrl = result.secure_url
          const format = result.format === 'jpeg' ? 'jpg' : result.format
          const responseIsValid =
            typeof assetId === 'string' &&
            assetId.length > 0 &&
            result.public_id === input.publicId &&
            typeof secureUrl === 'string' &&
            secureUrl.startsWith('https://') &&
            supportedFormats.has(format as SupportedImageFormat) &&
            format === input.format &&
            Number.isInteger(result.bytes) &&
            result.bytes > 0 &&
            Number.isInteger(result.width) &&
            result.width > 0 &&
            Number.isInteger(result.height) &&
            result.height > 0

          if (!responseIsValid) {
            finish(() => reject(new ImageProviderError('INVALID_PROVIDER_RESPONSE')))
            return
          }
          finish(() => resolve({
            assetId,
            publicId: result.public_id,
            secureUrl,
            format: format as SupportedImageFormat,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
          }))
        },
      )

      stream.on('error', () => {
        finish(() => reject(new ImageProviderError('PROVIDER_CONNECTION_FAILED')))
      })
      state.timeout = setTimeout(() => {
        stream.destroy()
        finish(() => reject(new ImageProviderError('PROVIDER_TIMEOUT')))
      }, CLOUDINARY_TIMEOUT_MS)
      stream.end(input.buffer)
    })
  }
}

export const createImageProvider = (config: CloudinaryConfig): ImageProvider =>
  config.status === 'CONFIGURED'
    ? new CloudinaryImageProvider(config)
    : new UnavailableImageProvider()
