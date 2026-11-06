import { PrismaStatisticsRepository } from './prisma-repository.js'
import { StatisticsService } from './service.js'
export interface StatisticsRuntime { getService(): StatisticsService }
let service: StatisticsService | undefined
export const productionStatisticsRuntime: StatisticsRuntime = { getService: () => (service ??= new StatisticsService(new PrismaStatisticsRepository())) }
