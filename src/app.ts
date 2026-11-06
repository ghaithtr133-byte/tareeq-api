import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

import { createAnalyticsRoutes } from './analytics/routes.js'
import { createAboutUsRoutes } from './about/routes.js'
import { productionAboutUsRuntime, type AboutUsRuntime } from './about/runtime.js'
import {
  productionAnalyticsRuntime,
  type AnalyticsRuntime,
} from './analytics/runtime.js'
import { createAdminManagementRoutes } from './admin-management/routes.js'
import {
  productionAdminManagementRuntime,
  type AdminManagementRuntime,
} from './admin-management/runtime.js'
import { createAuditRoutes } from './audit/routes.js'
import {
  productionAuditRuntime,
  type AuditRuntime,
} from './audit/runtime.js'
import { createAuthRoutes } from './auth/routes.js'
import {
  productionAuthRuntime,
  type AuthRuntime,
} from './auth/runtime.js'
import type { AuthEnv } from './auth/types.js'
import { createContentRoutes } from './content/routes.js'
import { createContentDetailsRoutes } from './content-details/routes.js'
import { ContentDetailsService } from './content-details/service.js'
import {
  productionContentRuntime,
  type ContentRuntime,
} from './content/runtime.js'
import { getCronSecret } from './config/env.js'
import { createEmailDispatchRoutes } from './email/routes.js'
import { getProductionEmailDispatcher } from './email/runtime.js'
import type { EmailDispatchTrigger } from './email/types.js'
import { createFaqRoutes } from './faqs/routes.js'
import { productionFaqRuntime, type FaqRuntime } from './faqs/runtime.js'
import { createMediaRoutes } from './media/routes.js'
import {
  productionMediaRuntime,
  type MediaRuntime,
} from './media/runtime.js'
import { createMarketingPageImageRoutes } from './marketing/routes.js'
import { productionMarketingPageImageRuntime, type MarketingPageImageRuntime } from './marketing/runtime.js'
import { healthRoutes } from './routes/health.js'
import { landingRoutes } from './routes/landing.js'
import { postmanDownloadRoutes } from './routes/postman.js'
import { errorResponse, handleError, handleNotFound } from './shared/http.js'
import { createSiteSettingsRoutes } from './site-settings/routes.js'
import {
  productionSiteSettingsRuntime,
  type SiteSettingsRuntime,
} from './site-settings/runtime.js'
import { createSubmissionRoutes } from './submissions/routes.js'
import {
  productionSubmissionRuntime,
  type SubmissionRuntime,
} from './submissions/runtime.js'
import { createStatisticsRoutes } from './statistics/routes.js'
import { productionStatisticsRuntime, type StatisticsRuntime } from './statistics/runtime.js'
import { createStudentJourneyRoutes } from './student-journey/routes.js'
import { productionStudentJourneyRuntime, type StudentJourneyRuntime } from './student-journey/runtime.js'
import { createUniversityDirectoryRoutes } from './university-directory/routes.js'
import {
  productionUniversityDirectoryRuntime,
  type UniversityDirectoryRuntime,
} from './university-directory/runtime.js'
import { createUniversityDetailsRoutes } from './university-details/routes.js'
import {
  productionUniversityDetailsRuntime,
  type UniversityDetailsRuntime,
} from './university-details/runtime.js'

type AppOptions = {
  analyticsRuntime?: AnalyticsRuntime
  aboutUsRuntime?: AboutUsRuntime
  adminManagementRuntime?: AdminManagementRuntime
  auditRuntime?: AuditRuntime
  authRuntime?: AuthRuntime
  contentRuntime?: ContentRuntime
  submissionRuntime?: SubmissionRuntime
  mediaRuntime?: MediaRuntime
  marketingPageImageRuntime?: MarketingPageImageRuntime
  siteSettingsRuntime?: SiteSettingsRuntime
  statisticsRuntime?: StatisticsRuntime
  studentJourneyRuntime?: StudentJourneyRuntime
  emailDispatcher?: EmailDispatchTrigger
  faqRuntime?: FaqRuntime
  universityDirectoryRuntime?: UniversityDirectoryRuntime
  universityDetailsRuntime?: UniversityDetailsRuntime
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
  '| Manage University programs and directory catalogs | Yes | Yes |',
  '| Manage University admission requirements and gallery | Yes | Yes |',
  '| Read Admin audit logs | No | Yes |',
  '| Manage existing Admin accounts | No | Yes |',
  '| Update public site settings | No | Yes |',
  '| Read anonymous analytics reports | No | Yes |',
  '',
  'ADMIN and SUPER_ADMIN share content-management permissions. Audit-log review, existing Admin-account management, site-settings updates, and anonymous analytics reporting are restricted to SUPER_ADMIN.',
  '',
  '### Student forms',
  '',
  'The Public Website submits non-credentialed JSON to `POST /api/v1/applications` or `POST /api/v1/inquiries`. Send `privacyAccepted: true`, leave the `website` honeypot empty, and display field messages from `error.details.fields`. Scholarship assistance does not require a `scholarshipId`.',
  '',
  'A successful `201` confirms that the submission was stored. Arabic student confirmations and Admin notifications are dispatched separately through a durable outbox; email delivery is not guaranteed by the API response.',
  '',
  '### Content images',
  '',
  'Authenticated ADMIN and SUPER_ADMIN users upload a JPEG, PNG, or WebP file through `POST /api/v1/admin/uploads/images`, then copy the returned `secureUrl` into the existing content image field. Files are verified by content and limited to 4,000,000 bytes; the complete multipart body is limited to 4,100,000 bytes for Vercel Functions compatibility. Images use a server-generated Cloudinary public ID, and Cloudinary credentials stay on the Backend.',
  '',
  '### Administrator audit trail',
  '',
  'Successful content mutations and student-submission workflow changes create append-only audit events in the same database transaction. Only SUPER_ADMIN can list events through `GET /api/v1/admin/audit-logs`; filters never expose request bodies, student messages, private notes, credentials, or session data.',
  '',
  '### Public organization settings',
  '',
  'The Public Website reads allowlisted organization, contact, address, and social-link fields through `GET /api/v1/site-settings`. SUPER_ADMIN can update those fields through `PATCH /api/v1/admin/site-settings`. Arbitrary configuration keys and infrastructure secrets are not accepted.',
  '',
  '### Privacy-conscious analytics',
  '',
  'After applying the frontend consent policy, the Public Website may send one allowlisted anonymous event to `POST /api/v1/analytics/events`. Generate random visitor, session, and event UUIDs; never send identity, form values, messages, full URLs, raw IPs, or arbitrary metadata. Only SUPER_ADMIN can read aggregate reports and anonymous session journeys.',
  '',
  '### Frequently asked questions',
  '',
  'Published FAQs are available for the Homepage and for published Countries, Universities, Services, and Scholarships. Public collections default to five entries and support pagination. ADMIN and SUPER_ADMIN manage parent-scoped FAQ entries through the generic Admin API; `status=ARCHIVED` replaces deletion, and reorder requests atomically include every non-archived FAQ for one parent.',
  '',
  '### University programs and advanced filters',
  '',
  'The University directory supports normalized Major, Study Level, Teaching Language, City, and Public/Private filters. Combined program filters always match one published program. Use `/universities/filter-options` for self-excluding distinct-University facet counts and `/universities/{slug}/programs` for verified published offerings. Universities without program data remain in unfiltered listings.',
  '',
  '### University details tabs',
  '',
  'Programs expose exact localized names, optional faculty/duration, and explicit academic-year tuition schedules without estimation. Public admission requirements remain separated by University, study-level, and program scope. Gallery images are explicit ordered associations created after the existing Cloudinary upload; detaching an association never deletes the Cloudinary asset or University cover.',
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
  app.route('/api/v1', createAboutUsRoutes(
    options.aboutUsRuntime ?? productionAboutUsRuntime,
    authRuntime,
  ))
  app.route(
    '/api/v1',
    createAnalyticsRoutes(
      options.analyticsRuntime ?? productionAnalyticsRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createFaqRoutes(options.faqRuntime ?? productionFaqRuntime, authRuntime),
  )
  app.route(
    '/api/v1',
    createUniversityDirectoryRoutes(
      options.universityDirectoryRuntime ?? productionUniversityDirectoryRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createUniversityDetailsRoutes(
      options.universityDetailsRuntime ?? productionUniversityDetailsRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createAdminManagementRoutes(
      options.adminManagementRuntime ?? productionAdminManagementRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createAuditRoutes(
      options.auditRuntime ?? productionAuditRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createMediaRoutes(
      options.mediaRuntime ?? productionMediaRuntime,
      authRuntime,
    ),
  )
  app.route('/api/v1', createMarketingPageImageRoutes(
    options.marketingPageImageRuntime ?? productionMarketingPageImageRuntime,
    authRuntime,
  ))
  app.route(
    '/api/v1',
    createSiteSettingsRoutes(
      options.siteSettingsRuntime ?? productionSiteSettingsRuntime,
      authRuntime,
    ),
  )
  app.route(
    '/api/v1',
    createSubmissionRoutes(
      options.submissionRuntime ?? productionSubmissionRuntime,
      authRuntime,
    ),
  )
  app.route('/api/v1', createStatisticsRoutes(options.statisticsRuntime ?? productionStatisticsRuntime, authRuntime))
  app.route('/api/v1', createStudentJourneyRoutes(options.studentJourneyRuntime ?? productionStudentJourneyRuntime, authRuntime))
  app.route(
    '/api/v1',
    createContentRoutes(
      options.contentRuntime ?? productionContentRuntime,
      authRuntime,
    ),
  )
  app.route('/api/v1', createContentDetailsRoutes(new ContentDetailsService(), authRuntime))

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
      { name: 'Public — Site Settings', description: 'Allowlisted public organization and contact settings.' },
      { name: 'Public — About Us', description: 'Published singleton About Us page content.' },
      { name: 'Public — Marketing', description: 'Optional Hero and CTA image configuration for fixed marketing pages.' },
      { name: 'Public — Statistics', description: 'Reusable published catalog and owner-verified trust statistics.' },
      { name: 'Public — Student Journey', description: 'Active complete Homepage student journey steps.' },
      { name: 'Public — Analytics', description: 'Privacy-conscious anonymous first-party event ingestion.' },
      { name: 'Public — FAQs', description: 'Published Homepage and parent-scoped FAQ collections.' },
      { name: 'Public — University Directory', description: 'Published normalized University programs and dynamic P1/P2 filter options.' },
      { name: 'Public — University Details', description: 'Published scoped admission requirements and ordered University galleries.' },
      { name: 'Admin — Countries', description: 'Country content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Universities', description: 'University content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Scholarships', description: 'Scholarship content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Services', description: 'Service content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Articles', description: 'Article content management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Applications', description: 'Student application review for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Inquiries', description: 'General inquiry review for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Media', description: 'Secure Cloudinary image uploads for ADMIN and SUPER_ADMIN content workflows.' },
      { name: 'Admin — Audit Logs', description: 'Append-only administrative mutation history for SUPER_ADMIN review.' },
      { name: 'Admin — Account Management', description: 'Existing administrator role and activation management for SUPER_ADMIN.' },
      { name: 'Admin — Site Settings', description: 'Allowlisted public site-settings updates for SUPER_ADMIN.' },
      { name: 'Admin — About Us', description: 'Singleton About Us page editing for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Marketing', description: 'Optional Hero and CTA image configuration for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Student Journey', description: 'Fixed Homepage student journey slot configuration for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Analytics', description: 'Anonymous aggregate traffic, conversion, trend, and journey reporting for SUPER_ADMIN.' },
      { name: 'Admin — FAQs', description: 'Parent-scoped FAQ creation, editing, publication, archive, and atomic ordering for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — University Programs', description: 'Verified normalized University program management for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — Directory Catalogs', description: 'Controlled Academic Major and City lookups for ADMIN and SUPER_ADMIN.' },
      { name: 'Admin — University Details', description: 'Scoped admission requirement and gallery management for ADMIN and SUPER_ADMIN.' },
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
          'Public — Site Settings',
          'Public — About Us',
          'Public — Marketing',
          'Public — Statistics',
          'Public — Student Journey',
          'Public — Analytics',
          'Public — FAQs',
          'Public — University Directory',
          'Public — University Details',
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
          'Admin — Media',
          'Admin — Audit Logs',
          'Admin — Account Management',
          'Admin — Site Settings',
          'Admin — About Us',
          'Admin — Marketing',
          'Admin — Student Journey',
          'Admin — Analytics',
          'Admin — FAQs',
          'Admin — University Programs',
          'Admin — Directory Catalogs',
          'Admin — University Details',
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
