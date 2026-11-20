import type { EmailConfig } from '../config/env.js'
import { createEmailProvider } from '../email/provider.js'
import type { EmailProvider } from '../email/types.js'

export type PasswordRecoveryEmail = {
  to: string
  name: string
  otp: string
  challengeId: string
}

export interface PasswordRecoveryEmailSender {
  readonly available: boolean
  sendPasswordRecovery(email: PasswordRecoveryEmail): Promise<void>
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

class UnavailablePasswordRecoveryEmailSender implements PasswordRecoveryEmailSender {
  readonly available = false

  async sendPasswordRecovery(): Promise<void> {
    throw new Error('Password recovery email delivery is not configured.')
  }
}

class ProviderPasswordRecoveryEmailSender implements PasswordRecoveryEmailSender {
  get available() { return this.provider.available }

  constructor(private readonly provider: EmailProvider) {}

  async sendPasswordRecovery(email: PasswordRecoveryEmail) {
    const name = escapeHtml(email.name)
    const otp = escapeHtml(email.otp)
    await this.provider.send({
      to: email.to,
      subject: 'رمز استعادة كلمة المرور — أكاديمية طريق',
      html: `<!doctype html><html lang="ar" dir="rtl"><body><p>مرحباً ${name}،</p><p>استخدم رمز التحقق التالي لاستعادة كلمة مرور لوحة إدارة أكاديمية طريق:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${otp}</p><p>ينتهي الرمز خلال 10 دقائق. لا تشارك هذا الرمز مع أي شخص.</p><p>إذا لم تطلب الاستعادة، يمكنك تجاهل هذه الرسالة.</p></body></html>`,
      text: `مرحباً ${email.name}،\n\nرمز استعادة كلمة مرور لوحة إدارة أكاديمية طريق هو: ${email.otp}\n\nينتهي الرمز خلال 10 دقائق. لا تشاركه مع أي شخص. إذا لم تطلب الاستعادة، تجاهل هذه الرسالة.`,
    }, `password-recovery:${email.challengeId}`)
  }
}

export const createPasswordRecoveryEmailSender = (
  config: EmailConfig,
): PasswordRecoveryEmailSender => {
  if (config.status !== 'CONFIGURED') {
    return new UnavailablePasswordRecoveryEmailSender()
  }
  return new ProviderPasswordRecoveryEmailSender(createEmailProvider(config))
}
