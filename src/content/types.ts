export const contentResources = [
  'countries',
  'universities',
  'scholarships',
  'services',
  'articles',
] as const

export type ContentResource = (typeof contentResources)[number]
export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type ScholarshipApplicationStatus = 'OPEN' | 'CLOSED'

export type ContentEntity = {
  id: string
  slug: string
  status: PublicationStatus
  featured: boolean
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  [key: string]: unknown
}

export type ContentWriteData = Record<string, unknown> & {
  slug?: string
  status?: PublicationStatus
}

export type ContentListQuery = {
  page: number
  limit: number
  search?: string
  featured?: boolean
  status?: PublicationStatus
  country?: string
  university?: string
  studyLevel?: string
  fundingType?: string
  applicationStatus?: ScholarshipApplicationStatus
  sort?: string
}

export type ContentListResult = {
  items: ContentEntity[]
  total: number
}

export interface ContentRepository {
  list(
    resource: ContentResource,
    query: ContentListQuery,
    publicOnly: boolean,
    now: Date,
  ): Promise<ContentListResult>
  findById(resource: ContentResource, id: string): Promise<ContentEntity | null>
  findBySlug(
    resource: ContentResource,
    slug: string,
    publicOnly: boolean,
  ): Promise<ContentEntity | null>
  create(
    resource: ContentResource,
    data: ContentWriteData,
  ): Promise<ContentEntity>
  update(
    resource: ContentResource,
    id: string,
    data: ContentWriteData,
  ): Promise<ContentEntity>
}
