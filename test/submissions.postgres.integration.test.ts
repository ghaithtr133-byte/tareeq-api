import 'dotenv/config'

import { createHmac, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { PrismaSubmissionRepository } from '../src/submissions/prisma-repository.js'
import {
  PUBLIC_SUBMISSION_LIMIT,
  PUBLIC_SUBMISSION_WINDOW_MS,
  SubmissionService,
} from '../src/submissions/service.js'

const shouldRun = process.env.RUN_SUBMISSION_DATABASE_INTEGRATION === '1'

describe.runIf(shouldRun)('submission PostgreSQL integration', () => {
  const repository = new PrismaSubmissionRepository()
  const secret = 'submission-database-integration-secret-longer-than-thirty-two-characters'
  const fixedNow = new Date('2026-10-25T10:00:00.000Z')
  const service = new SubmissionService(repository, secret, () => new Date(fixedNow))
  const createdApplicationIds: string[] = []
  const createdInquiryIds: string[] = []
  const rateLimitKeys: Array<{
    scope: string
    identifierHash: string
    windowStartedAt: Date
  }> = []
  const marker = randomUUID()

  beforeAll(async () => {
    await getPrisma().$queryRaw`SELECT 1`
  }, 30_000)

  afterAll(async () => {
    const prisma = getPrisma()
    if (createdApplicationIds.length > 0) {
      await prisma.studentApplication.deleteMany({
        where: { id: { in: createdApplicationIds } },
      })
    }
    if (createdInquiryIds.length > 0) {
      await prisma.generalInquiry.deleteMany({
        where: { id: { in: createdInquiryIds } },
      })
    }
    for (const key of rateLimitKeys) {
      await prisma.publicSubmissionRateLimit.deleteMany({ where: key })
    }

    const [applications, inquiries, rateLimits] = await Promise.all([
      prisma.studentApplication.count({ where: { id: { in: createdApplicationIds } } }),
      prisma.generalInquiry.count({ where: { id: { in: createdInquiryIds } } }),
      prisma.publicSubmissionRateLimit.count({
        where: { OR: rateLimitKeys },
      }),
    ])
    expect([applications, inquiries, rateLimits]).toEqual([0, 0, 0])
    await disconnectPrisma()
  }, 30_000)

  it('persists, lists, reads, and updates isolated application and inquiry records', async () => {
    const scholarshipApplication = await repository.createApplication({
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      scholarshipId: null,
      countryId: null,
      universityId: null,
      studyLevel: 'MASTERS',
      intendedMajor: 'Integration Test',
      fullName: `Integration Application ${marker}`,
      email: `application-${marker}@example.invalid`,
      phone: null,
      message: 'Isolated PostgreSQL integration application record.',
      privacyAcceptedAt: fixedNow,
    })
    createdApplicationIds.push(scholarshipApplication.id)

    const universityApplication = await repository.createApplication({
      applicationType: 'UNIVERSITY_ADMISSION',
      scholarshipId: null,
      countryId: null,
      universityId: null,
      studyLevel: 'BACHELORS',
      intendedMajor: 'Integration Test',
      fullName: `Integration University Application ${marker}`,
      email: `university-application-${marker}@example.invalid`,
      phone: null,
      message: 'Isolated PostgreSQL university-admission application record.',
      privacyAcceptedAt: fixedNow,
    })
    createdApplicationIds.push(universityApplication.id)

    const inquiry = await repository.createInquiry({
      fullName: `Integration Inquiry ${marker}`,
      email: `inquiry-${marker}@example.invalid`,
      phone: null,
      subject: 'Isolated integration inquiry',
      message: 'Isolated PostgreSQL integration inquiry record.',
      privacyAcceptedAt: fixedNow,
    })
    createdInquiryIds.push(inquiry.id)

    await expect(service.getApplication(scholarshipApplication.id)).resolves.toMatchObject({
      id: scholarshipApplication.id,
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      status: 'NEW',
    })
    await expect(service.getApplication(universityApplication.id)).resolves.toMatchObject({
      id: universityApplication.id,
      applicationType: 'UNIVERSITY_ADMISSION',
      status: 'NEW',
    })
    await expect(service.getInquiry(inquiry.id)).resolves.toMatchObject({
      id: inquiry.id,
      status: 'NEW',
    })

    const inquiries = await service.listInquiries({
      page: 1,
      limit: 50,
      status: 'NEW',
      sort: 'newest',
    })
    expect(inquiries.items.some(({ id }) => id === inquiry.id)).toBe(true)

    const applications = await service.listApplications({
      page: 1,
      limit: 50,
      status: 'NEW',
      applicationType: 'SCHOLARSHIP_ASSISTANCE',
      sort: 'newest',
    })
    expect(applications.items.some(({ id }) => id === scholarshipApplication.id)).toBe(true)
    expect(applications.items.some(({ id }) => id === universityApplication.id)).toBe(false)

    const universityApplications = await service.listApplications({
      page: 1,
      limit: 50,
      status: 'NEW',
      applicationType: 'UNIVERSITY_ADMISSION',
      sort: 'oldest',
    })
    expect(universityApplications.items.some(({ id }) => id === universityApplication.id)).toBe(true)
    expect(universityApplications.items.some(({ id }) => id === scholarshipApplication.id)).toBe(false)

    await expect(service.updateApplication(scholarshipApplication.id, {
      status: 'IN_REVIEW',
      internalNote: `integration-${marker}`,
    })).resolves.toMatchObject({
      status: 'IN_REVIEW',
      internalNote: `integration-${marker}`,
    })
    await expect(service.updateInquiry(inquiry.id, {
      status: 'RESOLVED',
      internalNote: `integration-${marker}`,
    })).resolves.toMatchObject({
      status: 'RESOLVED',
      internalNote: `integration-${marker}`,
    })

    const resolvedInquiries = await service.listInquiries({
      page: 1,
      limit: 50,
      status: 'RESOLVED',
      sort: 'updated',
    })
    expect(resolvedInquiries.items.some(({ id }) => id === inquiry.id)).toBe(true)
  }, 30_000)

  it('atomically rejects the sixth concurrent request in one shared rate bucket', async () => {
    const scope = 'inquiries' as const
    const clientIdentifier = `integration-${marker}`
    const identifierHash = createHmac('sha256', secret)
      .update(`public-submission-rate-limit:v1:${clientIdentifier}`)
      .digest('hex')
    const windowStartedAt = new Date(
      Math.floor(fixedNow.getTime() / PUBLIC_SUBMISSION_WINDOW_MS) * PUBLIC_SUBMISSION_WINDOW_MS,
    )
    const expiresAt = new Date(windowStartedAt.getTime() + PUBLIC_SUBMISSION_WINDOW_MS)
    rateLimitKeys.push({ scope, identifierHash, windowStartedAt })

    const results = await Promise.all(Array.from({ length: 6 }, () =>
      repository.consumeRateLimit(
        scope,
        identifierHash,
        windowStartedAt,
        expiresAt,
        PUBLIC_SUBMISSION_LIMIT,
      ),
    ))
    expect(results.filter(Boolean)).toHaveLength(PUBLIC_SUBMISSION_LIMIT)
    expect(results.filter((allowed) => !allowed)).toHaveLength(1)
  }, 30_000)
})
