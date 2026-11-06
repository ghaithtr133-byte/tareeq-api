export const marketingPageKeys = ['HOME', 'DESTINATIONS'] as const
export type MarketingPageKey = (typeof marketingPageKeys)[number]

export const marketingPageIds: Record<MarketingPageKey, string> = {
  HOME: '00000000-0000-4000-8000-000000000011',
  DESTINATIONS: '00000000-0000-4000-8000-000000000012',
}

export type MarketingPageImageRecord = {
  id: string
  pageKey: MarketingPageKey
  heroImageUrl: string | null
  heroImageAltAr: string | null
  ctaImageUrl: string | null
  ctaImageAltAr: string | null
  updatedAt: Date | null
}
export type MarketingPageImageUpdate = Partial<Pick<MarketingPageImageRecord, 'heroImageUrl' | 'heroImageAltAr' | 'ctaImageUrl' | 'ctaImageAltAr'>>

export interface MarketingPageImageRepository {
  find(pageKey: MarketingPageKey): Promise<MarketingPageImageRecord | null>
  update(actorAdminId: string, pageKey: MarketingPageKey, input: MarketingPageImageUpdate): Promise<MarketingPageImageRecord | null>
}
