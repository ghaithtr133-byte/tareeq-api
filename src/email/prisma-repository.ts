import { getPrisma } from '../database/client.js'
import type {
  EmailNotificationJob,
  EmailNotificationRepository,
  EmailNotificationType,
} from './types.js'

type ClaimedId = { id: string }

export class PrismaEmailNotificationRepository implements EmailNotificationRepository {
  async claimPending(limit: number, now: Date, leaseUntil: Date) {
    const prisma = getPrisma()
    await prisma.$executeRaw`
      UPDATE "EmailNotification"
      SET
        "state" = 'FAILED'::"EmailNotificationState",
        "lastErrorCode" = CASE
          WHEN "retryUntil" <= ${now} THEN 'RETRY_WINDOW_EXPIRED'
          ELSE 'ATTEMPTS_EXHAUSTED'
        END,
        "leaseUntil" = NULL,
        "updatedAt" = ${now}
      WHERE "state" IN (
        'PENDING'::"EmailNotificationState",
        'PROCESSING'::"EmailNotificationState"
      )
      AND (
        "retryUntil" <= ${now}
        OR (
          "attemptCount" >= 4
          AND (
            "state" = 'PENDING'::"EmailNotificationState"
            OR "leaseUntil" <= ${now}
          )
        )
      )
    `

    const claimed = await prisma.$queryRaw<ClaimedId[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "EmailNotification"
        WHERE (
          ("state" = 'PENDING'::"EmailNotificationState" AND "nextAttemptAt" <= ${now})
          OR
          ("state" = 'PROCESSING'::"EmailNotificationState" AND "leaseUntil" <= ${now})
        )
        AND "retryUntil" > ${now}
        AND "attemptCount" < 4
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "EmailNotification" AS notification
      SET
        "state" = 'PROCESSING'::"EmailNotificationState",
        "attemptCount" = notification."attemptCount" + 1,
        "leaseUntil" = ${leaseUntil},
        "updatedAt" = ${now}
      FROM candidates
      WHERE notification."id" = candidates."id"
      RETURNING notification."id"
    `
    const ids = claimed.map(({ id }) => id)
    if (ids.length === 0) return []

    const records = await prisma.emailNotification.findMany({
      where: { id: { in: ids } },
      include: {
        application: {
          select: { id: true, applicationType: true, fullName: true, createdAt: true },
        },
        inquiry: {
          select: { id: true, fullName: true, createdAt: true },
        },
        adminUser: { select: { isActive: true } },
      },
    })

    return records.map((record): EmailNotificationJob => ({
      id: record.id,
      type: record.type as EmailNotificationType,
      recipient: record.recipient,
      idempotencyKey: record.idempotencyKey,
      attemptCount: record.attemptCount,
      adminUserId: record.adminUserId,
      adminIsActive: record.adminUser?.isActive ?? null,
      application: record.application
        ? {
            ...record.application,
            applicationType: record.application.applicationType as
              'UNIVERSITY_ADMISSION' | 'SCHOLARSHIP_ASSISTANCE',
          }
        : null,
      inquiry: record.inquiry,
    }))
  }

  async markSent(id: string, providerMessageId: string, now: Date) {
    await getPrisma().emailNotification.updateMany({
      where: { id, state: 'PROCESSING' },
      data: {
        state: 'SENT',
        providerMessageId,
        lastErrorCode: null,
        leaseUntil: null,
        sentAt: now,
      },
    })
  }

  async markRetry(id: string, errorCode: string, nextAttemptAt: Date) {
    await getPrisma().emailNotification.updateMany({
      where: { id, state: 'PROCESSING' },
      data: {
        state: 'PENDING',
        lastErrorCode: errorCode,
        nextAttemptAt,
        leaseUntil: null,
      },
    })
  }

  async markFailed(id: string, errorCode: string) {
    await getPrisma().emailNotification.updateMany({
      where: { id, state: 'PROCESSING' },
      data: {
        state: 'FAILED',
        lastErrorCode: errorCode,
        leaseUntil: null,
      },
    })
  }

  async markSkipped(id: string, reasonCode: string) {
    await getPrisma().emailNotification.updateMany({
      where: { id, state: 'PROCESSING' },
      data: {
        state: 'SKIPPED',
        lastErrorCode: reasonCode,
        leaseUntil: null,
      },
    })
  }
}
