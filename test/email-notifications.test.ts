import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailDispatcher } from '../src/email/dispatcher.js'
import {
  createEmailProvider,
  UnavailableEmailProvider,
} from '../src/email/provider.js'
import { createEmailDispatchRoutes } from '../src/email/routes.js'
import {
  EmailProviderError,
  type EmailMessage,
  type EmailProvider,
} from '../src/email/types.js'
import { SubmissionService } from '../src/submissions/service.js'
import { InMemorySubmissionRepository } from './helpers/in-memory-submission-repository.js'

const FIXED_NOW = new Date('2026-10-26T08:00:00.000Z')
const JWT_SECRET = 'task-six-test-secret-longer-than-thirty-two-characters'

const applicationInput = (overrides: Record<string, unknown> = {}) => ({
  applicationType: 'SCHOLARSHIP_ASSISTANCE' as const,
  scholarshipId: null,
  countryId: null,
  universityId: null,
  studyLevel: 'MASTERS',
  intendedMajor: 'Computer Science',
  fullName: 'أحمد محمد',
  email: 'student@example.invalid',
  phone: '+963 900 000 000',
  message: 'أرغب بالحصول على مساعدة في التقديم لهذه الفرصة التعليمية.',
  privacyAccepted: true as const,
  website: '',
  ...overrides,
})

const inquiryInput = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'سارة أحمد',
  email: 'inquirer@example.invalid',
  phone: null,
  subject: 'استفسار عن الخدمات',
  message: 'أرغب بمعرفة المزيد عن خدمات أكاديمية طريق المتاحة للطلاب.',
  privacyAccepted: true as const,
  website: '',
  ...overrides,
})

class MockEmailProvider implements EmailProvider {
  readonly available = true
  readonly calls: Array<{ message: EmailMessage; idempotencyKey: string }> = []

  constructor(
    private readonly behavior: (
      message: EmailMessage,
      idempotencyKey: string,
      callNumber: number,
    ) => Promise<{ providerMessageId: string }> = async (_message, _key, callNumber) => ({
      providerMessageId: `provider-${callNumber}`,
    }),
  ) {}

  async send(message: EmailMessage, idempotencyKey: string) {
    this.calls.push({ message, idempotencyKey })
    return this.behavior(message, idempotencyKey, this.calls.length)
  }
}

describe('Task #6 email notifications', () => {
  let repository: InMemorySubmissionRepository
  let currentNow: Date

  beforeEach(() => {
    repository = new InMemorySubmissionRepository()
    currentNow = new Date(FIXED_NOW)
    repository.adminUsers.set('11111111-1111-4111-8111-111111111111', {
      email: 'active-admin@example.invalid',
      isActive: true,
    })
    repository.adminUsers.set('22222222-2222-4222-8222-222222222222', {
      email: 'disabled-admin@example.invalid',
      isActive: false,
    })
  })

  const serviceWith = (provider: EmailProvider) => {
    const dispatcher = new EmailDispatcher(repository, provider, () => new Date(currentNow))
    return new SubmissionService(
      repository,
      JWT_SECRET,
      () => new Date(currentNow),
      dispatcher,
    )
  }

  it('sends separate Arabic HTML and text application notifications to the student and active Admin only', async () => {
    const provider = new MockEmailProvider()
    await serviceWith(provider).submitApplication(applicationInput(), 'application-client')

    expect(provider.calls).toHaveLength(2)
    expect(provider.calls.map(({ message }) => message.to).sort()).toEqual([
      'active-admin@example.invalid',
      'student@example.invalid',
    ])
    expect(provider.calls.some(({ message }) => message.to === 'disabled-admin@example.invalid')).toBe(false)

    const student = provider.calls.find(({ message }) => message.to === 'student@example.invalid')
    expect(student?.message.subject).toContain('تأكيد استلام طلب')
    expect(student?.message.html).toContain('dir="rtl"')
    expect(student?.message.html).toContain('ولا يُعد قبولاً أو تأكيداً')
    expect(student?.message.text).toContain('ولا يُعد قبولاً أو تأكيداً')

    const admin = provider.calls.find(({ message }) => message.to === 'active-admin@example.invalid')
    expect(admin?.message.subject).toContain('طلب مساعدة طلابية جديد')
    expect(admin?.message.html).not.toContain('student@example.invalid')
    expect(admin?.message.text).not.toContain(applicationInput().message)
    expect(repository.emailNotifications.every(({ state }) => state === 'SENT')).toBe(true)
  })

  it('sends distinct inquiry notifications without exposing inquiry content to Admin email', async () => {
    const provider = new MockEmailProvider()
    await serviceWith(provider).submitInquiry(inquiryInput(), 'inquiry-client')

    expect(provider.calls).toHaveLength(2)
    const student = provider.calls.find(({ message }) => message.to === 'inquirer@example.invalid')
    const admin = provider.calls.find(({ message }) => message.to === 'active-admin@example.invalid')
    expect(student?.message.subject).toContain('تأكيد استلام استفسارك')
    expect(student?.message.html).toContain('تم استلام استفسارك')
    expect(student?.message.text).toContain('استلمنا استفسارك')
    expect(admin?.message.subject).toContain('استفسار طلابي جديد')
    expect(admin?.message.html).not.toContain('inquirer@example.invalid')
    expect(admin?.message.text).not.toContain(inquiryInput().message)
  })

  it('escapes user-provided names in HTML templates', async () => {
    const provider = new MockEmailProvider()
    await serviceWith(provider).submitInquiry(inquiryInput({
      fullName: '<script>alert(1)</script> & طالب',
    }), 'escape-client')

    const student = provider.calls.find(({ message }) => message.to === 'inquirer@example.invalid')
    expect(student?.message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; طالب')
    expect(student?.message.html).not.toContain('<script>')
  })

  it('keeps intents pending when Resend configuration is missing', async () => {
    const provider = createEmailProvider({ status: 'MISSING' })
    expect(provider.available).toBe(false)
    await serviceWith(provider).submitApplication(
      applicationInput(),
      'missing-config-client',
    )

    expect(repository.applications).toHaveLength(1)
    expect(repository.emailNotifications).toHaveLength(2)
    expect(repository.emailNotifications.every(({ state, attemptCount }) =>
      state === 'PENDING' && attemptCount === 0,
    )).toBe(true)
  })

  it('skips an Admin notification if the account is disabled before delivery', async () => {
    await serviceWith(new UnavailableEmailProvider()).submitInquiry(
      inquiryInput(),
      'disabled-before-delivery-client',
    )
    const activeAdmin = repository.adminUsers.get('11111111-1111-4111-8111-111111111111')
    if (!activeAdmin) throw new Error('Missing Admin fixture.')
    activeAdmin.isActive = false

    const provider = new MockEmailProvider()
    const result = await new EmailDispatcher(
      repository,
      provider,
      () => new Date(currentNow),
    ).dispatchPending()

    expect(result.sent).toBe(1)
    expect(result.skipped).toBe(1)
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]?.message.to).toBe('inquirer@example.invalid')
    expect(repository.emailNotifications.find(({ adminUserId }) => adminUserId)?.state).toBe('SKIPPED')
  })

  it('persists submissions when dispatch infrastructure throws unexpectedly', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service = new SubmissionService(
      repository,
      JWT_SECRET,
      () => new Date(currentNow),
      { dispatchPending: async () => { throw new Error('simulated') } },
    )

    await expect(service.submitInquiry(inquiryInput(), 'failure-client')).resolves.toBeUndefined()
    expect(repository.inquiries).toHaveLength(1)
    expect(repository.emailNotifications).toHaveLength(2)
    expect(errorSpy).toHaveBeenCalledWith(
      'Email dispatch failed after submission persistence.',
      { error: 'Error' },
    )
    errorSpy.mockRestore()
  })

  it('retries transient failures with the same idempotency key and bounds permanent failures', async () => {
    const firstAttemptKeys = new Set<string>()
    const provider = new MockEmailProvider(async (_message, key, callNumber) => {
      if (callNumber <= 2) {
        firstAttemptKeys.add(key)
        throw new EmailProviderError('TIMEOUT', true)
      }
      return { providerMessageId: `provider-${callNumber}` }
    })
    const service = serviceWith(provider)
    await service.submitApplication(applicationInput(), 'retry-client')

    expect(repository.emailNotifications.every(({ state, attemptCount }) =>
      state === 'PENDING' && attemptCount === 1,
    )).toBe(true)
    currentNow = new Date(currentNow.getTime() + 61_000)
    const result = await new EmailDispatcher(
      repository,
      provider,
      () => new Date(currentNow),
    ).dispatchPending()

    expect(result.sent).toBe(2)
    expect(provider.calls.slice(2).every(({ idempotencyKey }) => firstAttemptKeys.has(idempotencyKey))).toBe(true)
    expect(repository.emailNotifications.every(({ state }) => state === 'SENT')).toBe(true)

    const permanentRepository = new InMemorySubmissionRepository()
    permanentRepository.adminUsers.set('33333333-3333-4333-8333-333333333333', {
      email: 'admin@example.invalid', isActive: true,
    })
    const permanentProvider = new MockEmailProvider(async () => {
      throw new EmailProviderError('invalid_from_address', false)
    })
    const permanentService = new SubmissionService(
      permanentRepository,
      JWT_SECRET,
      () => new Date(currentNow),
      new EmailDispatcher(permanentRepository, permanentProvider, () => new Date(currentNow)),
    )
    await permanentService.submitInquiry(inquiryInput(), 'permanent-client')
    expect(permanentRepository.emailNotifications.every(({ state, attemptCount }) =>
      state === 'FAILED' && attemptCount === 1,
    )).toBe(true)
  })

  it('prevents concurrent workers from delivering the same notification twice', async () => {
    const provider = new MockEmailProvider(async (_message, _key, callNumber) => {
      await Promise.resolve()
      return { providerMessageId: `provider-${callNumber}` }
    })
    const unavailable = new UnavailableEmailProvider()
    await serviceWith(unavailable).submitInquiry(inquiryInput(), 'concurrency-client')

    const first = new EmailDispatcher(repository, provider, () => new Date(currentNow))
    const second = new EmailDispatcher(repository, provider, () => new Date(currentNow))
    const results = await Promise.all([first.dispatchPending(), second.dispatchPending()])

    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(2)
    expect(provider.calls).toHaveLength(2)
    expect(new Set(provider.calls.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2)
  })

  it('stops transient retries after four bounded attempts', async () => {
    const provider = new MockEmailProvider(async () => {
      throw new EmailProviderError('TIMEOUT', true)
    })
    const dispatcher = new EmailDispatcher(repository, provider, () => new Date(currentNow))
    const service = new SubmissionService(
      repository,
      JWT_SECRET,
      () => new Date(currentNow),
      dispatcher,
    )
    await service.submitInquiry(inquiryInput(), 'bounded-retry-client')

    for (const delay of [61_000, 5 * 60_000 + 1_000, 15 * 60_000 + 1_000]) {
      currentNow = new Date(currentNow.getTime() + delay)
      await dispatcher.dispatchPending()
    }

    expect(repository.emailNotifications.every(({ state, attemptCount }) =>
      state === 'FAILED' && attemptCount === 4,
    )).toBe(true)
    expect(provider.calls).toHaveLength(8)
  })

  it('fails the internal dispatch route closed and runs only with its cron secret', async () => {
    const cronSecret = `integration-cron-${'x'.repeat(32)}`
    const dispatchPending = vi.fn(async () => ({
      claimed: 2,
      sent: 2,
      retried: 0,
      failed: 0,
      skipped: 0,
      unavailable: false,
    }))
    const routes = createEmailDispatchRoutes(
      { dispatchPending },
      cronSecret,
    )

    const missing = await routes.request('/internal/cron/email-notifications')
    const invalid = await routes.request('/internal/cron/email-notifications', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(dispatchPending).not.toHaveBeenCalled()

    const authorized = await routes.request('/internal/cron/email-notifications', {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    })
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get('cache-control')).toBe('no-store')
    await expect(authorized.json()).resolves.toEqual({
      success: true,
      data: {
        claimed: 2,
        sent: 2,
        retried: 0,
        failed: 0,
        skipped: 0,
        unavailable: false,
      },
    })
    expect(dispatchPending).toHaveBeenCalledOnce()
    expect(dispatchPending).toHaveBeenCalledWith(25)
  })
})
