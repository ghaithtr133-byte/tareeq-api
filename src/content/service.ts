import { ApiError } from '../shared/http.js'
import {
  contentAuditAction,
  contentAuditResourceTypes,
} from '../audit/actions.js'
import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
  PublicationStatus,
} from './types.js'

const labels: Record<ContentResource, string> = {
  countries: 'Country',
  universities: 'University',
  scholarships: 'Scholarship',
  services: 'Service',
  articles: 'Article',
}

const relationError = (field: string, message: string) =>
  new ApiError(400, 'RELATIONSHIP_INVALID', 'A related content selection is invalid.', {
    fields: { [field]: [message] },
  })

const auditComparable = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value

const changedFieldNames = (
  current: ContentEntity,
  input: ContentWriteData,
) => Object.keys(input).filter((field) =>
  JSON.stringify(auditComparable(current[field])) !==
  JSON.stringify(auditComparable(input[field])),
).sort()

const relatedScholarshipView = (value: unknown, now: Date) => {
  const record = value as Record<string, unknown>
  const deadline = record.verifiedDeadline
  return {
    id: record.id,
    slug: record.slug,
    titleAr: record.titleAr,
    imageUrl: record.imageUrl ?? null,
    country: record.country ?? null,
    effectiveApplicationStatus: deadline instanceof Date && deadline < now
      ? 'CLOSED'
      : record.applicationStatus,
  }
}

const withRelatedScholarshipViews = (record: ContentEntity, now: Date): ContentEntity => ({
  ...record,
  ...(Array.isArray(record.relatedScholarships)
    ? { relatedScholarships: record.relatedScholarships.map((item) => relatedScholarshipView(item, now)) }
    : {}),
})

const publicView = (record: ContentEntity, now: Date) => {
  const publicRecord: Record<string, unknown> = withRelatedScholarshipViews(record, now)
  delete publicRecord.status
  delete publicRecord.createdAt
  delete publicRecord.updatedAt
  delete publicRecord.scholarship
  delete publicRecord.scholarshipIds
  if ('detailsAr' in publicRecord) {
    publicRecord.studentFacts = {
      studyLanguageAr: publicRecord.studyLanguageAr ?? null,
      tuitionSummaryAr: publicRecord.tuitionSummaryAr ?? null,
      admissionSummaryAr: publicRecord.admissionSummaryAr ?? null,
      applicationDatesSummaryAr: publicRecord.applicationDatesSummaryAr ?? null,
    }
    delete publicRecord.studyLanguageAr
    delete publicRecord.tuitionSummaryAr
    delete publicRecord.admissionSummaryAr
    delete publicRecord.applicationDatesSummaryAr
  }
  if ('detailsAr' in publicRecord) {
    publicRecord.studyGuide = Array.isArray(publicRecord.studyGuideSections) ? publicRecord.studyGuideSections : []
    delete publicRecord.studyGuideSections
  }
  if ('summaryAr' in publicRecord || 'fundingType' in publicRecord) {
    const items = Array.isArray(publicRecord.detailItems) ? publicRecord.detailItems as Array<Record<string, unknown>> : []
    if ('summaryAr' in publicRecord) {
      publicRecord.stepsAr = items.filter((item) => item.kind === 'STEP')
      publicRecord.benefitsAr = items.filter((item) => item.kind === 'BENEFIT')
    } else {
      publicRecord.benefitsAr = items.filter((item) => item.kind === 'BENEFIT')
      publicRecord.requirementItemsAr = items.filter((item) => item.kind === 'REQUIREMENT')
      publicRecord.applicationStepsAr = items.filter((item) => item.kind === 'APPLICATION_STEP')
    }
    delete publicRecord.detailItems
  }
  if ('applicationStatus' in publicRecord) {
    const deadline = publicRecord.verifiedDeadline
    publicRecord.effectiveApplicationStatus =
      deadline instanceof Date && deadline < now
        ? 'CLOSED'
        : publicRecord.applicationStatus
  }
  return publicRecord
}

const adminView = (record: ContentEntity, now: Date) => {
  const adminRecord = withRelatedScholarshipViews(record, now)
  if (!('applicationStatus' in adminRecord)) return adminRecord
  const deadline = adminRecord.verifiedDeadline
  return {
    ...adminRecord,
    effectiveApplicationStatus:
      deadline instanceof Date && deadline < now
        ? 'CLOSED'
        : record.applicationStatus,
  }
}

export class ContentService {
  constructor(
    private readonly repository: ContentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    resource: ContentResource,
    query: ContentListQuery,
    publicOnly: boolean,
  ) {
    const now = this.now()
    const result = await this.repository.list(resource, query, publicOnly, now)
    return {
      items: result.items.map((item) =>
        publicOnly ? publicView(item, now) : adminView(item, now),
      ),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
      },
    }
  }

  async getPublic(resource: ContentResource, slug: string) {
    const record = await this.repository.findBySlug(resource, slug, true)
    if (!record) {
      throw new ApiError(404, 'CONTENT_NOT_FOUND', `${labels[resource]} not found.`)
    }
    return publicView(record, this.now())
  }

  async getAdmin(resource: ContentResource, id: string) {
    const record = await this.repository.findById(resource, id)
    if (!record) {
      throw new ApiError(404, 'CONTENT_NOT_FOUND', `${labels[resource]} not found.`)
    }
    return adminView(record, this.now())
  }

  async scholarshipFilterOptions() {
    const options = await this.repository.scholarshipFilterOptions()
    const studyLevelLabels: Record<string, string> = {
      FOUNDATION: 'السنة التحضيرية', DIPLOMA: 'دبلوم', BACHELORS: 'بكالوريوس', MASTERS: 'ماجستير', MASTER: 'ماجستير', PHD: 'دكتوراه',
      ASSOCIATE_BACHELOR_MASTER_PHD: 'دبلوم مشارك، بكالوريوس، ماجستير ودكتوراه',
      BACHELOR_MASTER_PHD: 'بكالوريوس، ماجستير ودكتوراه',
    }
    const fundingTypeLabels: Record<string, string> = {
      FULL: 'تمويل كامل', PARTIAL: 'تمويل جزئي', GOVERNMENT_FUNDED: 'ممولة حكومياً',
      GOVERNMENT_FUNDED_FULL: 'تمويل حكومي كامل', TUITION_AND_STIPEND: 'رسوم دراسية ومخصصات',
    }
    const map = (items: Array<{ value: string; count: number }>, labels: Record<string, string>) => items.map((item) => ({ ...item, labelAr: labels[item.value] ?? null }))
    return { studyLevels: map(options.studyLevels, studyLevelLabels), fundingTypes: map(options.fundingTypes, fundingTypeLabels) }
  }

  async create(
    resource: ContentResource,
    input: ContentWriteData,
    actorAdminId: string,
  ) {
    input = this.normalizeArticleAssociations(resource, input, true)
    const status = input.status ?? 'DRAFT'
    const data: ContentWriteData = {
      ...input,
      status,
      publishedAt: status === 'PUBLISHED' ? this.now() : null,
    }
    this.normalizeDates(data)
    await this.validateWrite(resource, data, status === 'PUBLISHED')
    await this.ensureUniqueSlug(resource, String(data.slug))
    return adminView(await this.repository.create(resource, data, {
      actorAdminId,
      action: contentAuditAction(resource, 'created'),
      resourceType: contentAuditResourceTypes[resource],
      metadata: {
        status,
        ...(resource === 'articles' && Array.isArray(data.scholarshipIds)
          ? { scholarshipAssociationCount: data.scholarshipIds.length }
          : {}),
      },
    }), this.now())
  }

  async update(
    resource: ContentResource,
    id: string,
    input: ContentWriteData,
    actorAdminId: string,
  ) {
    const current = await this.repository.findById(resource, id)
    if (!current) {
      throw new ApiError(404, 'CONTENT_NOT_FOUND', `${labels[resource]} not found.`)
    }

    input = this.normalizeArticleAssociations(resource, input, false)

    if (
      current.publishedAt &&
      typeof input.slug === 'string' &&
      input.slug !== current.slug
    ) {
      throw new ApiError(
        409,
        'PUBLISHED_SLUG_IMMUTABLE',
        'A previously published slug cannot be changed.',
        { fields: { slug: ['Keep the existing public slug.'] } },
      )
    }

    const next = { ...current, ...input } as ContentWriteData
    this.normalizeDates(next)
    await this.validateWrite(resource, next, input.status === 'PUBLISHED' && current.status !== 'PUBLISHED')
    if (typeof input.slug === 'string' && input.slug !== current.slug) {
      await this.ensureUniqueSlug(resource, input.slug, id)
    }

    const data = { ...input } as ContentWriteData
    this.normalizeDates(data)
    if (
      input.status === 'PUBLISHED' &&
      current.status !== 'PUBLISHED' &&
      !current.publishedAt
    ) {
      data.publishedAt = this.now()
    }
    const statusChanged =
      typeof input.status === 'string' && input.status !== current.status
    return adminView(await this.repository.update(resource, id, data, {
      actorAdminId,
      action: contentAuditAction(
        resource,
        statusChanged ? 'status_changed' : 'updated',
      ),
      resourceType: contentAuditResourceTypes[resource],
      metadata: {
        changedFields: changedFieldNames(current, input),
        ...(resource === 'articles' && Array.isArray(data.scholarshipIds)
          ? { scholarshipAssociationCount: data.scholarshipIds.length }
          : {}),
        ...(statusChanged
          ? { fromStatus: current.status, toStatus: input.status as string }
          : {}),
      },
    }), this.now())
  }

  private normalizeDates(data: ContentWriteData) {
    if (typeof data.verifiedDeadline === 'string') {
      data.verifiedDeadline = new Date(data.verifiedDeadline)
    }
  }

  private normalizeArticleAssociations(
    resource: ContentResource,
    input: ContentWriteData,
    creating: boolean,
  ): ContentWriteData {
    if (resource !== 'articles') return input
    const hasMultiple = Object.prototype.hasOwnProperty.call(input, 'scholarshipIds')
    const hasLegacy = Object.prototype.hasOwnProperty.call(input, 'scholarshipId')
    if (hasMultiple) {
      const scholarshipIds = input.scholarshipIds as string[]
      return { ...input, scholarshipIds, scholarshipId: scholarshipIds[0] ?? null }
    }
    if (hasLegacy) {
      const scholarshipIds = typeof input.scholarshipId === 'string' ? [input.scholarshipId] : []
      return { ...input, scholarshipIds, scholarshipId: scholarshipIds[0] ?? null }
    }
    return creating ? { ...input, scholarshipIds: [], scholarshipId: null } : input
  }

  private async ensureUniqueSlug(
    resource: ContentResource,
    slug: string,
    currentId?: string,
  ) {
    const existing = await this.repository.findBySlug(resource, slug, false)
    if (existing && existing.id !== currentId) {
      throw new ApiError(409, 'SLUG_CONFLICT', 'The slug is already in use.', {
        fields: { slug: ['Choose a unique slug.'] },
      })
    }
  }

  private async validateWrite(resource: ContentResource, data: ContentWriteData, enteringPublication = false) {
    const status = data.status as PublicationStatus | undefined
    if (
      resource === 'scholarships' &&
      status === 'PUBLISHED' &&
      !data.officialSourceUrl
    ) {
      throw new ApiError(
        400,
        'PUBLICATION_REQUIREMENTS_NOT_MET',
        'The scholarship cannot be published without an official source URL.',
        { fields: { officialSourceUrl: ['An official source URL is required before publication.'] } },
      )
    }
    if (resource === 'countries' && enteringPublication && (!data.imageUrl || !data.imageAltAr)) {
      throw new ApiError(400, 'PUBLICATION_REQUIREMENTS_NOT_MET', 'The Country cannot be published without a hero image and Arabic alternative text.', {
        fields: { imageUrl: ['A hero image is required before publication.'], imageAltAr: ['Meaningful Arabic alternative text is required before publication.'] },
      })
    }

    const countryId = typeof data.countryId === 'string' ? data.countryId : null
    const cityId = typeof data.cityId === 'string' ? data.cityId : null
    const universityId = typeof data.universityId === 'string' ? data.universityId : null
    const scholarshipId = typeof data.scholarshipId === 'string' ? data.scholarshipId : null

    const country = countryId
      ? await this.repository.findById('countries', countryId)
      : null
    if (countryId && !country) {
      throw relationError('countryId', 'Select an existing country.')
    }

    const city = cityId ? await this.repository.findCityById(cityId) : null
    if (cityId && !city) {
      throw relationError('cityId', 'Select an existing normalized city.')
    }
    if (city && countryId && city.countryId !== countryId) {
      throw relationError('cityId', 'The selected city must belong to the selected country.')
    }

    const university = universityId
      ? await this.repository.findById('universities', universityId)
      : null
    if (universityId && !university) {
      throw relationError('universityId', 'Select an existing university.')
    }

    if (
      countryId &&
      university &&
      university.countryId !== countryId
    ) {
      throw relationError(
        'universityId',
        'The selected university must belong to the selected country.',
      )
    }

    const scholarshipIds = resource === 'articles' && Array.isArray(data.scholarshipIds)
      ? data.scholarshipIds.filter((value): value is string => typeof value === 'string')
      : scholarshipId ? [scholarshipId] : []
    if (scholarshipIds.length > 0) {
      const scholarshipCount = await this.repository.countScholarshipsByIds(scholarshipIds)
      if (scholarshipCount !== scholarshipIds.length) {
        throw relationError('scholarshipIds', 'Every selected Scholarship must exist.')
      }
    }

    if (resource === 'universities' && !countryId) {
      throw relationError('countryId', 'Every university must belong to a country.')
    }
  }
}
