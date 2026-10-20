import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { app, createApp } from '../src/app.js'
import { handleError } from '../src/shared/http.js'

describe('Tareeq Academy API foundation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
    expect(document.paths['/api/v1/health']?.get.responses['200']).toBeDefined()
    expect(document.components.schemas.HealthResponse).toBeDefined()
  })

  it('documents the complete 36-operation API with descriptions, examples, and Admin security', async () => {
    const response = await app.request('/openapi.json')
    const document = (await response.json()) as {
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
  })
})
