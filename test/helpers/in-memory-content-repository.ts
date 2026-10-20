import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
} from '../../src/content/types.js'

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
    if (query.studyLevel) {
      records = records.filter((record) => record.studyLevel === query.studyLevel)
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
    return { items: records.slice(offset, offset + query.limit), total }
  }

  async findById(resource: ContentResource, id: string) {
    return this.records.get(resource)?.find((record) => record.id === id) ?? null
  }

  async findBySlug(resource: ContentResource, slug: string, publicOnly: boolean) {
    return this.records.get(resource)?.find(
      (record) => record.slug === slug && (!publicOnly || record.status === 'PUBLISHED'),
    ) ?? null
  }

  async create(resource: ContentResource, data: ContentWriteData) {
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
    this.records.get(resource)?.push(record)
    return record
  }

  async update(resource: ContentResource, id: string, data: ContentWriteData) {
    const records = this.records.get(resource) ?? []
    const index = records.findIndex((record) => record.id === id)
    const current = records[index]
    if (!current) throw new Error('Missing in-memory fixture.')
    const updated = { ...current, ...data, updatedAt: new Date() } as ContentEntity
    records[index] = updated
    return updated
  }
}
