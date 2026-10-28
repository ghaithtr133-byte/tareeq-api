import { getAuthConfig } from '../config/env.js'
import { getProductionEmailDispatcher } from '../email/runtime.js'
import { PrismaSubmissionRepository } from './prisma-repository.js'
import { SubmissionService } from './service.js'

export interface SubmissionRuntime {
  getService(): SubmissionService
}

let productionService: SubmissionService | undefined

export const productionSubmissionRuntime: SubmissionRuntime = {
  getService: () => {
    if (!productionService) {
      productionService = new SubmissionService(
        new PrismaSubmissionRepository(),
        getAuthConfig().jwtSecret,
        undefined,
        getProductionEmailDispatcher(),
      )
    }
    return productionService
  },
}
