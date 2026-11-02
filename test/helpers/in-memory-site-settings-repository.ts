import type { InMemoryAuthRepository } from './in-memory-auth-repository.js'
import type { InMemoryAuditRepository } from './in-memory-audit-repository.js'
import {
  SITE_SETTINGS_ID,
  siteSettingFields,
  type SiteSettingsRecord,
  type SiteSettingsRepository,
  type SiteSettingsUpdate,
} from '../../src/site-settings/types.js'

export class InMemorySiteSettingsRepository implements SiteSettingsRepository {
  private settings: SiteSettingsRecord | null = null

  constructor(
    private readonly auth: InMemoryAuthRepository,
    private readonly audit: InMemoryAuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async find() {
    return this.settings ? { ...this.settings } : null
  }

  async update(actorAdminId: string, input: SiteSettingsUpdate) {
    const actor = await this.auth.findAdminById(actorAdminId)
    if (!actor?.isActive || actor.role !== 'SUPER_ADMIN') return null

    const next = {
      ...Object.fromEntries(siteSettingFields.map((field) => [field, null])),
      ...this.settings,
      ...input,
      updatedAt: this.now(),
    } as SiteSettingsRecord
    await this.audit.append({
      actorAdminId,
      action: 'site_settings.updated',
      resourceType: 'SITE_SETTINGS',
      metadata: { changedFields: Object.keys(input).sort() },
    }, SITE_SETTINGS_ID)
    this.settings = next
    return { ...next }
  }
}
