import type { PublicationStatus } from '../../src/content/types.js'
import type {
  FaqCreateInput,
  FaqListQuery,
  FaqParent,
  FaqRecord,
  FaqRepository,
  FaqScope,
  FaqUpdateInput,
} from '../../src/faqs/types.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'

type ParentFixture = {
  id: string
  scope: Exclude<FaqScope, 'GLOBAL'>
  slug: string
  status: PublicationStatus
}

const parentKey = (parent: FaqParent) => `${parent.scope}:${parent.parentId ?? 'GLOBAL'}`

export class InMemoryFaqRepository implements FaqRepository {
  readonly records: FaqRecord[] = []
  private readonly parents = new Map<string, ParentFixture>()

  constructor(
    readonly audit = new InMemoryAuditRepository(),
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  addParent(parent: ParentFixture) {
    this.parents.set(parent.id, { ...parent })
  }

  setParentStatus(id: string, status: PublicationStatus) {
    const parent = this.parents.get(id)
    if (parent) parent.status = status
  }

  async resolvePublishedParent(scope: Exclude<FaqScope, 'GLOBAL'>, slug: string) {
    return [...this.parents.values()].find(
      (parent) => parent.scope === scope && parent.slug === slug && parent.status === 'PUBLISHED',
    )?.id ?? null
  }

  async parentExists(parent: FaqParent) {
    if (parent.scope === 'GLOBAL') return parent.parentId === null
    const fixture = parent.parentId ? this.parents.get(parent.parentId) : undefined
    return fixture?.scope === parent.scope
  }

  async list(query: FaqListQuery, publicOnly: boolean) {
    const publishedParent = query.scope === 'GLOBAL' || (
      query.parentId !== null && this.parents.get(query.parentId)?.status === 'PUBLISHED'
    )
    const matching = this.records
      .filter((record) =>
        parentKey(record) === parentKey(query) &&
        (!query.status || record.status === query.status) &&
        (!publicOnly || (publishedParent && record.status === 'PUBLISHED')),
      )
      .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))
    const total = matching.length
    const offset = (query.page - 1) * query.limit
    return { items: matching.slice(offset, offset + query.limit).map((record) => ({ ...record })), total }
  }

  async create(input: FaqCreateInput, actorAdminId: string, now: Date) {
    if (!await this.parentExists(input)) return { outcome: 'PARENT_NOT_FOUND' as const }
    if ((input.questionEn == null) !== (input.answerEn == null)) return { outcome: 'INVALID_TRANSLATION' as const }
    const maxOrder = this.records
      .filter((record) => parentKey(record) === parentKey(input))
      .reduce((maximum, record) => Math.max(maximum, record.displayOrder), -1)
    const record: FaqRecord = {
      ...input,
      id: this.idFactory(),
      questionEn: input.questionEn ?? null,
      answerEn: input.answerEn ?? null,
      displayOrder: maxOrder + 1,
      publishedAt: input.status === 'PUBLISHED' ? now : null,
      createdAt: now,
      updatedAt: now,
    }
    await this.audit.append({
      actorAdminId,
      action: 'faq.created',
      resourceType: 'FAQ_ENTRY',
      metadata: { scope: record.scope, parentId: record.parentId, status: record.status },
    }, record.id)
    this.records.push(record)
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async update(id: string, input: FaqUpdateInput, actorAdminId: string, now: Date) {
    const index = this.records.findIndex((record) => record.id === id)
    const current = this.records[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    const questionEn = input.questionEn === undefined ? current.questionEn : input.questionEn
    const answerEn = input.answerEn === undefined ? current.answerEn : input.answerEn
    if ((questionEn == null) !== (answerEn == null)) return { outcome: 'INVALID_TRANSLATION' as const }
    const status = input.status ?? current.status
    const target = input.scope === undefined ? { scope: current.scope, parentId: current.parentId } : { scope: input.scope, parentId: input.parentId ?? null }
    if (!await this.parentExists(target)) return { outcome: 'PARENT_NOT_FOUND' as const }
    const updated: FaqRecord = {
      ...current,
      ...input,
      scope: target.scope,
      parentId: target.parentId,
      questionEn,
      answerEn,
      publishedAt: status === 'PUBLISHED' && current.publishedAt === null ? now : current.publishedAt,
      updatedAt: now,
    }
    const changedFields = Object.keys(input).filter(
      (field) => current[field as keyof FaqRecord] !== updated[field as keyof FaqRecord],
    )
    const action = status === 'ARCHIVED' && current.status !== 'ARCHIVED'
      ? 'faq.archived'
      : status === 'PUBLISHED' && current.status !== 'PUBLISHED'
        ? 'faq.published'
        : status !== 'PUBLISHED' && current.status === 'PUBLISHED'
          ? 'faq.unpublished'
          : 'faq.updated'
    await this.audit.append({
      actorAdminId,
      action,
      resourceType: 'FAQ_ENTRY',
      metadata: {
        scope: current.scope,
        parentId: current.parentId,
        changedFields,
        ...(current.status !== status ? { fromStatus: current.status, toStatus: status } : {}),
      },
    }, id)
    this.records[index] = updated
    return { outcome: 'UPDATED' as const, record: { ...updated } }
  }

  async delete(id: string, actorAdminId: string) {
    const index = this.records.findIndex((record) => record.id === id)
    const current = this.records[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    if (current.status === 'PUBLISHED') return { outcome: 'PUBLISHED' as const }
    this.records.splice(index, 1)
    await this.audit.append({ actorAdminId, action: 'faq.deleted', resourceType: 'FAQ_ENTRY', metadata: { scope: current.scope, parentId: current.parentId } }, id)
    return { outcome: 'DELETED' as const }
  }

  async reorder(parent: FaqParent, orderedIds: string[], actorAdminId: string) {
    if (!await this.parentExists(parent)) return { outcome: 'PARENT_NOT_FOUND' as const }
    const active = this.records
      .filter((record) => parentKey(record) === parentKey(parent) && record.status !== 'ARCHIVED')
    const expected = active.map((record) => record.id).sort()
    const supplied = [...orderedIds].sort()
    if (expected.length !== supplied.length || expected.some((id, index) => id !== supplied[index])) {
      return { outcome: 'ORDER_SET_MISMATCH' as const }
    }
    const changed = orderedIds.flatMap((id, displayOrder) => {
      const record = active.find((candidate) => candidate.id === id)
      return record && record.displayOrder !== displayOrder ? [{ record, displayOrder }] : []
    })
    const auditStart = this.audit.events.length
    try {
      for (const item of changed) {
        await this.audit.append({
          actorAdminId,
          action: 'faq.reordered',
          resourceType: 'FAQ_ENTRY',
          metadata: {
            scope: parent.scope,
            parentId: parent.parentId,
            fromDisplayOrder: item.record.displayOrder,
            toDisplayOrder: item.displayOrder,
          },
        }, item.record.id)
      }
    } catch (error) {
      this.audit.events.splice(auditStart)
      throw error
    }
    for (const item of changed) item.record.displayOrder = item.displayOrder
    const records = orderedIds.map((id) => ({ ...active.find((record) => record.id === id)! }))
    return { outcome: 'UPDATED' as const, records }
  }
}
