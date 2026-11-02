import { getCloudinaryConfig } from '../config/env.js'
import { createImageProvider } from './provider.js'
import { MediaService } from './service.js'

export interface MediaRuntime {
  getService(): MediaService
}

let productionService: MediaService | undefined

export const productionMediaRuntime: MediaRuntime = {
  getService: () => {
    if (!productionService) {
      const config = getCloudinaryConfig()
      productionService = new MediaService(
        createImageProvider(config),
        config.folder,
      )
    }
    return productionService
  },
}
