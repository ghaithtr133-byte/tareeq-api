export const ABOUT_US_ID = '00000000-0000-4000-8000-000000000010'

export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export const aboutUsFields = [
  'heroTitleAr', 'heroTitleEn', 'heroSubtitleAr', 'heroSubtitleEn',
  'heroImageUrl', 'heroImageAltAr', 'heroImageAltEn',
  'introTitleAr', 'introTitleEn', 'introBodyAr', 'introBodyEn',
  'introImageUrl', 'introImageAltAr', 'introImageAltEn',
  'missionTitleAr', 'missionTitleEn', 'missionBodyAr', 'missionBodyEn',
  'visionTitleAr', 'visionTitleEn', 'visionBodyAr', 'visionBodyEn',
  'ctaTitleAr', 'ctaTitleEn', 'ctaDescriptionAr', 'ctaDescriptionEn',
  'ctaButtonLabelAr', 'ctaButtonLabelEn', 'seoTitleAr', 'seoDescriptionAr',
] as const

export type AboutUsField = (typeof aboutUsFields)[number]

export type AboutUsRecord = Record<AboutUsField, string | null> & {
  id: string
  status: PublicationStatus
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type AboutUsUpdate = Partial<Record<AboutUsField, string | null>> & {
  status?: PublicationStatus
}

export interface AboutUsRepository {
  find(): Promise<AboutUsRecord | null>
  update(actorAdminId: string, input: AboutUsUpdate): Promise<AboutUsRecord | null>
}
