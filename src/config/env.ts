import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
})

export const env = envSchema.parse(process.env)
