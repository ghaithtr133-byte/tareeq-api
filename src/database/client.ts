import { PrismaPg } from '@prisma/adapter-pg'

import { getAuthConfig } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'

let prismaClient: PrismaClient | undefined

export const getPrisma = () => {
  if (!prismaClient) {
    const adapter = new PrismaPg({ connectionString: getAuthConfig().databaseUrl })
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
