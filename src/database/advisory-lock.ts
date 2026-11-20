import { Prisma } from '../generated/prisma/client.js'

type AdvisoryLockTransaction = Pick<Prisma.TransactionClient, '$executeRaw'>

/**
 * Acquires a PostgreSQL transaction-scoped advisory lock without asking Prisma
 * to deserialize PostgreSQL's `void` return type.
 */
export const acquireTransactionAdvisoryLock = async (
  transaction: AdvisoryLockTransaction,
  lockId: number,
) => {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${lockId})`,
  )
}
