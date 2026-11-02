import { getPrisma } from '../database/client.js'
import type { FaqEntry, Prisma } from '../generated/prisma/client.js'
import type { PublicationStatus } from '../content/types.js'
import type {
  FaqCreateInput,
  FaqListQuery,
  FaqParent,
  FaqRecord,
  FaqRepository,
  FaqScope,
  FaqUpdateInput,
} from './types.js'

const FAQ_MUTATION_LOCK = 9_000_010

const parentIdFor = (record: Pick<FaqEntry, 'scope' | 'countryId' | 'universityId' | 'serviceId' | 'scholarshipId'>) => ({
  GLOBAL: null,
  COUNTRY: record.countryId,
  UNIVERSITY: record.universityId,
  SERVICE: record.serviceId,
  SCHOLARSHIP: record.scholarshipId,
})[record.scope]

const asRecord = (record: FaqEntry): FaqRecord => ({
  id: record.id,
  scope: record.scope as FaqScope,
  parentId: parentIdFor(record),
  questionAr: record.questionAr,
  answerAr: record.answerAr,
  questionEn: record.questionEn,
  answerEn: record.answerEn,
  status: record.status as PublicationStatus,
  displayOrder: record.displayOrder,
  publishedAt: record.publishedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const parentWhere = (parent: FaqParent): Prisma.FaqEntryWhereInput => ({
  scope: parent.scope,
  ...({
    GLOBAL: { countryId: null, universityId: null, serviceId: null, scholarshipId: null },
    COUNTRY: { countryId: parent.parentId },
    UNIVERSITY: { universityId: parent.parentId },
    SERVICE: { serviceId: parent.parentId },
    SCHOLARSHIP: { scholarshipId: parent.parentId },
  })[parent.scope],
})

const parentData = (parent: FaqParent) => ({
  ...(parent.scope === 'COUNTRY' ? { countryId: parent.parentId } : {}),
  ...(parent.scope === 'UNIVERSITY' ? { universityId: parent.parentId } : {}),
  ...(parent.scope === 'SERVICE' ? { serviceId: parent.parentId } : {}),
  ...(parent.scope === 'SCHOLARSHIP' ? { scholarshipId: parent.parentId } : {}),
})

const publishedParentWhere = (parent: FaqParent): Prisma.FaqEntryWhereInput => ({
  ...({
    GLOBAL: {},
    COUNTRY: { country: { status: 'PUBLISHED' as const } },
    UNIVERSITY: { university: { status: 'PUBLISHED' as const } },
    SERVICE: { service: { status: 'PUBLISHED' as const } },
    SCHOLARSHIP: { scholarship: { status: 'PUBLISHED' as const } },
  })[parent.scope],
})

const auditMetadata = (parent: FaqParent, metadata: Record<string, unknown>) => ({
  scope: parent.scope,
  parentId: parent.parentId,
  ...metadata,
}) as Prisma.InputJsonValue

export class PrismaFaqRepository implements FaqRepository {
  async resolvePublishedParent(scope: Exclude<FaqScope, 'GLOBAL'>, slug: string) {
    const prisma = getPrisma()
    const record = await ({
      COUNTRY: () => prisma.country.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }),
      UNIVERSITY: () => prisma.university.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }),
      SERVICE: () => prisma.service.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }),
      SCHOLARSHIP: () => prisma.scholarship.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }),
    })[scope]()
    return record?.id ?? null
  }

  async parentExists(parent: FaqParent) {
    if (parent.scope === 'GLOBAL') return parent.parentId === null
    if (!parent.parentId) return false
    const parentId = parent.parentId
    const prisma = getPrisma()
    const count = await ({
      COUNTRY: () => prisma.country.count({ where: { id: parentId } }),
      UNIVERSITY: () => prisma.university.count({ where: { id: parentId } }),
      SERVICE: () => prisma.service.count({ where: { id: parentId } }),
      SCHOLARSHIP: () => prisma.scholarship.count({ where: { id: parentId } }),
    })[parent.scope]()
    return count === 1
  }

  async list(query: FaqListQuery, publicOnly: boolean) {
    const where: Prisma.FaqEntryWhereInput = {
      ...parentWhere(query),
      ...(publicOnly ? publishedParentWhere(query) : {}),
      ...(publicOnly ? { status: 'PUBLISHED' as const } : query.status ? { status: query.status } : {}),
    }
    const prisma = getPrisma()
    const [items, total] = await Promise.all([
      prisma.faqEntry.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.faqEntry.count({ where }),
    ])
    return { items: items.map(asRecord), total }
  }

  async create(input: FaqCreateInput, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${FAQ_MUTATION_LOCK})`
      const maximum = await transaction.faqEntry.aggregate({
        where: parentWhere(input),
        _max: { displayOrder: true },
      })
      const record = await transaction.faqEntry.create({ data: {
        scope: input.scope,
        ...parentData(input),
        questionAr: input.questionAr,
        answerAr: input.answerAr,
        questionEn: input.questionEn ?? null,
        answerEn: input.answerEn ?? null,
        status: input.status,
        displayOrder: (maximum._max.displayOrder ?? -1) + 1,
        ...(input.status === 'PUBLISHED' ? { publishedAt: now } : {}),
      } })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId,
        action: 'faq.created',
        resourceType: 'FAQ_ENTRY',
        resourceId: record.id,
        metadata: auditMetadata(input, { status: record.status }),
      } })
      return { outcome: 'UPDATED' as const, record: asRecord(record) }
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async update(id: string, input: FaqUpdateInput, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${FAQ_MUTATION_LOCK})`
      const current = await transaction.faqEntry.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      const questionEn = input.questionEn === undefined ? current.questionEn : input.questionEn
      const answerEn = input.answerEn === undefined ? current.answerEn : input.answerEn
      if ((questionEn === null) !== (answerEn === null)) return { outcome: 'INVALID_TRANSLATION' as const }

      const nextStatus = input.status ?? current.status
      const record = await transaction.faqEntry.update({
        where: { id },
        data: {
          ...input,
          ...(nextStatus === 'PUBLISHED' && current.publishedAt === null ? { publishedAt: now } : {}),
        },
      })
      const changedFields = Object.keys(input).filter((field) =>
        input[field as keyof FaqUpdateInput] !== current[field as keyof FaqEntry],
      ).sort()
      const action = nextStatus === 'ARCHIVED' && current.status !== 'ARCHIVED'
        ? 'faq.archived'
        : nextStatus === 'PUBLISHED' && current.status !== 'PUBLISHED'
          ? 'faq.published'
          : current.status === 'PUBLISHED' && nextStatus !== 'PUBLISHED'
            ? 'faq.unpublished'
            : 'faq.updated'
      const parent = { scope: current.scope as FaqScope, parentId: parentIdFor(current) }
      await transaction.adminAuditLog.create({ data: {
        actorAdminId,
        action,
        resourceType: 'FAQ_ENTRY',
        resourceId: id,
        metadata: auditMetadata(parent, {
          changedFields,
          ...(current.status !== nextStatus ? { fromStatus: current.status, toStatus: nextStatus } : {}),
        }),
      } })
      return { outcome: 'UPDATED' as const, record: asRecord(record) }
    }, { maxWait: 15_000, timeout: 15_000 })
  }

  async reorder(parent: FaqParent, orderedIds: string[], actorAdminId: string) {
    if (!await this.parentExists(parent)) return { outcome: 'PARENT_NOT_FOUND' as const }
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${FAQ_MUTATION_LOCK})`
      const current = await transaction.faqEntry.findMany({
        where: { ...parentWhere(parent), status: { not: 'ARCHIVED' } },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      })
      const actualIds = current.map(({ id }) => id).sort()
      const requestedIds = [...orderedIds].sort()
      if (actualIds.length !== requestedIds.length || actualIds.some((id, index) => id !== requestedIds[index])) {
        return { outcome: 'ORDER_SET_MISMATCH' as const }
      }
      const byId = new Map(current.map((record) => [record.id, record]))
      const changes = orderedIds.flatMap((id, displayOrder) => {
        const record = byId.get(id)!
        return record.displayOrder === displayOrder ? [] : [{ record, displayOrder }]
      })
      for (const change of changes) {
        await transaction.faqEntry.update({ where: { id: change.record.id }, data: { displayOrder: change.displayOrder } })
      }
      if (changes.length > 0) {
        await transaction.adminAuditLog.createMany({ data: changes.map(({ record, displayOrder }) => ({
          actorAdminId,
          action: 'faq.reordered',
          resourceType: 'FAQ_ENTRY' as const,
          resourceId: record.id,
          metadata: auditMetadata(parent, { fromDisplayOrder: record.displayOrder, toDisplayOrder: displayOrder }),
        })) })
      }
      const records = await transaction.faqEntry.findMany({
        where: { ...parentWhere(parent), status: { not: 'ARCHIVED' } },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      })
      return { outcome: 'UPDATED' as const, records: records.map(asRecord) }
    }, { maxWait: 15_000, timeout: 15_000 })
  }
}
