import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
  ScholarshipOption,
  ScholarshipOptionType,
} from '../../src/content/types.js'
import type { AuditIntent } from '../../src/audit/types.js'
import {
  analyzeDeletionImpact,
  deletionImpactDigest,
  impactItem,
  type ConfirmedDeletionExecution,
  type DeletionChallengeIssue,
  type DeletionExecution,
  type DeletionImpact,
  type DeletionImpactItem,
} from '../../src/content/deletion-impact.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'
import type { InMemoryUniversityDirectoryRepository } from './in-memory-university-directory-repository.js'
import type { UniversityDirectoryFilters } from '../../src/university-directory/types.js'

const textIncludes = (value: unknown, search: string) =>
  typeof value === 'string' && value.toLocaleLowerCase().includes(search.toLocaleLowerCase())

export class InMemoryContentRepository implements ContentRepository {
  readonly scholarshipOptions: ScholarshipOption[] = ([
    ['STUDY_LEVEL', 'FOUNDATION', 'السنة التحضيرية'], ['STUDY_LEVEL', 'DIPLOMA', 'دبلوم'], ['STUDY_LEVEL', 'BACHELORS', 'بكالوريوس'], ['STUDY_LEVEL', 'MASTERS', 'ماجستير'], ['STUDY_LEVEL', 'PHD', 'دكتوراه'], ['STUDY_LEVEL', 'ASSOCIATE_BACHELOR_MASTER_PHD', 'دبلوم مشارك، بكالوريوس، ماجستير ودكتوراه'], ['STUDY_LEVEL', 'BACHELOR_MASTER_PHD', 'بكالوريوس، ماجستير ودكتوراه'],
    ['FUNDING_TYPE', 'FULL', 'تمويل كامل'], ['FUNDING_TYPE', 'PARTIAL', 'تمويل جزئي'], ['FUNDING_TYPE', 'GOVERNMENT_FUNDED', 'ممولة حكومياً'], ['FUNDING_TYPE', 'GOVERNMENT_FUNDED_FULL', 'تمويل حكومي كامل'], ['FUNDING_TYPE', 'TUITION_AND_STIPEND', 'رسوم دراسية ومخصصات'],
  ] as Array<[string, string, string]>).map(([type, code, nameAr], sortOrder) => ({ id: crypto.randomUUID(), type: type as ScholarshipOptionType, code, nameAr, isActive: true, sortOrder, createdAt: new Date(), updatedAt: new Date() }))
  private readonly configuredDeletionImpacts = new Map<string, { items: DeletionImpactItem[]; analysisComplete: boolean }>()
  private readonly deletionChallenges = new Map<string, {
    actorAdminId: string
    resource: ContentResource
    resourceId: string
    impactHash: string
    expiresAt: Date
    consumedAt: Date | null
  }>()
  private readonly confirmingChallenges = new Set<string>()

  setDeletionImpact(
    resource: ContentResource,
    id: string,
    items: DeletionImpactItem[],
    analysisComplete = true,
  ) {
    this.configuredDeletionImpacts.set(`${resource}:${id}`, { items, analysisComplete })
  }

  expireDeletionChallenge(id: string) {
    const challenge = this.deletionChallenges.get(id)
    if (challenge) challenge.expiresAt = new Date(0)
  }

  async deletionImpact(resource: ContentResource, id: string): Promise<DeletionImpact | null> {
    const target = this.records.get(resource)?.find((record) => record.id === id)
    if (!target) return null
    const configured = this.configuredDeletionImpacts.get(`${resource}:${id}`) ?? { items: [], analysisComplete: true }
    const auditCount = this.audit.events.filter((event) => event.resourceId === id).length
    const items = [
      ...configured.items,
      impactItem('ADMIN_AUDIT_LOG', 'PRESERVE', auditCount, `${resource}.auditHistory`, 'AUDIT_HISTORY_PRESERVED'),
    ]
    if (target.slug.startsWith('demo-e2e-')) {
      items.push(impactItem('DEMO_FIXTURE', 'BLOCK', 1, `${resource}.demoFixture`, 'DEMO_FIXTURE_PROTECTED', { sampleIds: [id], canConfirm: false, blocked: true }))
    }
    return analyzeDeletionImpact({
      target: { resource, id, slug: target.slug, status: target.status },
      items,
      analysisComplete: configured.analysisComplete,
    })
  }

  async deleteIfSafe(resource: ContentResource, id: string, actorAdminId: string): Promise<DeletionExecution> {
    const impact = await this.deletionImpact(resource, id)
    if (!impact) return { outcome: 'NOT_FOUND' }
    if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED', impact }
    if (impact.outcome === 'REQUIRES_CONFIRMATION') return { outcome: 'REQUIRES_CONFIRMATION', impact }
    await this.audit.append({
      actorAdminId,
      action: `content.${resource}.hard_deleted`,
      resourceType: ({ countries: 'COUNTRY', universities: 'UNIVERSITY', scholarships: 'SCHOLARSHIP', services: 'SERVICE', articles: 'ARTICLE' } as const)[resource],
      metadata: { deletionMode: 'SAFE_INITIAL', previousStatus: impact.target.status },
    }, id)
    const records = this.records.get(resource) ?? []
    const index = records.findIndex((record) => record.id === id)
    if (index >= 0) records.splice(index, 1)
    return { outcome: 'DELETED', id, impact }
  }

  async issueDeletionChallenge(
    resource: ContentResource,
    id: string,
    actorAdminId: string,
    expiresAt: Date,
  ): Promise<DeletionChallengeIssue> {
    const impact = await this.deletionImpact(resource, id)
    if (!impact) return { outcome: 'NOT_FOUND' }
    if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED', impact }
    if (impact.outcome === 'SAFE') return { outcome: 'SAFE', impact }
    const challenge = { id: crypto.randomUUID(), expiresAt }
    this.deletionChallenges.set(challenge.id, {
      actorAdminId,
      resource,
      resourceId: id,
      impactHash: deletionImpactDigest(impact),
      expiresAt,
      consumedAt: null,
    })
    return { outcome: 'ISSUED', impact, challenge }
  }

  async confirmHardDelete(
    resource: ContentResource,
    id: string,
    challengeId: string,
    actorAdminId: string,
    now: Date,
  ): Promise<ConfirmedDeletionExecution> {
    const impact = await this.deletionImpact(resource, id)
    if (!impact) return { outcome: 'NOT_FOUND' }
    if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED', impact }
    const challenge = this.deletionChallenges.get(challengeId)
    if (
      !challenge ||
      challenge.actorAdminId !== actorAdminId ||
      challenge.resource !== resource ||
      challenge.resourceId !== id ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.impactHash !== deletionImpactDigest(impact) ||
      impact.outcome !== 'REQUIRES_CONFIRMATION'
    ) return { outcome: 'STALE', impact }
    if (this.confirmingChallenges.has(challengeId)) return { outcome: 'STALE', impact }
    this.confirmingChallenges.add(challengeId)
    try {
      await this.audit.append({
        actorAdminId,
        action: `content.${resource}.hard_deleted`,
        resourceType: ({ countries: 'COUNTRY', universities: 'UNIVERSITY', scholarships: 'SCHOLARSHIP', services: 'SERVICE', articles: 'ARTICLE' } as const)[resource],
        metadata: { deletionMode: 'CONFIRMED', challengeId },
      }, id)
      challenge.consumedAt = now
      const records = this.records.get(resource) ?? []
      const index = records.findIndex((record) => record.id === id)
      if (index >= 0) records.splice(index, 1)
      return { outcome: 'DELETED', id, impact }
    } finally {
      this.confirmingChallenges.delete(challengeId)
    }
  }

  async reorder(resource: ContentResource, orderedIds: string[], audit: AuditIntent['actorAdminId']) {
    const records = (this.records.get(resource) ?? []).filter((item) => item.status !== 'ARCHIVED')
    if (records.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || records.some((item) => !orderedIds.includes(item.id))) return { outcome: 'ORDER_SET_MISMATCH' as const }
    orderedIds.forEach((id, displayOrder) => { const item = records.find((record) => record.id === id)!; item.displayOrder = displayOrder })
    const auditResourceId = orderedIds[0]
    if (auditResourceId) await this.audit.append({ actorAdminId: audit, action: `content.${resource}.reordered`, resourceType: ({ countries: 'COUNTRY', universities: 'UNIVERSITY', scholarships: 'SCHOLARSHIP', services: 'SERVICE', articles: 'ARTICLE' } as const)[resource], metadata: { count: orderedIds.length } }, auditResourceId)
    return { outcome: 'UPDATED' as const, records: orderedIds.map((id) => records.find((item) => item.id === id)!) }
  }
  private readonly records = new Map<ContentResource, ContentEntity[]>([
    ['countries', []],
    ['universities', []],
    ['scholarships', []],
    ['services', []],
    ['articles', []],
  ])

  constructor(
    readonly audit = new InMemoryAuditRepository(),
    private readonly universityDirectory?: InMemoryUniversityDirectoryRepository,
  ) {}

  async list(
    resource: ContentResource,
    query: ContentListQuery,
    publicOnly: boolean,
    now: Date,
  ) {
    let records = [...(this.records.get(resource) ?? [])]
    records = records.filter((record) =>
      publicOnly ? record.status === 'PUBLISHED' : !query.status || record.status === query.status,
    )
    if (query.featured !== undefined) {
      records = records.filter((record) => record.featured === query.featured)
    }
    if (query.search) {
      const search = query.search
      records = records.filter((record) =>
        Object.values(record).some((value) => textIncludes(value, search)),
      )
    }
    if (query.country) {
      const country = (this.records.get('countries') ?? []).find(
        (record) => record.slug === query.country,
      )
      records = records.filter((record) => record.countryId === country?.id)
    }
    if (query.university) {
      const university = (this.records.get('universities') ?? []).find(
        (record) => record.slug === query.university,
      )
      records = records.filter((record) => record.universityId === university?.id)
    }
    if (resource === 'scholarships') {
      const directoryFilters: UniversityDirectoryFilters = {
        ...(query.universitySearch ? { search: query.universitySearch } : {}),
        ...(query.universityCountry ? { country: query.universityCountry } : {}),
        ...(query.universityFeatured === undefined ? {} : { featured: query.universityFeatured }),
        ...(query.universityMajor ? { major: query.universityMajor } : {}),
        ...(query.universityStudyLevel ? { studyLevel: query.universityStudyLevel } : {}),
        ...(query.universityLanguage ? { language: query.universityLanguage } : {}),
        ...(query.universityCity ? { city: query.universityCity } : {}),
        ...(query.universityType ? { universityType: query.universityType } : {}),
      }
      if (Object.keys(directoryFilters).length > 0) {
        records = records.filter((record) =>
          typeof record.universityId === 'string' &&
          (this.universityDirectory?.matchesUniversity(record.universityId, directoryFilters) ?? false),
        )
      }
    }
    if (resource === 'universities' && (query.major || query.studyLevel || query.language)) {
      records = records.filter((record) => this.universityDirectory?.matchesUniversity(record.id, {
        ...(query.major ? { major: query.major } : {}),
        ...(query.studyLevel ? { studyLevel: query.studyLevel as never } : {}),
        ...(query.language ? { language: query.language as never } : {}),
      }) ?? false)
    } else if (query.studyLevel) {
      records = records.filter((record) => record.studyLevel === query.studyLevel)
    }
    if (resource === 'universities' && query.city) {
      records = records.filter((record) => this.universityDirectory?.findCity(String(record.cityId))?.slug === query.city)
    }
    if (resource === 'universities' && query.universityType) {
      records = records.filter((record) => record.universityType === query.universityType)
    }
    if (query.fundingType) {
      records = records.filter((record) => record.fundingType === query.fundingType)
    }
    if (query.applicationStatus) {
      records = records.filter((record) => {
        const deadline = record.verifiedDeadline
        const effective = deadline instanceof Date && deadline < now
          ? 'CLOSED'
          : record.applicationStatus
        return effective === query.applicationStatus
      })
    }
    records.sort((left, right) => {
      if (publicOnly && resource === 'scholarships' && left.featured !== right.featured) {
        return left.featured ? -1 : 1
      }
      const manualByDefault = publicOnly && query.sort === undefined && (
        resource === 'universities' || resource === 'scholarships' || resource === 'articles'
      )
      if (query.sort === 'manual' || manualByDefault) {
        return Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0) || right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)
      }
      if (query.sort === 'name') {
        return String(left.nameAr).localeCompare(String(right.nameAr), 'ar') || left.id.localeCompare(right.id)
      }
      if (query.sort === 'deadline') {
        if (!publicOnly && resource === 'scholarships') {
          const upcoming = (record: ContentEntity) => record.applicationStatus === 'OPEN' && record.verifiedDeadline instanceof Date && record.verifiedDeadline >= now
          if (upcoming(left) !== upcoming(right)) return upcoming(left) ? -1 : 1
          if (upcoming(left) && upcoming(right)) return (left.verifiedDeadline as Date).getTime() - (right.verifiedDeadline as Date).getTime() || left.id.localeCompare(right.id)
          const leftStatus = String(left.applicationStatus ?? '')
          const rightStatus = String(right.applicationStatus ?? '')
          const leftDeadline = left.verifiedDeadline instanceof Date ? left.verifiedDeadline.getTime() : Number.MAX_SAFE_INTEGER
          const rightDeadline = right.verifiedDeadline instanceof Date ? right.verifiedDeadline.getTime() : Number.MAX_SAFE_INTEGER
          return leftStatus.localeCompare(rightStatus) || leftDeadline - rightDeadline || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
        }
        const leftDeadline = left.verifiedDeadline instanceof Date ? left.verifiedDeadline.getTime() : Number.MAX_SAFE_INTEGER
        const rightDeadline = right.verifiedDeadline instanceof Date ? right.verifiedDeadline.getTime() : Number.MAX_SAFE_INTEGER
        return leftDeadline - rightDeadline || left.id.localeCompare(right.id)
      }
      return right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)
    })
    const total = records.length
    const offset = (query.page - 1) * query.limit
    const items = records.slice(offset, offset + query.limit).map((record) => {
      if (resource !== 'articles') return this.withRelationships(resource, record)
      const listing = { ...record }
      delete listing.scholarshipIds
      delete listing.relatedScholarships
      return listing
    })
    return { items, total }
  }

  async findById(resource: ContentResource, id: string) {
    const record = this.records.get(resource)?.find((item) => item.id === id) ?? null
    return resource === 'articles' && record ? this.articleDetails(record, false) : record ? this.withRelationships(resource, record) : null
  }

  async findBySlug(resource: ContentResource, slug: string, publicOnly: boolean) {
    const record = this.records.get(resource)?.find(
      (record) => record.slug === slug && (!publicOnly || record.status === 'PUBLISHED'),
    ) ?? null
    return resource === 'articles' && record ? this.articleDetails(record, publicOnly) : record ? this.withRelationships(resource, record) : null
  }

  async findCityById(id: string) {
    const city = this.universityDirectory?.findCity(id)
    return city ? { id: city.id, countryId: city.countryId, slug: city.slug } : null
  }

  async countScholarshipsByIds(ids: string[]) {
    const selected = new Set(ids)
    return (this.records.get('scholarships') ?? []).filter(({ id }) => selected.has(id)).length
  }

  async scholarshipFilterOptions() {
    const published = (this.records.get('scholarships') ?? []).filter((item) => item.status === 'PUBLISHED')
    const aggregate = (field: 'studyLevel' | 'fundingType') => [...new Map(published.filter((item) => typeof item[field] === 'string' && item[field] !== '').map((item) => [String(item[field]), 0])).keys()].sort().map((value) => ({ value, count: published.filter((item) => item[field] === value).length }))
    return { studyLevels: aggregate('studyLevel'), fundingTypes: aggregate('fundingType') }
  }
  async activeScholarshipOptionExists(type: ScholarshipOptionType, code: string) { return this.scholarshipOptions.some((item) => item.type === type && item.code === code && item.isActive) }
  async listScholarshipOptions(type: ScholarshipOptionType, includeInactive: boolean) { return this.scholarshipOptions.filter((item) => item.type === type && (includeInactive || item.isActive)).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)).map((item) => ({ ...item })) }
  async createScholarshipOption(input: Pick<ScholarshipOption, 'type' | 'nameAr' | 'isActive' | 'sortOrder'>, actorAdminId: string) {
    if (this.scholarshipOptions.some((item) => item.type === input.type && item.nameAr.trim() === input.nameAr.trim())) return { outcome: 'CONFLICT' as const }
    const record: ScholarshipOption = { ...input, id: crypto.randomUUID(), code: `CUSTOM_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`, createdAt: new Date(), updatedAt: new Date() }
    this.scholarshipOptions.push(record); await this.audit.append({ actorAdminId, action: 'scholarship_option.created', resourceType: 'SCHOLARSHIP', metadata: { type: record.type, code: record.code } }, record.id); return { outcome: 'UPDATED' as const, record: { ...record } }
  }
  async updateScholarshipOption(id: string, input: Partial<Pick<ScholarshipOption, 'nameAr' | 'isActive' | 'sortOrder'>>, actorAdminId: string) {
    const record = this.scholarshipOptions.find((item) => item.id === id); if (!record) return { outcome: 'NOT_FOUND' as const }
    if (input.nameAr && this.scholarshipOptions.some((item) => item.id !== id && item.type === record.type && item.nameAr.trim() === input.nameAr!.trim())) return { outcome: 'CONFLICT' as const }
    Object.assign(record, input, { updatedAt: new Date() }); await this.audit.append({ actorAdminId, action: 'scholarship_option.updated', resourceType: 'SCHOLARSHIP', metadata: { changedFields: Object.keys(input).sort() } }, id); return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async create(
    resource: ContentResource,
    data: ContentWriteData,
    audit: AuditIntent,
  ) {
    const now = new Date()
    const record = {
      id: crypto.randomUUID(),
      featured: false,
      displayOrder: 0,
      status: 'DRAFT',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as ContentEntity
    await this.audit.append(audit, record.id)
    this.records.get(resource)?.push(record)
    return resource === 'articles' ? this.articleDetails(record, false) : record
  }

  async update(
    resource: ContentResource,
    id: string,
    data: ContentWriteData,
    audit: AuditIntent,
  ) {
    const records = this.records.get(resource) ?? []
    const index = records.findIndex((record) => record.id === id)
    const current = records[index]
    if (!current) throw new Error('Missing in-memory fixture.')
    const updated = { ...current, ...data, updatedAt: new Date() } as ContentEntity
    await this.audit.append(audit, id)
    records[index] = updated
    return resource === 'articles' ? this.articleDetails(updated, false) : updated
  }

  private articleDetails(record: ContentEntity, publicOnly: boolean): ContentEntity {
    const scholarshipIds = Array.isArray(record.scholarshipIds)
      ? record.scholarshipIds.filter((id): id is string => typeof id === 'string')
      : typeof record.scholarshipId === 'string' ? [record.scholarshipId] : []
    const scholarships = this.records.get('scholarships') ?? []
    const relatedScholarships = scholarshipIds.flatMap((id) => {
      const scholarship = scholarships.find((item) => item.id === id && (!publicOnly || item.status === 'PUBLISHED'))
      if (!scholarship) return []
      const country = typeof scholarship.countryId === 'string'
        ? (this.records.get('countries') ?? []).find((item) => item.id === scholarship.countryId)
        : null
      return [{
        id: scholarship.id,
        slug: scholarship.slug,
        titleAr: scholarship.titleAr,
        imageUrl: scholarship.imageUrl ?? null,
        applicationStatus: scholarship.applicationStatus,
        verifiedDeadline: scholarship.verifiedDeadline ?? null,
        country: country ? { id: country.id, slug: country.slug, nameAr: country.nameAr } : null,
      }]
    })
    return this.withRelationships('articles', { ...record, scholarshipIds, relatedScholarships })
  }

  private withRelationships(resource: ContentResource, record: ContentEntity): ContentEntity {
    const countries = this.records.get('countries') ?? []
    const universities = this.records.get('universities') ?? []
    const country = typeof record.countryId === 'string'
      ? countries.find((item) => item.id === record.countryId)
      : undefined
    const university = typeof record.universityId === 'string'
      ? universities.find((item) => item.id === record.universityId)
      : undefined
    return {
      ...record,
      ...(country ? { country: { id: country.id, slug: country.slug, nameAr: country.nameAr, countryCode: country.countryCode ?? null } } : {}),
      ...(university ? { university: { id: university.id, slug: university.slug, nameAr: university.nameAr } } : {}),
    }
  }
}
