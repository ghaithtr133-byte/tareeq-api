import { getAuthConfig } from '../config/env.js'
import { PrismaAnalyticsRepository } from './prisma-repository.js'
import { AnalyticsService } from './service.js'

export interface AnalyticsRuntime {
  getService(): AnalyticsService
}

let productionService: AnalyticsService | undefined

export const productionAnalyticsRuntime: AnalyticsRuntime = {
  getService: () => {
    productionService ??= new AnalyticsService(
      new PrismaAnalyticsRepository(),
      getAuthConfig().jwtSecret,
    )
    return productionService
  },
}
