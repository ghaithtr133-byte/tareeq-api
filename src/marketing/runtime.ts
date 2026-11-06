import { PrismaMarketingPageImageRepository } from './prisma-repository.js'
import { MarketingPageImageService } from './service.js'
export interface MarketingPageImageRuntime { getService(): MarketingPageImageService }
let service: MarketingPageImageService | undefined
export const productionMarketingPageImageRuntime: MarketingPageImageRuntime = { getService: () => (service ??= new MarketingPageImageService(new PrismaMarketingPageImageRepository())) }
