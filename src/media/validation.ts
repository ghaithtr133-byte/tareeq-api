import { ApiError } from '../shared/http.js'
import type { InspectedImage } from './types.js'

export const MAX_IMAGE_BYTES = 4_000_000
export const MULTIPART_OVERHEAD_BYTES = 100_000
export const MAX_MULTIPART_BODY_BYTES =
  MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES
export const MAX_IMAGE_DIMENSION = 10_000
export const MAX_IMAGE_PIXELS = 40_000_000

const invalidImage = () =>
  new ApiError(
    400,
    'INVALID_IMAGE_FILE',
    'The uploaded file is not a valid supported image.',
    { fields: { file: ['Provide a complete JPEG, PNG, or WebP image.'] } },
  )

const unsafeDimensions = () =>
  new ApiError(
    400,
    'INVALID_IMAGE_DIMENSIONS',
    'The uploaded image dimensions are not supported.',
    {
      fields: {
        file: [
          `Images must be at most ${MAX_IMAGE_DIMENSION} pixels per side and ${MAX_IMAGE_PIXELS} total pixels.`,
        ],
      },
    },
  )

const verifyDimensions = (width: number, height: number) => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw unsafeDimensions()
  }
  return { width, height }
}

const inspectPng = (buffer: Buffer): InspectedImage | null => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < signature.length || !buffer.subarray(0, 8).equals(signature)) {
    return null
  }

  let offset = 8
  let width = 0
  let height = 0
  let sawHeader = false
  let sawImageData = false
  let sawEnd = false
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw invalidImage()
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const chunkEnd = offset + 12 + length
    if (!/^[A-Za-z]{4}$/.test(type) || chunkEnd > buffer.length) {
      throw invalidImage()
    }

    const dataOffset = offset + 8
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw invalidImage()
      width = buffer.readUInt32BE(dataOffset)
      height = buffer.readUInt32BE(dataOffset + 4)
      const bitDepth = buffer[dataOffset + 8]
      const colorType = buffer[dataOffset + 9]
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }
      if (
        bitDepth === undefined ||
        colorType === undefined ||
        !validDepths[colorType]?.includes(bitDepth) ||
        buffer[dataOffset + 10] !== 0 ||
        buffer[dataOffset + 11] !== 0 ||
        ![0, 1].includes(buffer[dataOffset + 12] ?? -1)
      ) {
        throw invalidImage()
      }
      sawHeader = true
    } else if (type === 'IHDR') {
      throw invalidImage()
    }

    if (type === 'IDAT') sawImageData = true
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Animated images are not supported.')
    }
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) throw invalidImage()
      sawEnd = true
    }

    offset = chunkEnd
    if (sawEnd) break
  }

  if (!sawHeader || !sawImageData || !sawEnd || offset !== buffer.length) {
    throw invalidImage()
  }
  verifyDimensions(width, height)
  return { format: 'png', mimeType: 'image/png', width, height }
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const inspectJpeg = (buffer: Buffer): InspectedImage | null => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  if (buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) throw invalidImage()

  let offset = 2
  let width = 0
  let height = 0
  let sawFrame = false
  let sawScan = false
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) throw invalidImage()
    while (buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === undefined || marker === 0x00 || marker === 0xd9) {
      throw invalidImage()
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length - 2) throw invalidImage()
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length - 2) {
      throw invalidImage()
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) throw invalidImage()
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
      sawFrame = true
    }
    if (marker === 0xda) {
      sawScan = true
      break
    }
    offset += segmentLength
  }

  if (!sawFrame || !sawScan) throw invalidImage()
  verifyDimensions(width, height)
  return { format: 'jpg', mimeType: 'image/jpeg', width, height }
}

const inspectWebp = (buffer: Buffer): InspectedImage | null => {
  if (
    buffer.length < 20 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw invalidImage()

  let offset = 12
  let width = 0
  let height = 0
  let sawImage = false
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw invalidImage()
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    const chunkEnd = dataOffset + length
    const paddedEnd = chunkEnd + (length % 2)
    if (chunkEnd > buffer.length || paddedEnd > buffer.length) throw invalidImage()
    if (type === 'ANIM' || type === 'ANMF') {
      throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Animated images are not supported.')
    }
    if (type === 'VP8X') {
      if (length < 10 || (buffer[dataOffset] ?? 0) & 0x02) {
        throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Animated images are not supported.')
      }
      width = 1 + buffer.readUIntLE(dataOffset + 4, 3)
      height = 1 + buffer.readUIntLE(dataOffset + 7, 3)
      sawImage = true
    } else if (type === 'VP8 ') {
      if (
        length < 10 ||
        buffer[dataOffset + 3] !== 0x9d ||
        buffer[dataOffset + 4] !== 0x01 ||
        buffer[dataOffset + 5] !== 0x2a
      ) {
        throw invalidImage()
      }
      width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff
      height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      sawImage = true
    } else if (type === 'VP8L') {
      if (length < 5 || buffer[dataOffset] !== 0x2f) throw invalidImage()
      const b1 = buffer[dataOffset + 1] ?? 0
      const b2 = buffer[dataOffset + 2] ?? 0
      const b3 = buffer[dataOffset + 3] ?? 0
      const b4 = buffer[dataOffset + 4] ?? 0
      width = 1 + b1 + ((b2 & 0x3f) << 8)
      height = 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      sawImage = true
    }
    offset = paddedEnd
  }

  if (!sawImage || offset !== buffer.length) throw invalidImage()
  verifyDimensions(width, height)
  return { format: 'webp', mimeType: 'image/webp', width, height }
}

export const inspectImage = (buffer: Buffer, declaredMimeType: string) => {
  if (buffer.length === 0) throw invalidImage()
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError(
      413,
      'IMAGE_TOO_LARGE',
      'The uploaded image is too large.',
      { maxBytes: MAX_IMAGE_BYTES },
    )
  }

  const inspected = inspectPng(buffer) ?? inspectJpeg(buffer) ?? inspectWebp(buffer)
  if (!inspected) {
    throw new ApiError(
      415,
      'UNSUPPORTED_IMAGE_TYPE',
      'Only JPEG, PNG, and WebP images are supported.',
      { fields: { file: ['Choose a JPEG, PNG, or WebP image.'] } },
    )
  }
  if (declaredMimeType.toLowerCase() !== inspected.mimeType) {
    throw new ApiError(
      415,
      'IMAGE_TYPE_MISMATCH',
      'The declared image type does not match the file contents.',
      { fields: { file: ['The file type and image contents must match.'] } },
    )
  }
  return inspected
}
