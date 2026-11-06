import { ApiError } from '../shared/http.js'
import type { MarketingPageImageRecord, MarketingPageImageRepository, MarketingPageImageUpdate, MarketingPageKey } from './types.js'

const empty = (pageKey: MarketingPageKey): MarketingPageImageRecord => ({ id: '', pageKey, heroImageUrl: null, heroImageAltAr: null, ctaImageUrl: null, ctaImageAltAr: null, updatedAt: null })
export class MarketingPageImageService {
  constructor(private readonly repository: MarketingPageImageRepository) {}
  async get(pageKey: MarketingPageKey) { return await this.repository.find(pageKey) ?? empty(pageKey) }
  async update(actorAdminId: string, pageKey: MarketingPageKey, input: MarketingPageImageUpdate) {
    const record = await this.repository.update(actorAdminId, pageKey, input)
    if (!record) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.')
    return record
  }
}
