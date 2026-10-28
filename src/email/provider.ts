import { Resend } from 'resend'

import type { EmailConfig } from '../config/env.js'
import {
  EmailProviderError,
  type EmailMessage,
  type EmailProvider,
} from './types.js'

const isTransientProviderError = (code: string, statusCode: number | null) =>
  statusCode === null ||
  statusCode === 408 ||
  statusCode === 429 ||
  statusCode >= 500 ||
  code === 'concurrent_idempotent_requests' ||
  code === 'rate_limit_exceeded' ||
  code === 'application_error' ||
  code === 'internal_server_error'

export class UnavailableEmailProvider implements EmailProvider {
  readonly available = false

  async send(): Promise<never> {
    throw new EmailProviderError('PROVIDER_NOT_CONFIGURED', false)
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly available = true
  private readonly resend: Resend

  constructor(private readonly config: EmailConfig) {
    if (config.status !== 'CONFIGURED' || !config.apiKey || !config.fromEmail) {
      throw new Error('ResendEmailProvider requires valid server-only configuration.')
    }
    this.resend = new Resend(config.apiKey)
  }

  async send(message: EmailMessage, idempotencyKey: string) {
    const response = await this.resend.emails.send({
      from: this.config.fromEmail!,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(this.config.replyToEmail ? { replyTo: this.config.replyToEmail } : {}),
    }, {
      idempotencyKey,
      signal: AbortSignal.timeout(4_000),
    })

    if (response.error) {
      throw new EmailProviderError(
        response.error.name,
        isTransientProviderError(response.error.name, response.error.statusCode),
      )
    }
    return { providerMessageId: response.data.id }
  }
}

export const createEmailProvider = (config: EmailConfig): EmailProvider =>
  config.status === 'CONFIGURED'
    ? new ResendEmailProvider(config)
    : new UnavailableEmailProvider()
