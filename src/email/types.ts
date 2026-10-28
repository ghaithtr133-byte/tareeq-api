export type EmailNotificationType =
  | 'APPLICATION_ADMIN'
  | 'APPLICATION_STUDENT'
  | 'INQUIRY_ADMIN'
  | 'INQUIRY_STUDENT'

export type EmailNotificationState =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'

export type EmailNotificationJob = {
  id: string
  type: EmailNotificationType
  recipient: string
  idempotencyKey: string
  attemptCount: number
  adminUserId: string | null
  adminIsActive: boolean | null
  application: {
    id: string
    applicationType: 'UNIVERSITY_ADMISSION' | 'SCHOLARSHIP_ASSISTANCE'
    fullName: string
    createdAt: Date
  } | null
  inquiry: {
    id: string
    fullName: string
    createdAt: Date
  } | null
}

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
}

export type EmailSendResult = { providerMessageId: string }

export interface EmailProvider {
  readonly available: boolean
  send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>
}

export interface EmailNotificationRepository {
  claimPending(limit: number, now: Date, leaseUntil: Date): Promise<EmailNotificationJob[]>
  markSent(id: string, providerMessageId: string, now: Date): Promise<void>
  markRetry(id: string, errorCode: string, nextAttemptAt: Date): Promise<void>
  markFailed(id: string, errorCode: string): Promise<void>
  markSkipped(id: string, reasonCode: string): Promise<void>
}

export interface EmailDispatchTrigger {
  dispatchPending(limit?: number): Promise<EmailDispatchSummary>
}

export type EmailDispatchSummary = {
  claimed: number
  sent: number
  retried: number
  failed: number
  skipped: number
  unavailable: boolean
}

export class EmailProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly transient: boolean,
  ) {
    super('Email provider request failed.')
    this.name = 'EmailProviderError'
  }
}
