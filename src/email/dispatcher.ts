import { renderEmailNotification } from './templates.js'
import {
  EmailProviderError,
  type EmailDispatchSummary,
  type EmailDispatchTrigger,
  type EmailNotificationRepository,
  type EmailProvider,
} from './types.js'

const MAX_ATTEMPTS = 4
const LEASE_MS = 2 * 60 * 1_000
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const

const emptySummary = (unavailable = false): EmailDispatchSummary => ({
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  skipped: 0,
  unavailable,
})

export class EmailDispatcher implements EmailDispatchTrigger {
  constructor(
    private readonly repository: EmailNotificationRepository,
    private readonly provider: EmailProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatchPending(limit = 10) {
    if (!this.provider.available) return emptySummary(true)

    const now = this.now()
    const jobs = await this.repository.claimPending(
      Math.max(1, Math.min(limit, 25)),
      now,
      new Date(now.getTime() + LEASE_MS),
    )
    const summary = emptySummary()
    summary.claimed = jobs.length

    await Promise.all(jobs.map(async (job) => {
      if (job.adminUserId && job.adminIsActive !== true) {
        await this.repository.markSkipped(job.id, 'ADMIN_INACTIVE')
        summary.skipped += 1
        return
      }

      try {
        const message = renderEmailNotification(job)
        const result = await this.provider.send(message, job.idempotencyKey)
        await this.repository.markSent(job.id, result.providerMessageId, this.now())
        summary.sent += 1
      } catch (error) {
        const providerError = error instanceof EmailProviderError
          ? error
          : new EmailProviderError('PROVIDER_EXCEPTION', true)
        if (providerError.transient && job.attemptCount < MAX_ATTEMPTS) {
          const delay = RETRY_DELAYS_MS[
            Math.min(job.attemptCount - 1, RETRY_DELAYS_MS.length - 1)
          ] ?? 15 * 60_000
          await this.repository.markRetry(
            job.id,
            providerError.code,
            new Date(this.now().getTime() + delay),
          )
          summary.retried += 1
        } else {
          await this.repository.markFailed(job.id, providerError.code)
          summary.failed += 1
        }
      }
    }))

    return summary
  }
}
