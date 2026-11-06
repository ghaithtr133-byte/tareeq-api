import { getPrisma } from '../database/client.js'
import { ApiError } from '../shared/http.js'

export const detailParents = ['COUNTRY_GUIDE', 'SERVICE', 'SCHOLARSHIP'] as const
export type DetailParent = (typeof detailParents)[number]
export type DetailKind = 'STEP' | 'BENEFIT' | 'REQUIREMENT' | 'APPLICATION_STEP'

export type DetailInput = {
  kind?: DetailKind
  titleAr?: string
  bodyAr?: string | null
  descriptionAr?: string | null
  category?: string | null
  amount?: string | null
  currency?: string | null
  coveragePeriod?: string | null
  officialSourceUrl?: string | null
  verifiedAt?: Date | null
}

const lock = 9_000_030
const notFound = () => new ApiError(404, 'CONTENT_DETAIL_NOT_FOUND', 'Content detail entry not found.')
const parentNotFound = () => new ApiError(404, 'CONTENT_NOT_FOUND', 'Parent content not found.')
const orderMismatch = () => new ApiError(409, 'ORDER_SET_MISMATCH', 'The ordered IDs must exactly match the active collection.')
const allowedKinds: Record<DetailParent, DetailKind[]> = {
  COUNTRY_GUIDE: ['STEP'], SERVICE: ['STEP', 'BENEFIT'], SCHOLARSHIP: ['BENEFIT', 'REQUIREMENT', 'APPLICATION_STEP'],
}
const resourceType: Record<DetailParent, 'COUNTRY_STUDY_GUIDE_SECTION' | 'SERVICE_DETAIL_ITEM' | 'SCHOLARSHIP_DETAIL_ITEM'> = {
  COUNTRY_GUIDE: 'COUNTRY_STUDY_GUIDE_SECTION', SERVICE: 'SERVICE_DETAIL_ITEM', SCHOLARSHIP: 'SCHOLARSHIP_DETAIL_ITEM',
}
const actionPrefix: Record<DetailParent, string> = {
  COUNTRY_GUIDE: 'country.study_guide', SERVICE: 'service.detail_item', SCHOLARSHIP: 'scholarship.detail_item',
}

const output = (parent: DetailParent, value: Record<string, unknown>) => ({
  id: value.id, titleAr: value.titleAr, descriptionAr: parent === 'COUNTRY_GUIDE' ? value.bodyAr : value.descriptionAr,
  displayOrder: value.displayOrder,
  ...(parent === 'SCHOLARSHIP' ? {
    kind: value.kind, category: value.category, amount: value.amount === null || value.amount === undefined ? null : String(value.amount),
    currency: value.currency, coveragePeriod: value.coveragePeriod, officialSourceUrl: value.officialSourceUrl,
    verifiedAt: value.verifiedAt,
  } : {}),
})

export class ContentDetailsService {
  private async parentExists(parent: DetailParent, id: string) {
    const prisma = getPrisma()
    const count = await ({
      COUNTRY_GUIDE: () => prisma.country.count({ where: { id } }),
      SERVICE: () => prisma.service.count({ where: { id } }),
      SCHOLARSHIP: () => prisma.scholarship.count({ where: { id } }),
    })[parent]()
    return count === 1
  }

  async list(parent: DetailParent, parentId: string, kind?: DetailKind) {
    if (!await this.parentExists(parent, parentId)) throw parentNotFound()
    const prisma = getPrisma()
    const rows = await ({
      COUNTRY_GUIDE: () => prisma.countryStudyGuideSection.findMany({ where: { countryId: parentId }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] }),
      SERVICE: () => prisma.serviceDetailItem.findMany({ where: { serviceId: parentId, ...(kind ? { kind: kind as 'STEP' | 'BENEFIT' } : {}) }, orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] }),
      SCHOLARSHIP: () => prisma.scholarshipDetailItem.findMany({ where: { scholarshipId: parentId, ...(kind ? { kind: kind as 'BENEFIT' | 'REQUIREMENT' | 'APPLICATION_STEP' } : {}) }, orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] }),
    })[parent]()
    return rows.map((row) => output(parent, row as unknown as Record<string, unknown>))
  }

  async create(parent: DetailParent, parentId: string, input: DetailInput & Required<Pick<DetailInput, 'kind' | 'titleAr'>>, actorAdminId: string) {
    this.validate(parent, input)
    if (!await this.parentExists(parent, parentId)) throw parentNotFound()
    const prisma = getPrisma()
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})`
      const max = await ({
        COUNTRY_GUIDE: () => tx.countryStudyGuideSection.aggregate({ where: { countryId: parentId }, _max: { displayOrder: true } }),
        SERVICE: () => tx.serviceDetailItem.aggregate({ where: { serviceId: parentId, kind: input.kind as 'STEP' | 'BENEFIT' }, _max: { displayOrder: true } }),
        SCHOLARSHIP: () => tx.scholarshipDetailItem.aggregate({ where: { scholarshipId: parentId, kind: input.kind as 'BENEFIT' | 'REQUIREMENT' | 'APPLICATION_STEP' }, _max: { displayOrder: true } }),
      })[parent]()
      const displayOrder = (max._max.displayOrder ?? -1) + 1
      const row = await ({
        COUNTRY_GUIDE: () => tx.countryStudyGuideSection.create({ data: { countryId: parentId, titleAr: input.titleAr, bodyAr: input.bodyAr ?? '', displayOrder } }),
        SERVICE: () => tx.serviceDetailItem.create({ data: { serviceId: parentId, kind: input.kind as 'STEP' | 'BENEFIT', titleAr: input.titleAr, descriptionAr: input.descriptionAr ?? null, displayOrder } }),
        SCHOLARSHIP: () => tx.scholarshipDetailItem.create({ data: { scholarshipId: parentId, kind: input.kind as 'BENEFIT' | 'REQUIREMENT' | 'APPLICATION_STEP', titleAr: input.titleAr, descriptionAr: input.descriptionAr ?? null, displayOrder, category: input.category ?? null, amount: input.amount ?? null, currency: input.currency ?? null, coveragePeriod: input.coveragePeriod ?? null, officialSourceUrl: input.officialSourceUrl ?? null, verifiedAt: input.verifiedAt ?? null } }),
      })[parent]()
      await tx.adminAuditLog.create({ data: { actorAdminId, action: `${actionPrefix[parent]}.created`, resourceType: resourceType[parent], resourceId: row.id, metadata: { parentId, kind: input.kind, displayOrder } } })
      return output(parent, row as unknown as Record<string, unknown>)
    })
  }

  async update(parent: DetailParent, id: string, input: DetailInput, actorAdminId: string) {
    this.validate(parent, input)
    const prisma = getPrisma()
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})`
      const current = await ({ COUNTRY_GUIDE: () => tx.countryStudyGuideSection.findUnique({ where: { id } }), SERVICE: () => tx.serviceDetailItem.findUnique({ where: { id } }), SCHOLARSHIP: () => tx.scholarshipDetailItem.findUnique({ where: { id } }) })[parent]()
      if (!current) throw notFound()
      const row = await ({
        COUNTRY_GUIDE: () => tx.countryStudyGuideSection.update({ where: { id }, data: { ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }), ...(input.bodyAr === undefined ? {} : { bodyAr: input.bodyAr ?? '' }) } }),
        SERVICE: () => tx.serviceDetailItem.update({ where: { id }, data: { ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }), ...(input.descriptionAr === undefined ? {} : { descriptionAr: input.descriptionAr }) } }),
        SCHOLARSHIP: () => tx.scholarshipDetailItem.update({ where: { id }, data: { ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }), ...(input.descriptionAr === undefined ? {} : { descriptionAr: input.descriptionAr }), ...(input.category === undefined ? {} : { category: input.category }), ...(input.amount === undefined ? {} : { amount: input.amount }), ...(input.currency === undefined ? {} : { currency: input.currency }), ...(input.coveragePeriod === undefined ? {} : { coveragePeriod: input.coveragePeriod }), ...(input.officialSourceUrl === undefined ? {} : { officialSourceUrl: input.officialSourceUrl }), ...(input.verifiedAt === undefined ? {} : { verifiedAt: input.verifiedAt }) } }),
      })[parent]()
      await tx.adminAuditLog.create({ data: { actorAdminId, action: `${actionPrefix[parent]}.updated`, resourceType: resourceType[parent], resourceId: id, metadata: { changedFields: Object.keys(input).sort() } } })
      return output(parent, row as unknown as Record<string, unknown>)
    })
  }

  async remove(parent: DetailParent, id: string, actorAdminId: string) {
    const prisma = getPrisma()
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})`
      const current = await ({ COUNTRY_GUIDE: () => tx.countryStudyGuideSection.findUnique({ where: { id } }), SERVICE: () => tx.serviceDetailItem.findUnique({ where: { id } }), SCHOLARSHIP: () => tx.scholarshipDetailItem.findUnique({ where: { id } }) })[parent]()
      if (!current) throw notFound()
      await ({ COUNTRY_GUIDE: () => tx.countryStudyGuideSection.delete({ where: { id } }), SERVICE: () => tx.serviceDetailItem.delete({ where: { id } }), SCHOLARSHIP: () => tx.scholarshipDetailItem.delete({ where: { id } }) })[parent]()
      await tx.adminAuditLog.create({ data: { actorAdminId, action: `${actionPrefix[parent]}.deleted`, resourceType: resourceType[parent], resourceId: id, metadata: {} } })
      return { id }
    })
  }

  async reorder(parent: DetailParent, parentId: string, kind: DetailKind, orderedIds: string[], actorAdminId: string) {
    this.validate(parent, { kind })
    if (!await this.parentExists(parent, parentId)) throw parentNotFound()
    const prisma = getPrisma()
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})`
      const rows = await ({ COUNTRY_GUIDE: () => tx.countryStudyGuideSection.findMany({ where: { countryId: parentId }, orderBy: { id: 'asc' } }), SERVICE: () => tx.serviceDetailItem.findMany({ where: { serviceId: parentId, kind: kind as 'STEP' | 'BENEFIT' }, orderBy: { id: 'asc' } }), SCHOLARSHIP: () => tx.scholarshipDetailItem.findMany({ where: { scholarshipId: parentId, kind: kind as 'BENEFIT' | 'REQUIREMENT' | 'APPLICATION_STEP' }, orderBy: { id: 'asc' } }) })[parent]()
      if (rows.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || rows.some((row) => !orderedIds.includes(row.id))) throw orderMismatch()
      for (const [displayOrder, id] of orderedIds.entries()) await ({ COUNTRY_GUIDE: () => tx.countryStudyGuideSection.update({ where: { id }, data: { displayOrder } }), SERVICE: () => tx.serviceDetailItem.update({ where: { id }, data: { displayOrder } }), SCHOLARSHIP: () => tx.scholarshipDetailItem.update({ where: { id }, data: { displayOrder } }) })[parent]()
      await tx.adminAuditLog.createMany({ data: orderedIds.map((resourceId, displayOrder) => ({ actorAdminId, action: `${actionPrefix[parent]}.reordered`, resourceType: resourceType[parent], resourceId, metadata: { parentId, kind, displayOrder } })) })
      const byId = new Map(rows.map((row) => [row.id, row as unknown as Record<string, unknown>]))
      return orderedIds.map((id, displayOrder) => output(parent, { ...byId.get(id)!, displayOrder }))
    })
  }

  private validate(parent: DetailParent, input: DetailInput) {
    if (input.kind && !allowedKinds[parent].includes(input.kind)) throw new ApiError(400, 'VALIDATION_ERROR', 'The detail kind is invalid for this parent.', { fields: { kind: ['Use a supported kind.'] } })
    if (input.amount !== undefined && input.amount !== null && (!input.currency || !input.coveragePeriod || !input.officialSourceUrl || !input.verifiedAt)) throw new ApiError(400, 'VALIDATION_ERROR', 'A monetary benefit requires currency, coverage period, official source, and verification time.', { fields: { amount: ['Provide complete verified monetary benefit metadata.'] } })
  }
}
