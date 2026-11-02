import type {
  AuditIntent,
  AuditListQuery,
  AuditRecord,
  AuditRepository,
} from '../../src/audit/types.js'

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditRecord[] = []
  readonly actors = new Map<string, string>()
  failNextWrite = false

  constructor(private readonly now: () => Date = () => new Date()) {}

  async append(audit: AuditIntent, resourceId: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('Simulated audit write failure.')
    }
    const record: AuditRecord = {
      ...audit,
      id: crypto.randomUUID(),
      resourceId,
      createdAt: this.now(),
      actor: {
        id: audit.actorAdminId,
        name: this.actors.get(audit.actorAdminId) ?? 'Test Administrator',
      },
    }
    this.events.push(record)
    return record
  }

  async list(query: AuditListQuery) {
    const from = query.from ? new Date(query.from).getTime() : undefined
    const to = query.to ? new Date(query.to).getTime() : undefined
    const filtered = this.events
      .filter((event) =>
        (!query.actorId || event.actorAdminId === query.actorId) &&
        (!query.action || event.action === query.action) &&
        (!query.resourceType || event.resourceType === query.resourceType) &&
        (from === undefined || event.createdAt.getTime() >= from) &&
        (to === undefined || event.createdAt.getTime() <= to),
      )
      .sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
      )
    const total = filtered.length
    const offset = (query.page - 1) * query.limit
    return { items: filtered.slice(offset, offset + query.limit), total }
  }
}
