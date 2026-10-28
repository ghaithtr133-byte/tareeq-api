import { createHmac } from 'node:crypto'

import { ApiError } from '../shared/http.js'
import type { EmailDispatchTrigger } from '../email/types.js'
import type {
  GeneralInquiryInput,
  StudentApplicationInput,
  SubmissionListQuery,
  SubmissionRepository,
  SubmissionResource,
  SubmissionUpdate,
} from './types.js'

export const PUBLIC_SUBMISSION_LIMIT = 5
export const PUBLIC_SUBMISSION_WINDOW_MS = 15 * 60 * 1_000

const noEmailDispatcher: EmailDispatchTrigger = {
  dispatchPending: async () => ({
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    unavailable: true,
  }),
}

const fieldError = (code: string, field: string, message: string) =>
  new ApiError(400, code, 'A selected reference is invalid or unavailable.', {
    fields: { [field]: [message] },
  })

const normalizeNullable = <T>(value: T | null | undefined) => value ?? null

export class SubmissionService {
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly rateLimitSecret: string,
    private readonly now: () => Date = () => new Date(),
    private readonly emailDispatcher: EmailDispatchTrigger = noEmailDispatcher,
  ) {}

  async submitApplication(input: StudentApplicationInput, clientIdentifier: string) {
    await this.enforceRateLimit('applications', clientIdentifier)
    if (input.website) return

    const now = this.now()
    await this.validateApplicationReferences(input, now)
    await this.repository.createApplication({
      applicationType: input.applicationType,
      scholarshipId: normalizeNullable(input.scholarshipId),
      countryId: normalizeNullable(input.countryId),
      universityId: normalizeNullable(input.universityId),
      studyLevel: normalizeNullable(input.studyLevel),
      intendedMajor: normalizeNullable(input.intendedMajor),
      fullName: input.fullName,
      email: input.email,
      phone: normalizeNullable(input.phone),
      message: input.message,
      privacyAcceptedAt: now,
    })
    await this.attemptEmailDispatch()
  }

  async submitInquiry(input: GeneralInquiryInput, clientIdentifier: string) {
    await this.enforceRateLimit('inquiries', clientIdentifier)
    if (input.website) return

    await this.repository.createInquiry({
      fullName: input.fullName,
      email: input.email,
      phone: normalizeNullable(input.phone),
      subject: input.subject,
      message: input.message,
      privacyAcceptedAt: this.now(),
    })
    await this.attemptEmailDispatch()
  }

  async listApplications(query: SubmissionListQuery) {
    return this.paginated(await this.repository.listApplications(query), query)
  }

  async listInquiries(query: SubmissionListQuery) {
    return this.paginated(await this.repository.listInquiries(query), query)
  }

  async getApplication(id: string) {
    const record = await this.repository.findApplication(id)
    if (!record) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Student application not found.')
    return record
  }

  async getInquiry(id: string) {
    const record = await this.repository.findInquiry(id)
    if (!record) throw new ApiError(404, 'INQUIRY_NOT_FOUND', 'General inquiry not found.')
    return record
  }

  async updateApplication(id: string, input: SubmissionUpdate) {
    await this.getApplication(id)
    return this.repository.updateApplication(id, input)
  }

  async updateInquiry(id: string, input: SubmissionUpdate) {
    await this.getInquiry(id)
    return this.repository.updateInquiry(id, input)
  }

  private paginated<T>(result: { items: T[]; total: number }, query: SubmissionListQuery) {
    return {
      items: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
      },
    }
  }

  private async enforceRateLimit(
    scope: SubmissionResource,
    clientIdentifier: string,
  ) {
    const now = this.now()
    const windowStartMs = Math.floor(now.getTime() / PUBLIC_SUBMISSION_WINDOW_MS) * PUBLIC_SUBMISSION_WINDOW_MS
    const windowStartedAt = new Date(windowStartMs)
    const expiresAt = new Date(windowStartMs + PUBLIC_SUBMISSION_WINDOW_MS)
    const identifierHash = createHmac('sha256', this.rateLimitSecret)
      .update(`public-submission-rate-limit:v1:${clientIdentifier}`)
      .digest('hex')
    const allowed = await this.repository.consumeRateLimit(
      scope,
      identifierHash,
      windowStartedAt,
      expiresAt,
      PUBLIC_SUBMISSION_LIMIT,
    )
    if (!allowed) {
      throw new ApiError(
        429,
        'SUBMISSION_RATE_LIMITED',
        'Too many submissions. Please try again later.',
        { retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)) },
      )
    }
  }

  private async attemptEmailDispatch() {
    try {
      await this.emailDispatcher.dispatchPending(10)
    } catch (error) {
      console.error('Email dispatch failed after submission persistence.', {
        error: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }

  private async validateApplicationReferences(
    input: StudentApplicationInput,
    now: Date,
  ) {
    const country = input.countryId
      ? await this.repository.findPublishedCountry(input.countryId)
      : null
    if (input.countryId && !country) {
      throw fieldError('COUNTRY_UNAVAILABLE', 'countryId', 'Select an available published country.')
    }

    const university = input.universityId
      ? await this.repository.findPublishedUniversity(input.universityId)
      : null
    if (input.universityId && !university) {
      throw fieldError('UNIVERSITY_UNAVAILABLE', 'universityId', 'Select an available published university.')
    }
    if (country && university && university.countryId !== country.id) {
      throw fieldError('RELATIONSHIP_INVALID', 'universityId', 'The selected university must belong to the selected country.')
    }

    const scholarship = input.scholarshipId
      ? await this.repository.findAvailableScholarship(input.scholarshipId, now)
      : null
    if (input.scholarshipId && !scholarship) {
      throw fieldError('SCHOLARSHIP_UNAVAILABLE', 'scholarshipId', 'Select a published scholarship that is currently open.')
    }
    if (country && scholarship?.countryId && scholarship.countryId !== country.id) {
      throw fieldError('RELATIONSHIP_INVALID', 'scholarshipId', 'The selected scholarship must match the selected country.')
    }
    if (
      university &&
      scholarship?.universityId &&
      scholarship.universityId !== university.id
    ) {
      throw fieldError('RELATIONSHIP_INVALID', 'scholarshipId', 'The selected scholarship must match the selected university.')
    }
  }
}
