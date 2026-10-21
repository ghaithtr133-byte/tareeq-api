import { z } from 'zod'

import { normalizedEmailSchema } from '../src/auth/schemas.js'

export const initialAccountPasswordSchema = z
  .string()
  .min(9, 'Initial account password must contain at least 9 characters.')
  .max(128, 'Initial account password must contain at most 128 characters.')
  .regex(
    /[a-z]/,
    'Initial account password must contain a lowercase English letter.',
  )
  .regex(
    /[A-Z]/,
    'Initial account password must contain an uppercase English letter.',
  )

export const initialAccountsSchema = z
  .object({
    INITIAL_ADMIN_NAME: z.string().trim().min(1).max(120),
    INITIAL_ADMIN_EMAIL: normalizedEmailSchema,
    INITIAL_ADMIN_PASSWORD: initialAccountPasswordSchema,
    INITIAL_SUPER_ADMIN_NAME: z.string().trim().min(1).max(120),
    INITIAL_SUPER_ADMIN_EMAIL: normalizedEmailSchema,
    INITIAL_SUPER_ADMIN_PASSWORD: initialAccountPasswordSchema,
  })
  .refine(
    (value) =>
      value.INITIAL_ADMIN_EMAIL !== value.INITIAL_SUPER_ADMIN_EMAIL,
    { message: 'The ADMIN and SUPER_ADMIN emails must be different.' },
  )
