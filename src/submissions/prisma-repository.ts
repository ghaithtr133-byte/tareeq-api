import { getPrisma } from '../database/client.js'
import type {
  AvailableScholarshipReference,
  GeneralInquiryInput,
  GeneralInquiryRecord,
  StudentApplicationInput,
  StudentApplicationRecord,
  SubmissionListQuery,
  SubmissionRepository,
  SubmissionUpdate,
} from './types.js'

const skipFor = (query: SubmissionListQuery) => (query.page - 1) * query.limit

const orderByFor = (sort: SubmissionListQuery['sort']) => {
  switch (sort) {
    case 'oldest': return [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
    case 'updated': return [{ updatedAt: 'desc' as const }, { id: 'asc' as const }]
    case 'newest': return [{ createdAt: 'desc' as const }, { id: 'asc' as const }]
  }
}

const asApplication = (value: unknown) => value as StudentApplicationRecord
const asInquiry = (value: unknown) => value as GeneralInquiryRecord
const EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000

const notificationTiming = (now: Date) => ({
  nextAttemptAt: now,
  retryUntil: new Date(now.getTime() + EMAIL_RETRY_WINDOW_MS),
})

export class PrismaSubmissionRepository implements SubmissionRepository {
  async consumeRateLimit(
    scope: 'applications' | 'inquiries',
    identifierHash: string,
    windowStartedAt: Date,
    expiresAt: Date,
    limit: number,
  ) {
    const prisma = getPrisma()
    await prisma.$executeRaw`
      DELETE FROM "PublicSubmissionRateLimit"
      WHERE ("scope", "identifierHash", "windowStartedAt") IN (
        SELECT "scope", "identifierHash", "windowStartedAt"
        FROM "PublicSubmissionRateLimit"
        WHERE "expiresAt" < NOW()
        ORDER BY "expiresAt" ASC
        LIMIT 100
      )
    `
    const bucket = await prisma.publicSubmissionRateLimit.upsert({
      where: {
        scope_identifierHash_windowStartedAt: {
          scope,
          identifierHash,
          windowStartedAt,
        },
      },
      create: {
        scope,
        identifierHash,
        windowStartedAt,
        count: 1,
        expiresAt,
      },
      update: {
        count: { increment: 1 },
        expiresAt,
      },
      select: { count: true },
    })
    return bucket.count <= limit
  }

  async findPublishedCountry(id: string) {
    return getPrisma().country.findFirst({
      where: { id, status: 'PUBLISHED' },
      select: { id: true },
    })
  }

  async findPublishedUniversity(id: string) {
    return getPrisma().university.findFirst({
      where: { id, status: 'PUBLISHED' },
      select: { id: true, countryId: true },
    })
  }

  async findAvailableScholarship(
    id: string,
    now: Date,
  ): Promise<AvailableScholarshipReference | null> {
    return getPrisma().scholarship.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        applicationStatus: 'OPEN',
        OR: [{ verifiedDeadline: null }, { verifiedDeadline: { gte: now } }],
      },
      select: { id: true, countryId: true, universityId: true },
    })
  }

  async createApplication(
    data: Omit<StudentApplicationInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ) {
    return getPrisma().$transaction(async (transaction) => {
      const record = await transaction.studentApplication.create({ data })
      const admins = await transaction.adminUser.findMany({
        where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true, email: true },
      })
      const timing = notificationTiming(data.privacyAcceptedAt)
      await transaction.emailNotification.createMany({
        data: [
          {
            type: 'APPLICATION_STUDENT',
            applicationId: record.id,
            recipient: record.email,
            idempotencyKey: `application-student/${record.id}`,
            ...timing,
          },
          ...admins.map((admin) => ({
            type: 'APPLICATION_ADMIN' as const,
            applicationId: record.id,
            adminUserId: admin.id,
            recipient: admin.email,
            idempotencyKey: `application-admin/${record.id}/${admin.id}`,
            ...timing,
          })),
        ],
      })
      return asApplication(record)
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async createInquiry(
    data: Omit<GeneralInquiryInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ) {
    return getPrisma().$transaction(async (transaction) => {
      const record = await transaction.generalInquiry.create({ data })
      const admins = await transaction.adminUser.findMany({
        where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true, email: true },
      })
      const timing = notificationTiming(data.privacyAcceptedAt)
      await transaction.emailNotification.createMany({
        data: [
          {
            type: 'INQUIRY_STUDENT',
            inquiryId: record.id,
            recipient: record.email,
            idempotencyKey: `inquiry-student/${record.id}`,
            ...timing,
          },
          ...admins.map((admin) => ({
            type: 'INQUIRY_ADMIN' as const,
            inquiryId: record.id,
            adminUserId: admin.id,
            recipient: admin.email,
            idempotencyKey: `inquiry-admin/${record.id}/${admin.id}`,
            ...timing,
          })),
        ],
      })
      return asInquiry(record)
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async listApplications(query: SubmissionListQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.applicationType ? { applicationType: query.applicationType } : {}),
    }
    const prisma = getPrisma()
    const [items, total] = await Promise.all([
      prisma.studentApplication.findMany({
        where,
        orderBy: orderByFor(query.sort),
        skip: skipFor(query),
        take: query.limit,
      }),
      prisma.studentApplication.count({ where }),
    ])
    return { items: items.map(asApplication), total }
  }

  async listInquiries(query: SubmissionListQuery) {
    const where = query.status ? { status: query.status } : {}
    const prisma = getPrisma()
    const [items, total] = await Promise.all([
      prisma.generalInquiry.findMany({
        where,
        orderBy: orderByFor(query.sort),
        skip: skipFor(query),
        take: query.limit,
      }),
      prisma.generalInquiry.count({ where }),
    ])
    return { items: items.map(asInquiry), total }
  }

  async findApplication(id: string) {
    const record = await getPrisma().studentApplication.findUnique({ where: { id } })
    return record ? asApplication(record) : null
  }

  async findInquiry(id: string) {
    const record = await getPrisma().generalInquiry.findUnique({ where: { id } })
    return record ? asInquiry(record) : null
  }

  async updateApplication(id: string, data: SubmissionUpdate) {
    return asApplication(await getPrisma().studentApplication.update({ where: { id }, data }))
  }

  async updateInquiry(id: string, data: SubmissionUpdate) {
    return asInquiry(await getPrisma().generalInquiry.update({ where: { id }, data }))
  }
}
