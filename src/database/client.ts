import { PrismaPg } from '@prisma/adapter-pg'

import { getAuthConfig } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'
import { getDisposableTestDatabaseTarget, isTestDatabaseMode } from './test-safety.js'

let prismaClient: PrismaClient | undefined

export const getPrisma = () => {
  if (!prismaClient) {
    const connectionString = isTestDatabaseMode()
      ? getDisposableTestDatabaseTarget().url
      : getAuthConfig().databaseUrl
    const adapter = new PrismaPg({ connectionString })
    prismaClient = new PrismaClient({ adapter })
  }

  return prismaClient
}

export const disconnectPrisma = async () => {
  if (prismaClient) {
    await prismaClient.$disconnect()
    prismaClient = undefined
  }
}
