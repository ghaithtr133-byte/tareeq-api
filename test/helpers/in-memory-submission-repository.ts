import type {
  AvailableScholarshipReference,
  GeneralInquiryInput,
  GeneralInquiryRecord,
  PublishedCountryReference,
  PublishedUniversityReference,
  StudentApplicationInput,
  StudentApplicationRecord,
  SubmissionListQuery,
  SubmissionRepository,
  SubmissionUpdate,
} from '../../src/submissions/types.js'
import type {
  EmailNotificationJob,
  EmailNotificationRepository,
  EmailNotificationState,
  EmailNotificationType,
} from '../../src/email/types.js'

type InMemoryEmailNotification = EmailNotificationJob & {
  state: EmailNotificationState
  nextAttemptAt: Date
  retryUntil: Date
  leaseUntil: Date | null
  providerMessageId: string | null
  lastErrorCode: string | null
}

export class InMemorySubmissionRepository implements SubmissionRepository, EmailNotificationRepository {
  readonly applications: StudentApplicationRecord[] = []
  readonly inquiries: GeneralInquiryRecord[] = []
  readonly countries = new Map<string, PublishedCountryReference>()
  readonly universities = new Map<string, PublishedUniversityReference>()
  readonly scholarships = new Map<string, AvailableScholarshipReference & {
    availableUntil?: Date
  }>()
  readonly adminUsers = new Map<string, { email: string; isActive: boolean }>()
  readonly emailNotifications: InMemoryEmailNotification[] = []
  private readonly rateLimits = new Map<string, number>()

  async consumeRateLimit(
    scope: 'applications' | 'inquiries',
    identifierHash: string,
    windowStartedAt: Date,
    _expiresAt: Date,
    limit: number,
  ) {
    const key = `${scope}:${identifierHash}:${windowStartedAt.toISOString()}`
    const next = (this.rateLimits.get(key) ?? 0) + 1
    this.rateLimits.set(key, next)
    return next <= limit
  }

  async findPublishedCountry(id: string) {
    return this.countries.get(id) ?? null
  }

  async findPublishedUniversity(id: string) {
    return this.universities.get(id) ?? null
  }

  async findAvailableScholarship(id: string, now: Date) {
    const record = this.scholarships.get(id)
    if (!record || (record.availableUntil && record.availableUntil < now)) return null
    return record
  }

  async createApplication(
    data: Omit<StudentApplicationInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ) {
    const now = data.privacyAcceptedAt
    const record: StudentApplicationRecord = {
      id: crypto.randomUUID(),
      applicationType: data.applicationType,
      scholarshipId: data.scholarshipId ?? null,
      countryId: data.countryId ?? null,
      universityId: data.universityId ?? null,
      studyLevel: data.studyLevel ?? null,
      intendedMajor: data.intendedMajor ?? null,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      message: data.message,
      status: 'NEW',
      internalNote: null,
      privacyAcceptedAt: data.privacyAcceptedAt,
      createdAt: now,
      updatedAt: now,
    }
    this.applications.push(record)
    this.enqueueNotifications(
      'APPLICATION_STUDENT',
      'APPLICATION_ADMIN',
      record.id,
      record.email,
      record.createdAt,
      {
        id: record.id,
        applicationType: record.applicationType,
        fullName: record.fullName,
        createdAt: record.createdAt,
      },
      null,
    )
    return record
  }

  async createInquiry(
    data: Omit<GeneralInquiryInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ) {
    const now = data.privacyAcceptedAt
    const record: GeneralInquiryRecord = {
      id: crypto.randomUUID(),
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      subject: data.subject,
      message: data.message,
      status: 'NEW',
      internalNote: null,
      privacyAcceptedAt: data.privacyAcceptedAt,
      createdAt: now,
      updatedAt: now,
    }
    this.inquiries.push(record)
    this.enqueueNotifications(
      'INQUIRY_STUDENT',
      'INQUIRY_ADMIN',
      record.id,
      record.email,
      record.createdAt,
      null,
      {
        id: record.id,
        fullName: record.fullName,
        createdAt: record.createdAt,
      },
    )
    return record
  }

  async listApplications(query: SubmissionListQuery) {
    return this.list(
      this.applications.filter((record) =>
        (!query.status || record.status === query.status) &&
        (!query.applicationType || record.applicationType === query.applicationType),
      ),
      query,
    )
  }

  async listInquiries(query: SubmissionListQuery) {
    return this.list(
      this.inquiries.filter((record) => !query.status || record.status === query.status),
      query,
    )
  }

  async findApplication(id: string) {
    return this.applications.find((record) => record.id === id) ?? null
  }

  async findInquiry(id: string) {
    return this.inquiries.find((record) => record.id === id) ?? null
  }

  async updateApplication(id: string, data: SubmissionUpdate) {
    const record = await this.findApplication(id)
    if (!record) throw new Error('Missing in-memory application fixture.')
    Object.assign(record, data, { updatedAt: new Date(record.updatedAt.getTime() + 1) })
    return record
  }

  async updateInquiry(id: string, data: SubmissionUpdate) {
    const record = await this.findInquiry(id)
    if (!record) throw new Error('Missing in-memory inquiry fixture.')
    Object.assign(record, data, { updatedAt: new Date(record.updatedAt.getTime() + 1) })
    return record
  }

  async claimPending(limit: number, now: Date, leaseUntil: Date) {
    const eligible = this.emailNotifications.filter((notification) => {
      if (notification.retryUntil <= now) {
        notification.state = 'FAILED'
        notification.lastErrorCode = 'RETRY_WINDOW_EXPIRED'
        return false
      }
      return notification.attemptCount < 4 && (
        notification.state === 'PENDING' && notification.nextAttemptAt <= now ||
        notification.state === 'PROCESSING' && notification.leaseUntil !== null && notification.leaseUntil <= now
      )
    }).slice(0, limit)
    for (const notification of eligible) {
      notification.state = 'PROCESSING'
      notification.attemptCount += 1
      notification.leaseUntil = leaseUntil
      if (notification.adminUserId) {
        notification.adminIsActive = this.adminUsers.get(notification.adminUserId)?.isActive ?? false
      }
    }
    return eligible
  }

  async markSent(id: string, providerMessageId: string) {
    const notification = this.notification(id)
    notification.state = 'SENT'
    notification.providerMessageId = providerMessageId
    notification.lastErrorCode = null
    notification.leaseUntil = null
  }

  async markRetry(id: string, errorCode: string, nextAttemptAt: Date) {
    const notification = this.notification(id)
    notification.state = 'PENDING'
    notification.lastErrorCode = errorCode
    notification.nextAttemptAt = nextAttemptAt
    notification.leaseUntil = null
  }

  async markFailed(id: string, errorCode: string) {
    const notification = this.notification(id)
    notification.state = 'FAILED'
    notification.lastErrorCode = errorCode
    notification.leaseUntil = null
  }

  async markSkipped(id: string, reasonCode: string) {
    const notification = this.notification(id)
    notification.state = 'SKIPPED'
    notification.lastErrorCode = reasonCode
    notification.leaseUntil = null
  }

  private enqueueNotifications(
    studentType: EmailNotificationType,
    adminType: EmailNotificationType,
    submissionId: string,
    studentEmail: string,
    now: Date,
    application: EmailNotificationJob['application'],
    inquiry: EmailNotificationJob['inquiry'],
  ) {
    const source = application ? 'application' : 'inquiry'
    this.emailNotifications.push(this.newNotification(
      studentType,
      studentEmail,
      `${source}-student/${submissionId}`,
      now,
      null,
      application,
      inquiry,
    ))
    for (const [adminUserId, admin] of this.adminUsers) {
      if (!admin.isActive) continue
      this.emailNotifications.push(this.newNotification(
        adminType,
        admin.email,
        `${source}-admin/${submissionId}/${adminUserId}`,
        now,
        adminUserId,
        application,
        inquiry,
      ))
    }
  }

  private newNotification(
    type: EmailNotificationType,
    recipient: string,
    idempotencyKey: string,
    now: Date,
    adminUserId: string | null,
    application: EmailNotificationJob['application'],
    inquiry: EmailNotificationJob['inquiry'],
  ): InMemoryEmailNotification {
    return {
      id: crypto.randomUUID(),
      type,
      recipient,
      idempotencyKey,
      attemptCount: 0,
      adminUserId,
      adminIsActive: adminUserId ? true : null,
      application,
      inquiry,
      state: 'PENDING',
      nextAttemptAt: now,
      retryUntil: new Date(now.getTime() + 23 * 60 * 60 * 1_000),
      leaseUntil: null,
      providerMessageId: null,
      lastErrorCode: null,
    }
  }

  private notification(id: string) {
    const notification = this.emailNotifications.find((candidate) => candidate.id === id)
    if (!notification) throw new Error('Missing in-memory email notification fixture.')
    return notification
  }

  private list<T extends { id: string; createdAt: Date; updatedAt: Date }>(
    records: T[],
    query: SubmissionListQuery,
  ) {
    records.sort((left, right) => {
      if (query.sort === 'oldest') {
        return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
      }
      if (query.sort === 'updated') {
        return right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id)
      }
      return right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)
    })
    const total = records.length
    const offset = (query.page - 1) * query.limit
    return { items: records.slice(offset, offset + query.limit), total }
  }
}
