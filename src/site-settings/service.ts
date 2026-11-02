import { ApiError } from '../shared/http.js'
import {
  siteSettingFields,
  type SiteSettingsRecord,
  type SiteSettingsRepository,
  type SiteSettingsUpdate,
} from './types.js'

const emptySettings = (): SiteSettingsRecord => ({
  academyNameAr: null,
  academyNameEn: null,
  contactEmail: null,
  contactPhone: null,
  addressAr: null,
  addressEn: null,
  facebookUrl: null,
  instagramUrl: null,
  linkedinUrl: null,
  youtubeUrl: null,
  updatedAt: null,
})

export class SiteSettingsService {
  constructor(private readonly repository: SiteSettingsRepository) {}

  async getPublic() {
    return await this.repository.find() ?? emptySettings()
  }

  async update(actorAdminId: string, input: SiteSettingsUpdate) {
    const settings = await this.repository.update(actorAdminId, input)
    if (!settings) {
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.')
    }
    return settings
  }
}

export { siteSettingFields }
