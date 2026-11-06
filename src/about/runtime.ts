import { PrismaAboutUsRepository } from './prisma-repository.js'
import { AboutUsService } from './service.js'

export interface AboutUsRuntime {
  getService(): AboutUsService
}

let productionService: AboutUsService | undefined

export const productionAboutUsRuntime: AboutUsRuntime = {
  getService: () => {
    productionService ??= new AboutUsService(new PrismaAboutUsRepository())
    return productionService
  },
}
