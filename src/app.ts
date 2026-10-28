import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

import { createAuthRoutes } from './auth/routes.js'
import {
  productionAuthRuntime,
  type AuthRuntime,
} from './auth/runtime.js'
import type { AuthEnv } from './auth/types.js'
import { createContentRoutes } from './content/routes.js'
import {
  productionContentRuntime,
  type ContentRuntime,
} from './content/runtime.js'
import { getCronSecret } from './config/env.js'
import { createEmailDispatchRoutes } from './email/routes.js'
import { getProductionEmailDispatcher } from './email/runtime.js'
import type { EmailDispatchTrigger } from './email/types.js'
import { healthRoutes } from './routes/health.js'
import { landingRoutes } from './routes/landing.js'
import { postmanDownloadRoutes } from './routes/postman.js'
import { errorResponse, handleError, handleNotFound } from './shared/http.js'
import { createSubmissionRoutes } from './submissions/routes.js'
import {
  productionSubmissionRuntime,
  type SubmissionRuntime,
} from './submissions/runtime.js'

type AppOptions = {
  authRuntime?: AuthRuntime
  contentRuntime?: ContentRuntime
  submissionRuntime?: SubmissionRuntime
  emailDispatcher?: EmailDispatchTrigger
  cronSecret?: string
}

const gettingStartedDescription = [
  '## Getting Started',
  '',
  '**Production base URL:** `https://api.tareeq-academy.com`  ',
  '**Versioned API prefix:** `/api/v1`',
  '',
  '### Frontend configuration',
  '',
  '```env',
  'NEXT_PUBLIC_API_BASE_URL=https://api.tareeq-academy.com',
  '```',
  '',
  '```ts',
  "import axios from 'axios'",
  '',
  'const baseURL = `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1`',
  'export const publicApi = axios.create({ baseURL })',
  'export const authApi = axios.create({ baseURL, withCredentials: true })',
  '```',
  '',
  '**Public request:**',
  '',
  '```ts',
  "const { data } = await publicApi.get('/countries')",
  '```',
  '',
  '### Administrator sessions',
  '',
  '```ts',
  "await authApi.post('/auth/login', { email, password })",
  "const { data: session } = await authApi.get('/auth/me')",
  '```',
  '',
  'Login sets host-only HttpOnly cookies; the frontend must use `withCredentials: true` for login, `/auth/me`, refresh, logout, and Admin requests. Do not read or store JWTs in frontend code. Use `/auth/refresh` when the access session expires.',
  '',
  '> **Local cookies:** a frontend on `localhost` calling the production HTTPS API is cross-site, so SameSite cookies will not persist. For authenticated local development, run both frontend and Backend on `localhost` using different ports. Production uses the shared-site `admin.tareeq-academy.com` and `api.tareeq-academy.com` domains.',
  '',
  '### Permissions',
  '',
  '| Capability | ADMIN | SUPER_ADMIN |',
  '| --- | --- | --- |',
  '| Read public content | Yes | Yes |',
  '| Manage existing content APIs | Yes | Yes |',
  '| Dedicated user-management APIs | Not implemented | Not implemented |',
  '',
  'ADMIN and SUPER_ADMIN currently share the documented content-management permissions; there are no SUPER_ADMIN-only endpoints.',
  '',
  '### Student forms',
  '',
  'The Public Website submits non-credentialed JSON to `POST /api/v1/applications` or `POST /api/v1/inquiries`. Send `privacyAccepted: true`, leave the `website` honeypot empty, and display field messages from `error.details.fields`. Scholarship assistance does not require a `scholarshipId`.',
  '',
  'A successful `201` confirms that the submission was stored. Arabic student confirmations and Admin notifications are dispatched separately through a durable outbox; email delivery is not guaranteed by the API response.',
  '',
  '### Downloads',
  '',
  '[**Download Postman Collection**](/postman/collection.json) · [**Download Postman Package (ZIP)**](/postman/download.zip)',
  '',
  'Both downloads are generated from this OpenAPI contract. The ZIP also includes the read-only smoke Collection and sanitized Local/Vercel environments.',
  '',
  '**Optional resource:** [Detailed Frontend Guide](https://github.com/ghaithtr133-byte/tareeq-api/blob/main/docs/frontend-integration.md)',
].join('\n')

export const createApp = (options: AppOptions = {}) => {
  const app = new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'Invalid request.',
          result.error.issues,
        )
      }
    },
  })

  app.use('*', async (c, next) => {
    const supplied = c.req.header('X-Request-Id')
    const requestId =
      supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
        ? supplied
        : crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('X-Request-Id', requestId)
    await next()
  })

  app.route('/', landingRoutes)
  app.route('/postman', postmanDownloadRoutes)
  app.route('/', healthRoutes)
  app.route(
    '/',
    createEmailDispatchRoutes(
      options.emailDispatcher ?? getProductionEmailDispatcher(),
      options.cronSecret ?? getCronSecret(),
    ),
  )
  const authRuntime = options.authRuntime ?? productionAuthRuntime
  app.route('/api/v1/auth', createAuthRoutes(authRuntime))
  app.route(
    '/api/v1',
    createSubmissionRoutes(
      options.submissionRuntime ?? productionSubmissionRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createContentRoutes(
      options.contentRuntime ?? productionContentRuntime,
      authRuntime,
    ),
  )

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Tareeq Academy API',
      version: '0.1.0',
      description: gettingStartedDescription,
    },
    servers: [
      { url: 'https://api.tareeq-academy.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Local Backend' },
    ],
    tags: [
      { name: 'System', description: 'Public process-health operation.' },
      { name: 'Authentication', description: 'Administrator login, session restoration, refresh, logout, and password change.' },
      { name: 'Public — Countries', description: 'Published country collections and slug details. No authentication required.' },
      { name: 'Public — Universities', description: 'Published university collections and slug details. No authentication required.' },
      { name: 'Public — Scholarships', description: 'Published scholarship collections and slug details, including effective application status. No authentication required.' },
      { name: 'Public — Services', description: 'Published service collections and slug details. No authentication required.' },
      { name: 'Public — Articles', description: 'Published article collections and slug details. No authentication required.' },
      { name: 'Public — Applications', description: 'Non-credentialed student application submission with consent, spam protection, and shared rate limiting.' },
      { name: 'Public — Inquiries', description: 'Non-credentialed general inquiry submission with consent, spam protection, and shared rate limiting.' },
      { name: 'Admin — Countries', description: 'Country content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Universities', description: 'University content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Scholarships', description: 'Scholarship content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Services', description: 'Service content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Articles', description: 'Article content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Applications', description: 'Student application review for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Inquiries', description: 'General inquiry review for ADMIN and SUPER_ADMIN.' },
    ],
    'x-tagGroups': [
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
          'Public — Applications',
          'Public — Inquiries',
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
          'Admin — Applications',
          'Admin — Inquiries',
        ],
      },
    ],
    externalDocs: {
      description: 'Detailed Frontend Guide (optional)',
      url: 'https://github.com/ghaithtr133-byte/tareeq-api/blob/main/docs/frontend-integration.md',
    },
  })

  app.get(
    '/docs',
    Scalar({
      url: '/openapi.json',
      pageTitle: 'Tareeq Academy API Reference',
      layout: 'modern',
      showSidebar: true,
      operationTitleSource: 'summary',
      defaultOpenFirstTag: false,
      defaultOpenAllTags: false,
    }),
  )

  app.notFound(handleNotFound)
  app.onError(handleError)

  return app
}

export const app = createApp()
