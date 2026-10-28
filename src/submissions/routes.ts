import { OpenAPIHono, type z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'

import { requireAuthentication, requireRole } from '../auth/middleware.js'
import type { AuthRuntime } from '../auth/runtime.js'
import {
  authCors,
  publicSubmissionCors,
  requireTrustedOrigin,
} from '../auth/security.js'
import type { AuthEnv } from '../auth/types.js'
import { ApiError, errorResponse, successResponse } from '../shared/http.js'
import type { SubmissionRuntime } from './runtime.js'
import {
  applicationListQuerySchema,
  applicationListResponseSchema,
  generalInquiryCreateSchema,
  inquiryListQuerySchema,
  inquiryListResponseSchema,
  inquiryResponseSchema,
  studentApplicationCreateSchema,
  studentApplicationResponseSchema,
  submissionConfirmationResponseSchema,
  submissionErrorResponses,
  submissionUpdateSchema,
  submissionUuidParamSchema,
} from './schemas.js'
import type {
  GeneralInquiryInput,
  StudentApplicationInput,
  SubmissionListQuery,
  SubmissionUpdate,
} from './types.js'

const MAX_PUBLIC_BODY_BYTES = 16 * 1_024
const confirmation = { success: true, data: { message: 'Submission received.' } }
const exampleId = 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d'
const exampleCountryId = '9879d0a4-9b7e-48d1-850a-da51be9de671'
const exampleUniversityId = '88008b68-b698-4725-93e9-801537e7797c'
const exampleScholarshipId = '9f414dec-fcbc-49dd-994f-086d2ef40e1f'
const exampleDates = {
  privacyAcceptedAt: '2026-10-25T10:00:00.000Z',
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
}

const applicationCreateExample = {
  applicationType: 'SCHOLARSHIP_ASSISTANCE',
  scholarshipId: exampleScholarshipId,
  countryId: exampleCountryId,
  universityId: exampleUniversityId,
  studyLevel: 'MASTERS',
  intendedMajor: 'Computer Science',
  fullName: 'أحمد محمد',
  email: 'student@example.invalid',
  phone: '+963 900 000 000',
  message: 'أرغب بالحصول على المساعدة في خطوات التقديم والمتطلبات المطلوبة.',
  privacyAccepted: true,
  website: '',
}
const applicationResponseExample = {
  id: exampleId,
  applicationType: 'SCHOLARSHIP_ASSISTANCE',
  scholarshipId: exampleScholarshipId,
  countryId: exampleCountryId,
  universityId: exampleUniversityId,
  studyLevel: 'MASTERS',
  intendedMajor: 'Computer Science',
  fullName: 'أحمد محمد',
  email: 'student@example.invalid',
  phone: '+963 900 000 000',
  message: 'أرغب بالحصول على المساعدة في خطوات التقديم والمتطلبات المطلوبة.',
  status: 'NEW',
  internalNote: null,
  ...exampleDates,
}
const inquiryCreateExample = {
  fullName: 'أحمد محمد',
  email: 'student@example.invalid',
  phone: null,
  subject: 'استفسار عن خدمات القبول الجامعي',
  message: 'أرغب بمعرفة تفاصيل الخدمات المتاحة للطلاب الدوليين.',
  privacyAccepted: true,
  website: '',
}
const inquiryResponseExample = {
  id: exampleId,
  fullName: 'أحمد محمد',
  email: 'student@example.invalid',
  phone: null,
  subject: 'استفسار عن خدمات القبول الجامعي',
  message: 'أرغب بمعرفة تفاصيل الخدمات المتاحة للطلاب الدوليين.',
  status: 'NEW',
  internalNote: null,
  ...exampleDates,
}

const jsonContent = (schema: z.ZodType, example: unknown) => ({
  'application/json': { schema, example },
})

const validationError = (issues: z.core.$ZodIssue[]) => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_request'
    ;(fields[field] ??= []).push(issue.message)
  }
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', {
    fields,
  })
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error.issues)
  return result.data
}

const queryObject = (url: string) =>
  Object.fromEntries(new URL(url).searchParams.entries())

const readJson = async (request: Request) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must contain valid JSON.', {
      fields: { _request: ['Provide a valid JSON request body.'] },
    })
  }
}

const clientIdentifier = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown-client'
}

const registerDocumentation = (routes: OpenAPIHono<AuthEnv>) => {
  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/applications',
    tags: ['Public — Applications'],
    summary: 'Submit a student application',
    description: 'Public non-credentialed submission for university admission or scholarship assistance. Scholarship selection is optional. Requires privacy consent and is protected by a shared rate limit and honeypot. HTTP 201 confirms database acceptance; confirmation and Admin emails are durable best-effort notifications and are not guaranteed to be delivered before the response.',
    security: [],
    request: {
      body: { required: true, content: jsonContent(studentApplicationCreateSchema, applicationCreateExample) },
    },
    responses: {
      201: { description: 'Application accepted without exposing its record identifier.', content: jsonContent(submissionConfirmationResponseSchema, confirmation) },
      400: submissionErrorResponses[400],
      403: submissionErrorResponses[403],
      413: submissionErrorResponses[413],
      415: submissionErrorResponses[415],
      429: submissionErrorResponses[429],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/inquiries',
    tags: ['Public — Inquiries'],
    summary: 'Submit a general inquiry',
    description: 'Public non-credentialed contact submission. Requires privacy consent and is protected by a shared rate limit and honeypot. HTTP 201 confirms database acceptance; confirmation and Admin emails are durable best-effort notifications and are not guaranteed to be delivered before the response.',
    security: [],
    request: {
      body: { required: true, content: jsonContent(generalInquiryCreateSchema, inquiryCreateExample) },
    },
    responses: {
      201: { description: 'Inquiry accepted without exposing its record identifier.', content: jsonContent(submissionConfirmationResponseSchema, confirmation) },
      400: submissionErrorResponses[400],
      403: submissionErrorResponses[403],
      413: submissionErrorResponses[413],
      415: submissionErrorResponses[415],
      429: submissionErrorResponses[429],
    },
  })

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/applications',
    tags: ['Admin — Applications'],
    summary: 'List student applications',
    description: 'ADMIN or SUPER_ADMIN only. Supports status and application-type filters, safe sorting, and pagination.',
    security: [{ accessCookie: [] }],
    request: { query: applicationListQuerySchema },
    responses: {
      200: { description: 'Paginated student applications.', content: jsonContent(applicationListResponseSchema, { success: true, data: { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } } }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/applications/{id}',
    tags: ['Admin — Applications'],
    summary: 'Get a student application',
    description: 'ADMIN or SUPER_ADMIN only. Returns contact data, consent timestamp, workflow status, and private internal note.',
    security: [{ accessCookie: [] }],
    request: { params: submissionUuidParamSchema },
    responses: {
      200: { description: 'Student application detail.', content: jsonContent(studentApplicationResponseSchema, { success: true, data: applicationResponseExample }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403], 404: submissionErrorResponses[404],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch',
    path: '/admin/applications/{id}/status',
    tags: ['Admin — Applications'],
    summary: 'Update application workflow',
    description: 'ADMIN or SUPER_ADMIN only. Updates the workflow status and/or private internal note.',
    security: [{ accessCookie: [] }],
    request: {
      params: submissionUuidParamSchema,
      body: { required: true, content: jsonContent(submissionUpdateSchema, { status: 'IN_REVIEW', internalNote: 'تمت مراجعة الطلب.' }) },
    },
    responses: {
      200: { description: 'Updated student application.', content: jsonContent(studentApplicationResponseSchema, { success: true, data: { ...applicationResponseExample, status: 'IN_REVIEW', internalNote: 'تمت مراجعة الطلب.' } }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403], 404: submissionErrorResponses[404], 415: submissionErrorResponses[415],
    },
  })

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/inquiries',
    tags: ['Admin — Inquiries'],
    summary: 'List general inquiries',
    description: 'ADMIN or SUPER_ADMIN only. Supports workflow-status filtering, safe sorting, and pagination.',
    security: [{ accessCookie: [] }],
    request: { query: inquiryListQuerySchema },
    responses: {
      200: { description: 'Paginated general inquiries.', content: jsonContent(inquiryListResponseSchema, { success: true, data: { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } } }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/admin/inquiries/{id}',
    tags: ['Admin — Inquiries'],
    summary: 'Get a general inquiry',
    description: 'ADMIN or SUPER_ADMIN only. Returns contact data, consent timestamp, workflow status, and private internal note.',
    security: [{ accessCookie: [] }],
    request: { params: submissionUuidParamSchema },
    responses: {
      200: { description: 'General inquiry detail.', content: jsonContent(inquiryResponseSchema, { success: true, data: inquiryResponseExample }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403], 404: submissionErrorResponses[404],
    },
  })
  routes.openAPIRegistry.registerPath({
    method: 'patch',
    path: '/admin/inquiries/{id}/status',
    tags: ['Admin — Inquiries'],
    summary: 'Update inquiry workflow',
    description: 'ADMIN or SUPER_ADMIN only. Updates the workflow status and/or private internal note.',
    security: [{ accessCookie: [] }],
    request: {
      params: submissionUuidParamSchema,
      body: { required: true, content: jsonContent(submissionUpdateSchema, { status: 'RESOLVED', internalNote: 'تم الرد على الاستفسار.' }) },
    },
    responses: {
      200: { description: 'Updated general inquiry.', content: jsonContent(inquiryResponseSchema, { success: true, data: { ...inquiryResponseExample, status: 'RESOLVED', internalNote: 'تم الرد على الاستفسار.' } }) },
      400: submissionErrorResponses[400], 401: submissionErrorResponses[401], 403: submissionErrorResponses[403], 404: submissionErrorResponses[404], 415: submissionErrorResponses[415],
    },
  })
}

export const createSubmissionRoutes = (
  submissionRuntime: SubmissionRuntime,
  authRuntime: AuthRuntime,
) => {
  const routes = new OpenAPIHono<AuthEnv>()
  const publicRoutes = new OpenAPIHono<AuthEnv>()
  const adminRoutes = new OpenAPIHono<AuthEnv>()

  registerDocumentation(routes)

  for (const path of ['/applications', '/inquiries']) {
    publicRoutes.use(path, publicSubmissionCors(authRuntime))
    publicRoutes.use(path, bodyLimit({
      maxSize: MAX_PUBLIC_BODY_BYTES,
      onError: (c) => errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.'),
    }))
  }

  for (const path of ['/applications', '/applications/*', '/inquiries', '/inquiries/*']) {
    adminRoutes.use(path, authCors(authRuntime))
    adminRoutes.use(path, requireTrustedOrigin(authRuntime))
    adminRoutes.use(path, requireAuthentication(authRuntime))
    adminRoutes.use(path, requireRole('ADMIN', 'SUPER_ADMIN'))
  }

  publicRoutes.post('/applications', async (c) => {
    const input = parse(
      studentApplicationCreateSchema,
      await readJson(c.req.raw),
    ) as StudentApplicationInput
    await submissionRuntime.getService().submitApplication(
      input,
      clientIdentifier(c.req.raw),
    )
    return c.json(successResponse({ message: 'Submission received.' }), 201)
  })

  publicRoutes.post('/inquiries', async (c) => {
    const input = parse(
      generalInquiryCreateSchema,
      await readJson(c.req.raw),
    ) as GeneralInquiryInput
    await submissionRuntime.getService().submitInquiry(
      input,
      clientIdentifier(c.req.raw),
    )
    return c.json(successResponse({ message: 'Submission received.' }), 201)
  })

  adminRoutes.get('/applications', async (c) => {
    const query = parse(
      applicationListQuerySchema,
      queryObject(c.req.url),
    ) as SubmissionListQuery
    return c.json(successResponse(
      await submissionRuntime.getService().listApplications(query),
    ), 200)
  })

  adminRoutes.get('/applications/:id', async (c) => {
    const { id } = parse(submissionUuidParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(
      await submissionRuntime.getService().getApplication(id),
    ), 200)
  })

  adminRoutes.patch('/applications/:id/status', async (c) => {
    const { id } = parse(submissionUuidParamSchema, { id: c.req.param('id') })
    const input = parse(
      submissionUpdateSchema,
      await readJson(c.req.raw),
    ) as SubmissionUpdate
    return c.json(successResponse(
      await submissionRuntime.getService().updateApplication(id, input),
    ), 200)
  })

  adminRoutes.get('/inquiries', async (c) => {
    const query = parse(
      inquiryListQuerySchema,
      queryObject(c.req.url),
    ) as SubmissionListQuery
    return c.json(successResponse(
      await submissionRuntime.getService().listInquiries(query),
    ), 200)
  })

  adminRoutes.get('/inquiries/:id', async (c) => {
    const { id } = parse(submissionUuidParamSchema, { id: c.req.param('id') })
    return c.json(successResponse(
      await submissionRuntime.getService().getInquiry(id),
    ), 200)
  })

  adminRoutes.patch('/inquiries/:id/status', async (c) => {
    const { id } = parse(submissionUuidParamSchema, { id: c.req.param('id') })
    const input = parse(
      submissionUpdateSchema,
      await readJson(c.req.raw),
    ) as SubmissionUpdate
    return c.json(successResponse(
      await submissionRuntime.getService().updateInquiry(id, input),
    ), 200)
  })

  routes.route('/', publicRoutes)
  routes.route('/admin', adminRoutes)
  return routes
}
