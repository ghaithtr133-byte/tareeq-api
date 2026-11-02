import { PrismaAdminManagementRepository } from './prisma-repository.js'
import { AdminManagementService } from './service.js'

export interface AdminManagementRuntime {
  getService(): AdminManagementService
}

let productionService: AdminManagementService | undefined

export const productionAdminManagementRuntime: AdminManagementRuntime = {
  getService: () => {
    productionService ??= new AdminManagementService(
      new PrismaAdminManagementRepository(),
    )
    return productionService
  },
}
