import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { EmailDispatcher } from '../src/email/dispatcher.js'
import { PrismaEmailNotificationRepository } from '../src/email/prisma-repository.js'
import {
  EmailProviderError,
  type EmailMessage,
  type EmailProvider,
} from '../src/email/types.js'
import { PrismaSubmissionRepository } from '../src/submissions/prisma-repository.js'

const shouldRun = process.env.RUN_EMAIL_DATABASE_INTEGRATION === '1'

describe.runIf(shouldRun)('email outbox PostgreSQL integration', () => {
  const submissions = new PrismaSubmissionRepository()
  const applicationIds: string[] = []
  const inquiryIds: string[] = []
  const notificationIds: string[] = []
  const marker = randomUUID()
  const inactiveAdminId = randomUUID()
  const now = new Date()
  let baseline: {
    admins: number
    content: number
    applications: number
    inquiries: number
    permanentAdmins: string
  }

  class MockEmailProvider implements EmailProvider {
    readonly available = true
    readonly calls: Array<{ message: EmailMessage; idempotencyKey: string }> = []

    constructor(private readonly failTransiently = false) {}

    async send(message: EmailMessage, idempotencyKey: string) {
      this.calls.push({ message, idempotencyKey })
      if (this.failTransiently) {
        throw new EmailProviderError('TIMEOUT', true)
      }
      await Promise.resolve()
      return { providerMessageId: `postgres-integration-${this.calls.length}` }
    }
  }

  const contentCount = async () => {
    const prisma = getPrisma()
    const counts = await Promise.all([
      prisma.country.count(),
      prisma.university.count(),
      prisma.scholarship.count(),
      prisma.service.count(),
      prisma.article.count(),
    ])
    return counts.reduce((total, count) => total + count, 0)
  }

  const permanentAdminSnapshot = async () => JSON.stringify(
    await getPrisma().adminUser.findMany({
      where: { id: { not: inactiveAdminId } },
      orderBy: { id: 'asc' },
      select: { id: true, email: true, role: true, isActive: true, updatedAt: true },
    }),
  )

  beforeAll(async () => {
    const prisma = getPrisma()
    await prisma.$queryRaw`SELECT 1`
    baseline = {
      admins: await prisma.adminUser.count(),
      content: await contentCount(),
      applications: await prisma.studentApplication.count(),
      inquiries: await prisma.generalInquiry.count(),
      permanentAdmins: await permanentAdminSnapshot(),
    }
    await prisma.adminUser.create({
      data: {
        id: inactiveAdminId,
        name: 'Email Integration Disabled Admin',
        email: `email-disabled-admin-${marker}@example.invalid`,
        passwordHash: '$argon2id$integration-test-only',
        role: 'ADMIN',
        isActive: false,
      },
    })
  }, 30_000)

  afterAll(async () => {
    const prisma = getPrisma()
    try {
      const exactNotificationFilter = {
        OR: [
          { id: { in: [...new Set(notificationIds)] } },
          { applicationId: { in: applicationIds } },
          { inquiryId: { in: inquiryIds } },
        ],
      }
      await prisma.emailNotification.deleteMany({ where: exactNotificationFilter })
      await prisma.studentApplication.deleteMany({ where: { id: { in: applicationIds } } })
      await prisma.generalInquiry.deleteMany({ where: { id: { in: inquiryIds } } })
      await prisma.adminUser.deleteMany({ where: { id: inactiveAdminId } })

      const [notifications, applications, inquiries, admins, content, permanentAdmins] =
        await Promise.all([
          prisma.emailNotification.count({ where: exactNotificationFilter }),
          prisma.studentApplication.count({ where: { id: { in: applicationIds } } }),
          prisma.generalInquiry.count({ where: { id: { in: inquiryIds } } }),
          prisma.adminUser.count(),
          contentCount(),
          permanentAdminSnapshot(),
        ])
      expect([notifications, applications, inquiries]).toEqual([0, 0, 0])
      expect({
        admins,
        content,
        applications: await prisma.studentApplication.count(),
        inquiries: await prisma.generalInquiry.count(),
        permanentAdmins,
      }).toEqual(baseline)
    } finally {
      await disconnectPrisma()
    }
  }, 30_000)

  it('commits submission and active-recipient notification intents atomically', async () => {
    const application = await submissions.createApplication({
      applicationType: 'UNIVERSITY_ADMISSION',
      scholarshipId: null,
      countryId: null,
      universityId: null,
      studyLevel: 'BACHELORS',
      intendedMajor: 'Integration Test',
      fullName: `Email Integration Application ${marker}`,
      email: `email-application-${marker}@example.invalid`,
      phone: null,
      message: 'Isolated email outbox integration application.',
      privacyAcceptedAt: now,
    })
    applicationIds.push(application.id)

    const inquiry = await submissions.createInquiry({
      fullName: `Email Integration Inquiry ${marker}`,
      email: `email-inquiry-${marker}@example.invalid`,
      phone: null,
      subject: 'Email outbox integration',
      message: 'Isolated email outbox integration inquiry.',
      privacyAcceptedAt: now,
    })
    inquiryIds.push(inquiry.id)

    const records = await getPrisma().emailNotification.findMany({
      where: {
        OR: [
          { applicationId: application.id },
          { inquiryId: inquiry.id },
        ],
      },
      select: {
        id: true,
        type: true,
        state: true,
        adminUserId: true,
        idempotencyKey: true,
        adminUser: { select: { isActive: true } },
      },
    })
    notificationIds.push(...records.map(({ id }) => id))

    expect(records.filter(({ type }) => type === 'APPLICATION_STUDENT')).toHaveLength(1)
    expect(records.filter(({ type }) => type === 'INQUIRY_STUDENT')).toHaveLength(1)
    expect(records.filter(({ type }) => type === 'APPLICATION_ADMIN').every(
      ({ adminUser }) => adminUser?.isActive === true,
    )).toBe(true)
    expect(records.filter(({ type }) => type === 'INQUIRY_ADMIN').every(
      ({ adminUser }) => adminUser?.isActive === true,
    )).toBe(true)
    expect(records.some(({ adminUserId }) => adminUserId === inactiveAdminId)).toBe(false)
    expect(new Set(records.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(
      records.length,
    )
    expect(records.every(({ state }) => state === 'PENDING')).toBe(true)
  }, 30_000)

  it('claims concurrently without duplicate PostgreSQL delivery', async () => {
    const provider = new MockEmailProvider()
    const first = new EmailDispatcher(
      new PrismaEmailNotificationRepository(),
      provider,
      () => new Date(now),
    )
    const second = new EmailDispatcher(
      new PrismaEmailNotificationRepository(),
      provider,
      () => new Date(now),
    )

    const results = await Promise.all([
      first.dispatchPending(25),
      second.dispatchPending(25),
    ])
    const fixtureNotifications = await getPrisma().emailNotification.findMany({
      where: {
        OR: [
          { applicationId: { in: applicationIds } },
          { inquiryId: { in: inquiryIds } },
        ],
      },
      select: { id: true, state: true, attemptCount: true, idempotencyKey: true },
    })
    notificationIds.push(...fixtureNotifications.map(({ id }) => id))

    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(
      fixtureNotifications.length,
    )
    expect(provider.calls).toHaveLength(fixtureNotifications.length)
    expect(new Set(provider.calls.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(
      fixtureNotifications.length,
    )
    expect(fixtureNotifications.every(
      ({ state, attemptCount }) => state === 'SENT' && attemptCount === 1,
    )).toBe(true)
  }, 30_000)

  it('persists failures and stops PostgreSQL retries after four attempts', async () => {
    const retryInquiry = await submissions.createInquiry({
      fullName: `Email Retry Inquiry ${marker}`,
      email: `email-retry-${marker}@example.invalid`,
      phone: null,
      subject: 'Email outbox retry integration',
      message: 'Isolated email retry integration inquiry.',
      privacyAcceptedAt: now,
    })
    inquiryIds.push(retryInquiry.id)
    const retryRecords = await getPrisma().emailNotification.findMany({
      where: { inquiryId: retryInquiry.id },
      select: { id: true, idempotencyKey: true },
    })
    notificationIds.push(...retryRecords.map(({ id }) => id))
    const originalKeys = retryRecords.map(({ idempotencyKey }) => idempotencyKey).sort()

    let currentNow = new Date(now)
    const provider = new MockEmailProvider(true)
    const dispatcher = new EmailDispatcher(
      new PrismaEmailNotificationRepository(),
      provider,
      () => new Date(currentNow),
    )
    await dispatcher.dispatchPending(25)
    for (const delay of [61_000, 5 * 60_000 + 1_000, 15 * 60_000 + 1_000]) {
      currentNow = new Date(currentNow.getTime() + delay)
      await dispatcher.dispatchPending(25)
    }

    const failed = await getPrisma().emailNotification.findMany({
      where: { inquiryId: retryInquiry.id },
      select: {
        state: true,
        attemptCount: true,
        lastErrorCode: true,
        idempotencyKey: true,
      },
    })
    expect(failed.every(({ state, attemptCount, lastErrorCode }) =>
      state === 'FAILED' && attemptCount === 4 && lastErrorCode === 'TIMEOUT',
    )).toBe(true)
    expect(failed.map(({ idempotencyKey }) => idempotencyKey).sort()).toEqual(originalKeys)
    expect(provider.calls).toHaveLength(retryRecords.length * 4)
  }, 30_000)

})
