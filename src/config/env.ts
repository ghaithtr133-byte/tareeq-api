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
