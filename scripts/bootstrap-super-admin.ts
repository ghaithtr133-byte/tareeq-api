import { z } from 'zod'

import { hashPassword } from '../src/auth/crypto.js'
import {
  normalizedEmailSchema,
  strongPasswordSchema,
} from '../src/auth/schemas.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { AdminRole } from '../src/generated/prisma/enums.js'

const bootstrapSchema = z.object({
  BOOTSTRAP_SUPER_ADMIN_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: normalizedEmailSchema,
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: strongPasswordSchema,
})

const bootstrap = async () => {
  const input = bootstrapSchema.parse(process.env)
  const prisma = getPrisma()

  if ((await prisma.adminUser.count()) > 0) {
    throw new Error('Bootstrap refused because an administrator already exists.')
  }

  if (await prisma.adminUser.findUnique({ where: { email: input.BOOTSTRAP_SUPER_ADMIN_EMAIL } })) {
    throw new Error('Bootstrap refused because the administrator email already exists.')
  }

  await prisma.adminUser.create({
    data: {
      name: input.BOOTSTRAP_SUPER_ADMIN_NAME,
      email: input.BOOTSTRAP_SUPER_ADMIN_EMAIL,
      passwordHash: await hashPassword(input.BOOTSTRAP_SUPER_ADMIN_PASSWORD),
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  })

  console.log('Initial SUPER_ADMIN created successfully.')
}

try {
  await bootstrap()
} catch (error) {
  const safeMessage =
    error instanceof Error && error.message.startsWith('Bootstrap refused')
      ? error.message
      : 'Bootstrap failed. Verify the environment and isolated development database state.'
  console.error(safeMessage)
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
