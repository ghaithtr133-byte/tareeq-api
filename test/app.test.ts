import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { app, createApp } from '../src/app.js'
import { handleError } from '../src/shared/http.js'

describe('Tareeq Academy API foundation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves a responsive HTML landing page at the API root', async () => {
    const response = await app.request('/')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('name="viewport"')
    expect(html).toContain('Tareeq Academy API')
    expect(html).toContain('href="/docs"')
    expect(html).toContain('>API Documentation</a>')
    expect(html).toContain('href="/postman/collection.json"')
    expect(html).toContain('>Download Postman Collection</a>')
    expect(html).toContain('href="/postman/download.zip"')
    expect(html).toContain('>Download Postman Package (ZIP)</a>')
    expect(html).toContain('href="/openapi.json"')
    expect(html).toContain('href="/api/v1/health"')
    expect(html).not.toContain('<script')
  })

  it('serves synchronized Postman downloads with attachment headers', async () => {
    const collectionResponse = await app.request('/postman/collection.json')
    const collection = await collectionResponse.json() as {
      info: { schema: string }
      item: Array<{ request?: unknown; item?: unknown[] }>
    }
    const collectRequests = (items: Array<{ request?: unknown; item?: unknown[] }>): unknown[] =>
      items.flatMap((item) => [
        ...(item.request === undefined ? [] : [item.request]),
        ...(Array.isArray(item.item)
          ? collectRequests(item.item as Array<{ request?: unknown; item?: unknown[] }>)
          : []),
      ])

    expect(collectionResponse.status).toBe(200)
    expect(collectionResponse.headers.get('content-type')).toContain('application/json')
    expect(collectionResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="tareeq-api.postman_collection.json"',
    )
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    )
    expect(collectRequests(collection.item)).toHaveLength(36)

    const zipResponse = await app.request('/postman/download.zip')
    const zip = Buffer.from(await zipResponse.arrayBuffer())
    expect(zipResponse.status).toBe(200)
    expect(zipResponse.headers.get('content-type')).toContain('application/zip')
    expect(zipResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="tareeq-api-postman.zip"',
    )
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304')
    const archiveIndex = zip.toString('latin1')
    expect(archiveIndex).toContain('postman/tareeq-api.postman_collection.json')
    expect(archiveIndex).toContain(
      'postman/tareeq-api.read-only-smoke.postman_collection.json',
    )
    expect(archiveIndex).toContain('postman/tareeq-api.local.postman_environment.json')
    expect(archiveIndex).toContain('postman/tareeq-api.vercel.postman_environment.json')
  })

  it('returns a standardized health response', async () => {
    const response = await app.request('/api/v1/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: 'ok' },
    })
  })

  it('returns a standardized error for unknown routes', async () => {
    const response = await app.request('/api/v1/unknown')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        details: { method: 'GET', path: '/api/v1/unknown' },
      },
    })
  })

  it('handles unexpected errors without exposing internals', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const testApp = new OpenAPIHono()
    testApp.get('/failure', () => {
      throw new Error('sensitive implementation detail')
    })
    testApp.onError(handleError)

    const response = await testApp.request('/failure')
    const body = (await response.json()) as {
      error: { details: unknown }
    }

    expect(response.status).toBe(500)
    expect(body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
    })
    expect(JSON.stringify(body)).not.toContain('sensitive implementation detail')
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('sensitive implementation detail')
  })

  it('formats Zod validation failures consistently', async () => {
    const validationRoute = createRoute({
      method: 'get',
      path: '/validation-check',
      request: {
        query: z.object({ value: z.string().min(1) }),
      },
      responses: {
        200: { description: 'Test-only validation route.' },
      },
    })
    const testApp = createApp()
    testApp.openapi(validationRoute, (c) => c.json({ success: true as const }, 200))

    const response = await testApp.request('/validation-check')
    const body = (await response.json()) as {
      error: { details: unknown }
    }

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request.',
      },
    })
    expect(body.error.details).toBeInstanceOf(Array)
  })

  it('serves an OpenAPI 3.1 document describing the health endpoint', async () => {
    const response = await app.request('/openapi.json')
    const document = (await response.json()) as {
      openapi: string
      paths: Record<string, { get: { responses: Record<string, unknown> } }>
      components: { schemas: Record<string, unknown> }
    }

    expect(response.status).toBe(200)
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths['/']).toBeUndefined()
    expect(document.paths['/postman/collection.json']).toBeUndefined()
    expect(document.paths['/postman/download.zip']).toBeUndefined()
    expect(document.paths['/api/v1/health']?.get.responses['200']).toBeDefined()
    expect(document.components.schemas.HealthResponse).toBeDefined()
  })

  it('documents the complete 36-operation API with descriptions, examples, and Admin security', async () => {
    const response = await app.request('/openapi.json')
    const document = (await response.json()) as {
      info?: { description?: string }
      tags?: Array<{ name: string }>
      'x-tagGroups'?: Array<{ name: string; tags: string[] }>
      externalDocs?: { url?: string }
      paths: Record<string, Record<string, {
        summary?: string
        description?: string
        tags?: string[]
        security?: Array<Record<string, unknown>>
        requestBody?: {
          content?: Record<string, { example?: unknown }>
        }
        responses: Record<string, {
          content?: Record<string, { example?: unknown }>
        }>
      }>>
    }
    const methods = new Set(['get', 'post', 'patch', 'put', 'delete'])
    const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
      Object.entries(pathItem)
        .filter(([method]) => methods.has(method))
        .map(([method, operation]) => ({ path, method, operation })),
    )

    expect(operations).toHaveLength(36)
    const contentResources = '(countries|universities|scholarships|services|articles)'
    const operationGroups = {
      system: operations.filter(({ path }) => path === '/api/v1/health'),
      authentication: operations.filter(({ path }) => path.startsWith('/api/v1/auth/')),
      publicContent: operations.filter(({ path }) =>
        new RegExp(`^/api/v1/${contentResources}(/\\{slug\\})?$`).test(path),
      ),
      adminContent: operations.filter(({ path }) =>
        new RegExp(`^/api/v1/admin/${contentResources}(/\\{id\\})?$`).test(path),
      ),
    }
    expect(Object.fromEntries(
      Object.entries(operationGroups).map(([group, entries]) => [group, entries.length]),
    )).toEqual({ system: 1, authentication: 5, publicContent: 10, adminContent: 20 })
    expect(operations.some(({ path }) =>
      /(applications|inquiries|uploads|analytics|admin-users|admin\/users)/i.test(path),
    )).toBe(false)
    expect(document.tags?.map(({ name }) => name)).toEqual([
      'System',
      'Authentication',
      'Public — Countries',
      'Public — Universities',
      'Public — Scholarships',
      'Public — Services',
      'Public — Articles',
      'Admin — Countries',
      'Admin — Universities',
      'Admin — Scholarships',
      'Admin — Services',
      'Admin — Articles',
    ])
    expect(document['x-tagGroups']).toEqual([
      { name: 'System', tags: ['System'] },
      { name: 'Authentication', tags: ['Authentication'] },
      {
        name: 'Public APIs',
        tags: [
          'Public — Countries',
          'Public — Universities',
          'Public — Scholarships',
          'Public — Services',
          'Public — Articles',
        ],
      },
      {
        name: 'Admin APIs',
        tags: [
          'Admin — Countries',
          'Admin — Universities',
          'Admin — Scholarships',
          'Admin — Services',
          'Admin — Articles',
        ],
      },
    ])
    expect(document.info?.description).toContain('## Getting Started')
    expect(document.info?.description).toContain('NEXT_PUBLIC_API_BASE_URL')
    expect(document.info?.description).toContain('withCredentials: true')
    expect(document.info?.description).toContain("publicApi.get('/countries')")
    expect(document.info?.description).toContain("authApi.get('/auth/me')")
    expect(document.info?.description).toContain('localhost')
    expect(document.info?.description).toContain('| ADMIN | SUPER_ADMIN |')
    expect(document.info?.description).toContain('/postman/collection.json')
    expect(document.info?.description).toContain('/postman/download.zip')
    expect(document.externalDocs?.url).toContain('docs/frontend-integration.md')
    const adminTagByResource: Record<string, string> = {
      countries: 'Admin — Countries',
      universities: 'Admin — Universities',
      scholarships: 'Admin — Scholarships',
      services: 'Admin — Services',
      articles: 'Admin — Articles',
    }
    for (const { path, method, operation } of operations) {
      expect(operation.summary, `${method.toUpperCase()} ${path} summary`).toBeTruthy()
      expect(operation.description, `${method.toUpperCase()} ${path} description`).toBeTruthy()
      expect(operation.tags?.length, `${method.toUpperCase()} ${path} tags`).toBeGreaterThan(0)
      expect(
        Object.values(operation.responses).some((item) =>
          Object.values(item.content ?? {}).some((content) => content.example !== undefined),
        ),
        `${method.toUpperCase()} ${path} response example`,
      ).toBe(true)

      if (operation.requestBody) {
        expect(
          Object.values(operation.requestBody.content ?? {}).some(
            (content) => content.example !== undefined,
          ),
          `${method.toUpperCase()} ${path} request example`,
        ).toBe(true)
      }

      if (path.startsWith('/api/v1/admin/')) {
        expect(operation.security).toEqual([{ accessCookie: [] }])
        expect(operation.description).toContain('ADMIN or SUPER_ADMIN')
        expect(operation.tags).toEqual([adminTagByResource[path.split('/')[4] ?? '']])
      }
    }
  })

  it('serves Scalar documentation configured to load the OpenAPI document', async () => {
    const response = await app.request('/docs')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('Tareeq Academy API Reference')
    expect(html).toContain('/openapi.json')
    expect(html).toMatch(/"layout":\s*"modern"/)
    expect(html).toMatch(/"operationTitleSource":\s*"summary"/)
    expect(html).toMatch(/"defaultOpenAllTags":\s*false/)
  })
})
