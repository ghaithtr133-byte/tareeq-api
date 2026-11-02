import { PrismaFaqRepository } from './prisma-repository.js'
import { FaqService } from './service.js'

export interface FaqRuntime { getService(): FaqService }

let productionService: FaqService | undefined
export const productionFaqRuntime: FaqRuntime = {
  getService: () => {
    productionService ??= new FaqService(new PrismaFaqRepository())
    return productionService
  },
}
