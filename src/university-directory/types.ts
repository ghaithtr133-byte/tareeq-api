import type { PublicationStatus } from '../content/types.js'

export const programStudyLevels = ['FOUNDATION', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD'] as const
export type ProgramStudyLevel = (typeof programStudyLevels)[number]

export const teachingLanguages = ['ARABIC', 'ENGLISH', 'FRENCH', 'GERMAN', 'TURKISH', 'ROMANIAN', 'RUSSIAN', 'SPANISH', 'ITALIAN'] as const
export type TeachingLanguage = (typeof teachingLanguages)[number]

export const universityTypes = ['PUBLIC', 'PRIVATE'] as const
export type UniversityType = (typeof universityTypes)[number]

export const programDurationUnits = ['MONTHS', 'YEARS'] as const
export type ProgramDurationUnit = (typeof programDurationUnits)[number]

export const tuitionBillingPeriods = ['YEAR', 'SEMESTER', 'FULL_PROGRAM'] as const
export type TuitionBillingPeriod = (typeof tuitionBillingPeriods)[number]

export type ProgramTuitionRecord = {
  id: string
  amount: string
  currency: string
  billingPeriod: TuitionBillingPeriod
  academicYear: string
  createdAt: Date
  updatedAt: Date
}

export type ProgramTuitionInput = Pick<ProgramTuitionRecord, 'amount' | 'currency' | 'billingPeriod' | 'academicYear'>

export type AcademicMajorRecord = {
  id: string
  slug: string
  nameAr: string
  nameEn: string
  category: string | null
  createdAt: Date
  updatedAt: Date
}

export type CityRecord = {
  id: string
  countryId: string
  slug: string
  nameAr: string
  nameEn: string
  createdAt: Date
  updatedAt: Date
  country?: { id: string; slug: string; nameAr: string; nameEn: string | null }
}

export type UniversityProgramRecord = {
  id: string
  universityId: string
  academicMajorId: string
  nameAr: string | null
  nameEn: string | null
  facultyNameAr: string | null
  facultyNameEn: string | null
  durationValue: number | null
  durationUnit: ProgramDurationUnit | null
  studyLevel: ProgramStudyLevel
  languages: TeachingLanguage[]
  status: PublicationStatus
  officialSourceUrl: string
  verifiedAt: Date
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  tuitionFees: ProgramTuitionRecord[]
  academicMajor: Pick<AcademicMajorRecord, 'id' | 'slug' | 'nameAr' | 'nameEn' | 'category'>
}

export type UniversityDirectoryFilters = {
  search?: string
  country?: string
  featured?: boolean
  major?: string
  studyLevel?: ProgramStudyLevel
  language?: TeachingLanguage
  city?: string
  universityType?: UniversityType
}

export type ProgramCreateInput = {
  universityId: string
  academicMajorId: string
  nameAr: string
  nameEn?: string | null
  facultyNameAr?: string | null
  facultyNameEn?: string | null
  durationValue?: number | null
  durationUnit?: ProgramDurationUnit | null
  studyLevel: ProgramStudyLevel
  languages: TeachingLanguage[]
  status: PublicationStatus
  officialSourceUrl: string
  verifiedAt: Date
  tuition?: ProgramTuitionInput
}

export type ProgramUpdateInput = Partial<Omit<ProgramCreateInput, 'universityId'>>

export type ProgramListQuery = {
  page: number
  limit: number
  search?: string
  studyLevel?: ProgramStudyLevel
  language?: TeachingLanguage
  faculty?: string
  status?: PublicationStatus
}

export type CatalogListQuery = {
  page: number
  limit: number
  search?: string
  countryId?: string
}

export type FacetOption = { value: string; count: number }
export type FilterOptions = {
  majors: Array<FacetOption & Pick<AcademicMajorRecord, 'id' | 'slug' | 'nameAr' | 'nameEn' | 'category'>>
  studyLevels: FacetOption[]
  languages: FacetOption[]
  cities: Array<FacetOption & Pick<CityRecord, 'id' | 'slug' | 'nameAr' | 'nameEn' | 'countryId'>>
  universityTypes: FacetOption[]
}

export type MutationResult<T> =
  | { outcome: 'UPDATED'; record: T }
  | { outcome: 'NOT_FOUND' | 'UNIVERSITY_NOT_FOUND' | 'MAJOR_NOT_FOUND' | 'COUNTRY_NOT_FOUND' | 'CONFLICT' | 'PUBLICATION_REQUIREMENTS' }

export interface UniversityDirectoryRepository {
  resolvePublishedUniversity(slug: string): Promise<string | null>
  universityExists(id: string): Promise<boolean>
  majorExists(id: string): Promise<boolean>
  listPrograms(universityId: string, query: ProgramListQuery, publicOnly: boolean): Promise<{ items: UniversityProgramRecord[]; total: number }>
  createProgram(input: ProgramCreateInput, actorAdminId: string, now: Date): Promise<MutationResult<UniversityProgramRecord>>
  updateProgram(id: string, input: ProgramUpdateInput, actorAdminId: string, now: Date): Promise<MutationResult<UniversityProgramRecord>>
  filterOptions(filters: UniversityDirectoryFilters): Promise<FilterOptions>
  listMajors(query: CatalogListQuery): Promise<{ items: AcademicMajorRecord[]; total: number }>
  createMajor(input: Pick<AcademicMajorRecord, 'slug' | 'nameAr' | 'nameEn' | 'category'>, actorAdminId: string): Promise<MutationResult<AcademicMajorRecord>>
  listCities(query: CatalogListQuery): Promise<{ items: CityRecord[]; total: number }>
  createCity(input: Pick<CityRecord, 'countryId' | 'slug' | 'nameAr' | 'nameEn'>, actorAdminId: string): Promise<MutationResult<CityRecord>>
}
