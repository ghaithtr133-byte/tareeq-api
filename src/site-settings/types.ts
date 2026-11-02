export const SITE_SETTINGS_ID = '00000000-0000-4000-8000-000000000009'

export const siteSettingFields = [
  'academyNameAr',
  'academyNameEn',
  'contactEmail',
  'contactPhone',
  'addressAr',
  'addressEn',
  'facebookUrl',
  'instagramUrl',
  'linkedinUrl',
  'youtubeUrl',
] as const

export type SiteSettingField = (typeof siteSettingFields)[number]

export type SiteSettingsRecord = Record<SiteSettingField, string | null> & {
  updatedAt: Date | null
}

export type SiteSettingsUpdate = Partial<
  Record<SiteSettingField, string | null>
>

export interface SiteSettingsRepository {
  find(): Promise<SiteSettingsRecord | null>
  update(
    actorAdminId: string,
    input: SiteSettingsUpdate,
  ): Promise<SiteSettingsRecord | null>
}
