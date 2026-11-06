import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
} from '../../src/content/types.js'
import type { AuditIntent } from '../../src/audit/types.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'
import type { InMemoryUniversityDirectoryRepository } from './in-memory-university-directory-repository.js'
import type { UniversityDirectoryFilters } from '../../src/university-directory/types.js'

const textIncludes = (value: unknown, search: string) =>
  typeof value === 'string' && value.toLocaleLowerCase().includes(search.toLocaleLowerCase())

export class InMemoryContentRepository implements ContentRepository {
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
      if (query.sort === 'manual') {
        return Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0) || left.id.localeCompare(right.id)
      }
      if (query.sort === 'name') {
        return String(left.nameAr).localeCompare(String(right.nameAr), 'ar') || left.id.localeCompare(right.id)
      }
      if (query.sort === 'deadline') {
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

  async create(
    resource: ContentResource,
    data: ContentWriteData,
    audit: AuditIntent,
  ) {
    const now = new Date()
    const record = {
      id: crypto.randomUUID(),
      featured: false,
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
