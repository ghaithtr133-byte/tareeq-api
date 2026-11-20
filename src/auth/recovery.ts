import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const PASSWORD_RECOVERY_OTP_TTL_MS = 10 * 60 * 1_000
export const PASSWORD_RECOVERY_AUTHORIZATION_TTL_MS = 10 * 60 * 1_000
export const PASSWORD_RECOVERY_RESEND_COOLDOWN_MS = 60 * 1_000
export const PASSWORD_RECOVERY_MAX_ATTEMPTS = 5
export const PASSWORD_RECOVERY_RATE_WINDOW_MS = 60 * 60 * 1_000
export const PASSWORD_RECOVERY_EMAIL_LIMIT = 3
export const PASSWORD_RECOVERY_IP_LIMIT = 10

export const createRecoveryOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0')

export const createRecoveryAuthorization = () => randomBytes(32).toString('base64url')

const hash = (secret: string, purpose: string, challengeId: string, value: string) =>
  createHmac('sha256', secret)
    .update(`tareeq-password-recovery:v1:${purpose}:${challengeId}:${value}`)
    .digest('hex')

export const hashRecoveryOtp = (secret: string, challengeId: string, otp: string) =>
  hash(secret, 'otp', challengeId, otp)

export const hashRecoveryAuthorization = (
  secret: string,
  challengeId: string,
  authorization: string,
) => hash(secret, 'authorization', challengeId, authorization)

export const hashRecoveryRateIdentifier = (
  secret: string,
  scope: string,
  identifier: string,
) => createHmac('sha256', secret)
  .update(`tareeq-password-recovery-rate-limit:v1:${scope}:${identifier}`)
  .digest('hex')

export const safelyEqualsHash = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
