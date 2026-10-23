import { inflateRawSync } from 'node:zlib'

import { Hono } from 'hono'

import type { AuthEnv } from '../auth/types.js'
import {
  postmanCollectionDeflateBase64,
  postmanDownloadZipBase64,
} from '../generated/postman-downloads.js'

const collection = inflateRawSync(
  Buffer.from(postmanCollectionDeflateBase64, 'base64'),
)
const downloadZip = Buffer.from(postmanDownloadZipBase64, 'base64')

const responseBody = (value: Buffer) => Uint8Array.from(value).buffer

const downloadHeaders = (
  contentType: string,
  fileName: string,
  contentLength: number,
) => ({
  'Cache-Control': 'public, max-age=300, must-revalidate',
  'Content-Disposition': `attachment; filename="${fileName}"`,
  'Content-Length': String(contentLength),
  'Content-Type': contentType,
  'X-Content-Type-Options': 'nosniff',
})

export const postmanDownloadRoutes = new Hono<AuthEnv>()

postmanDownloadRoutes.get('/collection.json', (c) =>
  c.body(
    responseBody(collection),
    200,
    downloadHeaders(
      'application/json; charset=utf-8',
      'tareeq-api.postman_collection.json',
      collection.length,
    ),
  ))

postmanDownloadRoutes.get('/download.zip', (c) =>
  c.body(
    responseBody(downloadZip),
    200,
    downloadHeaders(
      'application/zip',
      'tareeq-api-postman.zip',
      downloadZip.length,
    ),
  ))
