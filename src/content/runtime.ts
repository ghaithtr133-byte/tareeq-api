import { PrismaContentRepository } from './prisma-repository.js'
import { ContentService } from './service.js'

export interface ContentRuntime {
  getService(): ContentService
}

let productionService: ContentService | undefined

export const productionContentRuntime: ContentRuntime = {
  getService: () => {
    productionService ??= new ContentService(new PrismaContentRepository())
    return productionService
  },
}
