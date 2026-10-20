import { ApiError } from '../shared/http.js'
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

const publicView = (record: ContentEntity, now: Date) => {
  const publicRecord: Record<string, unknown> = { ...record }
  delete publicRecord.status
  delete publicRecord.createdAt
  delete publicRecord.updatedAt
  delete publicRecord.country
  delete publicRecord.university
  delete publicRecord.scholarship
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
  if (!('applicationStatus' in record)) return record
  const deadline = record.verifiedDeadline
  return {
    ...record,
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

  async create(resource: ContentResource, input: ContentWriteData) {
    const status = input.status ?? 'DRAFT'
    const data: ContentWriteData = {
      ...input,
      status,
      publishedAt: status === 'PUBLISHED' ? this.now() : null,
    }
    this.normalizeDates(data)
    await this.validateWrite(resource, data)
    await this.ensureUniqueSlug(resource, String(data.slug))
    return adminView(await this.repository.create(resource, data), this.now())
  }

  async update(resource: ContentResource, id: string, input: ContentWriteData) {
    const current = await this.repository.findById(resource, id)
    if (!current) {
      throw new ApiError(404, 'CONTENT_NOT_FOUND', `${labels[resource]} not found.`)
    }

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
    await this.validateWrite(resource, next)
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
    return adminView(await this.repository.update(resource, id, data), this.now())
  }

  private normalizeDates(data: ContentWriteData) {
    if (typeof data.verifiedDeadline === 'string') {
      data.verifiedDeadline = new Date(data.verifiedDeadline)
    }
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

  private async validateWrite(resource: ContentResource, data: ContentWriteData) {
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

    const countryId = typeof data.countryId === 'string' ? data.countryId : null
    const universityId = typeof data.universityId === 'string' ? data.universityId : null
    const scholarshipId = typeof data.scholarshipId === 'string' ? data.scholarshipId : null

    const country = countryId
      ? await this.repository.findById('countries', countryId)
      : null
    if (countryId && !country) {
      throw relationError('countryId', 'Select an existing country.')
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

    if (scholarshipId) {
      const scholarship = await this.repository.findById('scholarships', scholarshipId)
      if (!scholarship) {
        throw relationError('scholarshipId', 'Select an existing scholarship.')
      }
    }

    if (resource === 'universities' && !countryId) {
      throw relationError('countryId', 'Every university must belong to a country.')
    }
  }
}
