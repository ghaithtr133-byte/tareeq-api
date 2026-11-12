import type { AuditIntent } from '../audit/types.js'
import type { ConfirmedDeletionExecution, DeletionChallengeIssue, DeletionExecution, DeletionImpact } from './deletion-impact.js'

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
  major?: string
  language?: string
  city?: string
  universityType?: 'PUBLIC' | 'PRIVATE'
  universitySearch?: string
  universityCountry?: string
  universityMajor?: string
  universityStudyLevel?: 'FOUNDATION' | 'DIPLOMA' | 'BACHELORS' | 'MASTERS' | 'PHD'
  universityLanguage?: 'ARABIC' | 'ENGLISH' | 'FRENCH' | 'GERMAN' | 'TURKISH' | 'ROMANIAN' | 'RUSSIAN' | 'SPANISH' | 'ITALIAN'
  universityCity?: string
  universityFeatured?: boolean
  sort?: string
}

export type CityReference = { id: string; countryId: string; slug: string }

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
  findCityById(id: string): Promise<CityReference | null>
  countScholarshipsByIds(ids: string[]): Promise<number>
  scholarshipFilterOptions(): Promise<{ studyLevels: Array<{ value: string; count: number }>; fundingTypes: Array<{ value: string; count: number }> }>
  reorder(resource: ContentResource, orderedIds: string[], actorAdminId: string): Promise<{ outcome: 'UPDATED'; records: ContentEntity[] } | { outcome: 'ORDER_SET_MISMATCH' }>
  deletionImpact(resource: ContentResource, id: string): Promise<DeletionImpact | null>
  deleteIfSafe(resource: ContentResource, id: string, actorAdminId: string): Promise<DeletionExecution>
  issueDeletionChallenge(resource: ContentResource, id: string, actorAdminId: string, expiresAt: Date): Promise<DeletionChallengeIssue>
  confirmHardDelete(resource: ContentResource, id: string, challengeId: string, actorAdminId: string, now: Date): Promise<ConfirmedDeletionExecution>
  create(
    resource: ContentResource,
    data: ContentWriteData,
    audit: AuditIntent,
  ): Promise<ContentEntity>
  update(
    resource: ContentResource,
    id: string,
    data: ContentWriteData,
    audit: AuditIntent,
  ): Promise<ContentEntity>
}
