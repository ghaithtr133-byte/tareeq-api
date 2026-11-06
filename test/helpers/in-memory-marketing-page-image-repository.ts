import { marketingPageIds, type MarketingPageImageRecord, type MarketingPageImageRepository, type MarketingPageImageUpdate, type MarketingPageKey } from '../../src/marketing/types.js'

export class InMemoryMarketingPageImageRepository implements MarketingPageImageRepository {
  private readonly records = new Map<MarketingPageKey, MarketingPageImageRecord>()
  async find(pageKey: MarketingPageKey) { return this.records.get(pageKey) ?? null }
  async update(_actorAdminId: string, pageKey: MarketingPageKey, input: MarketingPageImageUpdate) {
    const current = this.records.get(pageKey) ?? { id: marketingPageIds[pageKey], pageKey, heroImageUrl: null, heroImageAltAr: null, ctaImageUrl: null, ctaImageAltAr: null, updatedAt: null }
    const record = { ...current, ...input, updatedAt: new Date('2026-11-05T10:00:00.000Z') }
    this.records.set(pageKey, record)
    return record
  }
}
