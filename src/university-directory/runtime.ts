import { PrismaUniversityDirectoryRepository } from './prisma-repository.js'
import { UniversityDirectoryService } from './service.js'

export interface UniversityDirectoryRuntime { getService(): UniversityDirectoryService }

let productionService: UniversityDirectoryService | undefined
export const productionUniversityDirectoryRuntime: UniversityDirectoryRuntime = {
  getService: () => {
    productionService ??= new UniversityDirectoryService(new PrismaUniversityDirectoryRepository())
    return productionService
  },
}
