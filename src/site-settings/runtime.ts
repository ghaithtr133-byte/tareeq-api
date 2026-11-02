import { PrismaSiteSettingsRepository } from './prisma-repository.js'
import { SiteSettingsService } from './service.js'

export interface SiteSettingsRuntime {
  getService(): SiteSettingsService
}

let productionService: SiteSettingsService | undefined

export const productionSiteSettingsRuntime: SiteSettingsRuntime = {
  getService: () => {
    productionService ??= new SiteSettingsService(
      new PrismaSiteSettingsRepository(),
    )
    return productionService
  },
}
