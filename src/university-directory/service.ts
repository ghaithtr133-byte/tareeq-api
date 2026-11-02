import { ApiError } from '../shared/http.js'
import type {
  AcademicMajorRecord,
  CatalogListQuery,
  CityRecord,
  ProgramCreateInput,
  ProgramListQuery,
  ProgramUpdateInput,
  UniversityDirectoryFilters,
  UniversityDirectoryRepository,
  UniversityProgramRecord,
} from './types.js'

const mutationError = (outcome: Exclude<Awaited<ReturnType<UniversityDirectoryRepository['createProgram']>>['outcome'], 'UPDATED'>) => ({
  NOT_FOUND: new ApiError(404, 'UNIVERSITY_PROGRAM_NOT_FOUND', 'University program not found.'),
  UNIVERSITY_NOT_FOUND: new ApiError(400, 'UNIVERSITY_NOT_FOUND', 'Select an existing university.', { fields: { universityId: ['Select an existing university.'] } }),
  MAJOR_NOT_FOUND: new ApiError(400, 'ACADEMIC_MAJOR_NOT_FOUND', 'Select an existing academic major.', { fields: { academicMajorId: ['Select an existing academic major.'] } }),
  COUNTRY_NOT_FOUND: new ApiError(400, 'COUNTRY_NOT_FOUND', 'Select an existing country.', { fields: { countryId: ['Select an existing country.'] } }),
  CONFLICT: new ApiError(409, 'DIRECTORY_SLUG_OR_PROGRAM_CONFLICT', 'The slug or university program already exists.'),
  PUBLICATION_REQUIREMENTS: new ApiError(400, 'PROGRAM_PUBLICATION_REQUIREMENTS_NOT_MET', 'A localized program name, teaching language, official source, and verification date are required before publication.'),
})[outcome]

const publicProgram = (record: UniversityProgramRecord) => ({
  id: record.id,
  nameAr: record.nameAr,
  nameEn: record.nameEn,
  facultyNameAr: record.facultyNameAr,
  facultyNameEn: record.facultyNameEn,
  durationValue: record.durationValue,
  durationUnit: record.durationUnit,
  academicMajor: record.academicMajor,
  studyLevel: record.studyLevel,
  languages: record.languages,
  officialSourceUrl: record.officialSourceUrl,
  verifiedAt: record.verifiedAt,
  publishedAt: record.publishedAt,
  tuition: record.tuitionFees[0] ?? null,
  tuitionFees: record.tuitionFees,
})

const adminProgram = (record: UniversityProgramRecord) => ({
  ...record,
  tuition: record.tuitionFees[0] ?? null,
})

export class UniversityDirectoryService {
  constructor(
    private readonly repository: UniversityDirectoryRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listPublicPrograms(slug: string, query: ProgramListQuery) {
    const universityId = await this.repository.resolvePublishedUniversity(slug)
    if (!universityId) throw new ApiError(404, 'CONTENT_NOT_FOUND', 'University not found.')
    const result = await this.repository.listPrograms(universityId, query, true)
    return this.paginated(result.items.map(publicProgram), result.total, query.page, query.limit)
  }

  async listAdminPrograms(universityId: string, query: ProgramListQuery) {
    if (!await this.repository.universityExists(universityId)) throw mutationError('UNIVERSITY_NOT_FOUND')
    const result = await this.repository.listPrograms(universityId, query, false)
    return this.paginated(result.items.map(adminProgram), result.total, query.page, query.limit)
  }

  async createProgram(input: ProgramCreateInput, actorAdminId: string) {
    this.validateProgram(input)
    const result = await this.repository.createProgram(input, actorAdminId, this.now())
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return adminProgram(result.record)
  }

  async updateProgram(id: string, input: ProgramUpdateInput, actorAdminId: string) {
    if (input.languages && input.languages.length === 0) {
      throw new ApiError(400, 'PROGRAM_LANGUAGES_REQUIRED', 'At least one teaching language is required.', {
        fields: { languages: ['Select at least one teaching language.'] },
      })
    }
    if (input.officialSourceUrl) this.validateSource(input.officialSourceUrl)
    if (input.verifiedAt) this.validateVerifiedAt(input.verifiedAt)
    const result = await this.repository.updateProgram(id, input, actorAdminId, this.now())
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return adminProgram(result.record)
  }

  filterOptions(filters: UniversityDirectoryFilters) {
    return this.repository.filterOptions(filters)
  }

  async listMajors(query: CatalogListQuery) {
    const result = await this.repository.listMajors(query)
    return this.paginated(result.items, result.total, query.page, query.limit)
  }

  async createMajor(input: Pick<AcademicMajorRecord, 'slug' | 'nameAr' | 'nameEn' | 'category'>, actorAdminId: string) {
    const result = await this.repository.createMajor(input, actorAdminId)
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return result.record
  }

  async listCities(query: CatalogListQuery) {
    const result = await this.repository.listCities(query)
    return this.paginated(result.items, result.total, query.page, query.limit)
  }

  async createCity(input: Pick<CityRecord, 'countryId' | 'slug' | 'nameAr' | 'nameEn'>, actorAdminId: string) {
    const result = await this.repository.createCity(input, actorAdminId)
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return result.record
  }

  private validateProgram(input: ProgramCreateInput) {
    if (input.languages.length === 0) {
      throw new ApiError(400, 'PROGRAM_LANGUAGES_REQUIRED', 'At least one teaching language is required.', {
        fields: { languages: ['Select at least one teaching language.'] },
      })
    }
    this.validateSource(input.officialSourceUrl)
    this.validateVerifiedAt(input.verifiedAt)
  }

  private validateSource(value: string) {
    try {
      if (new URL(value).protocol !== 'https:') throw new Error('HTTPS required')
    } catch {
      throw new ApiError(400, 'PROGRAM_SOURCE_INVALID', 'Use a valid HTTPS official source URL.', {
        fields: { officialSourceUrl: ['Use an HTTPS URL controlled by the official institution or program source.'] },
      })
    }
  }

  private validateVerifiedAt(value: Date) {
    if (value.getTime() > this.now().getTime()) {
      throw new ApiError(400, 'PROGRAM_VERIFICATION_INVALID', 'Verification time cannot be in the future.', {
        fields: { verifiedAt: ['Use the time when the official source was actually verified.'] },
      })
    }
  }

  private paginated<T>(items: T[], total: number, page: number, limit: number) {
    return { items, pagination: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) } }
  }
}
