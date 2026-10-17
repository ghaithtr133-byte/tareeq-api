import type { AuthConfig } from '../config/env.js'
import { getAuthConfig } from '../config/env.js'
import { PrismaAuthRepository } from './prisma-repository.js'
import { AuthService } from './service.js'

export interface AuthRuntime {
  getConfig(): AuthConfig
  getService(): AuthService
}

let productionService: AuthService | undefined

export const productionAuthRuntime: AuthRuntime = {
  getConfig: getAuthConfig,
  getService: () => {
    if (!productionService) {
      const config = getAuthConfig()
      productionService = new AuthService(new PrismaAuthRepository(), config.jwtSecret)
    }
    return productionService
  },
}
