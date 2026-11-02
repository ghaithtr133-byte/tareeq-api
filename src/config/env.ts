import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
})

export const env = envSchema.parse(process.env)

const authEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  AUTH_ALLOWED_ORIGINS: z
    .string()
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.url()).min(1))
    .refine(
      (origins) => origins.every((origin) => new URL(origin).origin === origin),
      'Origins must not include paths, query strings, or fragments.',
    ),
  PUBLIC_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.url()))
    .refine(
      (origins) => origins.every((origin) => new URL(origin).origin === origin),
      'Origins must not include paths, query strings, or fragments.',
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type AuthConfig = {
  databaseUrl: string
  jwtSecret: string
  allowedOrigins: string[]
  publicAllowedOrigins: string[]
  isProduction: boolean
}

export type EmailConfig = {
  status: 'CONFIGURED' | 'MISSING' | 'INVALID'
  apiKey?: string
  fromEmail?: string
  replyToEmail?: string
}

export type CloudinaryConfig = {
  status: 'CONFIGURED' | 'MISSING' | 'INVALID'
  folder: string
  cloudName?: string
  apiKey?: string
  apiSecret?: string
}

let cachedAuthConfig: AuthConfig | undefined

export const getAuthConfig = (): AuthConfig => {
  if (cachedAuthConfig) {
    return cachedAuthConfig
  }

  const parsed = authEnvSchema.parse(process.env)
  cachedAuthConfig = {
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    allowedOrigins: parsed.AUTH_ALLOWED_ORIGINS,
    publicAllowedOrigins: parsed.PUBLIC_ALLOWED_ORIGINS,
    isProduction: parsed.NODE_ENV === 'production',
  }

  return cachedAuthConfig
}

const optionalNonEmptyString = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
)

const optionalEmail = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.email().optional(),
)

const emailEnvSchema = z.object({
  RESEND_API_KEY: optionalNonEmptyString,
  RESEND_FROM_EMAIL: optionalEmail,
  RESEND_REPLY_TO_EMAIL: optionalEmail,
})

let cachedEmailConfig: EmailConfig | undefined

export const getEmailConfig = (): EmailConfig => {
  if (cachedEmailConfig) return cachedEmailConfig

  const parsed = emailEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    cachedEmailConfig = { status: 'INVALID' }
    return cachedEmailConfig
  }

  const { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_REPLY_TO_EMAIL } = parsed.data
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    cachedEmailConfig = { status: 'MISSING' }
    return cachedEmailConfig
  }

  const configured: EmailConfig = {
    status: 'CONFIGURED',
    apiKey: RESEND_API_KEY,
    fromEmail: RESEND_FROM_EMAIL,
    ...(RESEND_REPLY_TO_EMAIL ? { replyToEmail: RESEND_REPLY_TO_EMAIL } : {}),
  }
  cachedEmailConfig = configured
  return configured
}

const cloudinaryFolder = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)v\d+(?:\/|$))[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/,
    'Cloudinary folder must contain safe path segments.',
  )

const cloudinaryEnvSchema = z.object({
  CLOUDINARY_CLOUD_NAME: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),
  ),
  CLOUDINARY_API_KEY: optionalNonEmptyString,
  CLOUDINARY_API_SECRET: optionalNonEmptyString,
  CLOUDINARY_FOLDER: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    cloudinaryFolder.default('tareeq-academy'),
  ),
})

let cachedCloudinaryConfig: CloudinaryConfig | undefined

export const getCloudinaryConfig = (): CloudinaryConfig => {
  if (cachedCloudinaryConfig) return cachedCloudinaryConfig

  const parsed = cloudinaryEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    cachedCloudinaryConfig = { status: 'INVALID', folder: 'tareeq-academy' }
    return cachedCloudinaryConfig
  }

  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER,
  } = parsed.data
  const credentials = [
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
  ]
  if (credentials.every((value) => value === undefined)) {
    cachedCloudinaryConfig = {
      status: 'MISSING',
      folder: CLOUDINARY_FOLDER,
    }
    return cachedCloudinaryConfig
  }
  if (credentials.some((value) => value === undefined)) {
    cachedCloudinaryConfig = {
      status: 'INVALID',
      folder: CLOUDINARY_FOLDER,
    }
    return cachedCloudinaryConfig
  }

  cachedCloudinaryConfig = {
    status: 'CONFIGURED',
    folder: CLOUDINARY_FOLDER,
    cloudName: CLOUDINARY_CLOUD_NAME!,
    apiKey: CLOUDINARY_API_KEY!,
    apiSecret: CLOUDINARY_API_SECRET!,
  }
  return cachedCloudinaryConfig
}

const cronSecretSchema = z.string().min(32)

export const getCronSecret = () => {
  const parsed = cronSecretSchema.safeParse(process.env.CRON_SECRET)
  return parsed.success ? parsed.data : undefined
}
