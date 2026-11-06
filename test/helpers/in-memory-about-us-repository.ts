import type { InMemoryAuditRepository } from './in-memory-audit-repository.js'
import type { InMemoryAuthRepository } from './in-memory-auth-repository.js'
import { ABOUT_US_ID, aboutUsFields, type AboutUsRecord, type AboutUsRepository, type AboutUsUpdate } from '../../src/about/types.js'

export class InMemoryAboutUsRepository implements AboutUsRepository {
  private record: AboutUsRecord | null = null
  private mutation = Promise.resolve()

  constructor(
    private readonly auth: InMemoryAuthRepository,
    private readonly audit: InMemoryAuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async find() {
    return this.record ? { ...this.record } : null
  }

  async update(actorAdminId: string, input: AboutUsUpdate) {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
    const actor = await this.auth.findAdminById(actorAdminId)
    if (!actor?.isActive || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) return null
    const current = this.record
    const nextStatus = input.status ?? current?.status ?? 'DRAFT'
    const now = this.now()
    const next = {
      ...Object.fromEntries(aboutUsFields.map((field) => [field, null])),
      ...current,
      ...input,
      id: ABOUT_US_ID,
      status: nextStatus,
      publishedAt: current?.publishedAt ?? (nextStatus === 'PUBLISHED' ? now : null),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    } as AboutUsRecord
    const statusChanged = current !== null && input.status !== undefined && input.status !== current.status
    await this.audit.append({
      actorAdminId,
      action: current === null ? 'about_us.created' : statusChanged ? 'about_us.status_changed' : 'about_us.updated',
      resourceType: 'ABOUT_US',
      metadata: {
        changedFields: Object.keys(input).sort(),
        ...(statusChanged ? { fromStatus: current.status, toStatus: input.status } : {}),
      },
    }, ABOUT_US_ID)
    this.record = next
    return { ...next }
    } finally {
      release()
    }
  }
}
