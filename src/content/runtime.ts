import { PrismaContentRepository } from './prisma-repository.js'
import { getProductionArticleSeoSuggestionService, type ArticleSeoSuggestionService } from './seo-suggestions.js'
import { ContentService } from './service.js'

export interface ContentRuntime {
  getService(): ContentService
  getSeoSuggestionService?(): ArticleSeoSuggestionService
}

let productionService: ContentService | undefined

export const productionContentRuntime: ContentRuntime = {
  getService: () => {
    productionService ??= new ContentService(new PrismaContentRepository())
    return productionService
  },
  getSeoSuggestionService: getProductionArticleSeoSuggestionService,
}
