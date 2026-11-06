export const mediaResources = [
  'countries',
  'universities',
  'scholarships',
  'services',
  'articles',
  'about',
  'marketing',
] as const

export type MediaResource = (typeof mediaResources)[number]
export type SupportedImageFormat = 'jpg' | 'png' | 'webp'

export type InspectedImage = {
  format: SupportedImageFormat
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
}

export type ImageUploadInput = {
  buffer: Buffer
  publicId: string
  format: SupportedImageFormat
}

export type UploadedImage = {
  assetId: string
  publicId: string
  secureUrl: string
  format: SupportedImageFormat
  bytes: number
  width: number
  height: number
}

export interface ImageProvider {
  readonly available: boolean
  upload(input: ImageUploadInput): Promise<UploadedImage>
}

export class ImageProviderError extends Error {
  constructor(public readonly code: string) {
    super('Image provider request failed.')
    this.name = 'ImageProviderError'
  }
}
