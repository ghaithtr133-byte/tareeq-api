import { PrismaUniversityDetailsRepository } from './prisma-repository.js'
import { UniversityDetailsService } from './service.js'

export interface UniversityDetailsRuntime { getService(): UniversityDetailsService }

let service: UniversityDetailsService | undefined
export const productionUniversityDetailsRuntime: UniversityDetailsRuntime = {
  getService: () => {
    service ??= new UniversityDetailsService(new PrismaUniversityDetailsRepository())
    return service
  },
}
