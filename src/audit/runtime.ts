import { PrismaAuditRepository } from './prisma-repository.js'
import { AuditService } from './service.js'

export interface AuditRuntime {
  getService(): AuditService
}

let productionService: AuditService | undefined

export const productionAuditRuntime: AuditRuntime = {
  getService: () => {
    productionService ??= new AuditService(new PrismaAuditRepository())
    return productionService
  },
}
