import type { PublicationStatus } from '../../src/content/types.js'
import type {
  AcademicMajorRecord,
  CatalogListQuery,
  CityRecord,
  FilterOptions,
  ProgramCreateInput,
  ProgramListQuery,
  ProgramUpdateInput,
  UniversityDirectoryFilters,
  UniversityDirectoryRepository,
  UniversityProgramRecord,
  UniversityType,
} from '../../src/university-directory/types.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'

export type UniversityDirectoryFixture = {
  id: string
  slug: string
  status: PublicationStatus
  nameAr: string
  nameEn?: string | null
  officialName: string
  cityAr: string
  countrySlug: string
  featured: boolean
  cityId: string | null
  universityType: UniversityType | null
}

const copyProgram = (record: UniversityProgramRecord): UniversityProgramRecord => ({
  ...record,
  languages: [...record.languages],
  tuitionFees: record.tuitionFees.map((fee) => ({ ...fee })),
  academicMajor: { ...record.academicMajor },
})
const textIncludes = (value: string | null | undefined, search: string) => value?.toLowerCase().includes(search.toLowerCase()) ?? false

export class InMemoryUniversityDirectoryRepository implements UniversityDirectoryRepository {
  readonly majors: AcademicMajorRecord[] = []
  readonly cities: CityRecord[] = []
  readonly programs: UniversityProgramRecord[] = []
  readonly universities: UniversityDirectoryFixture[] = []
  readonly countryIds = new Set<string>()

  constructor(
    readonly audit = new InMemoryAuditRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  addCountry(id: string) { this.countryIds.add(id) }
  addUniversity(fixture: UniversityDirectoryFixture) { this.universities.push({ ...fixture }) }
  findCity(id: string) { return this.cities.find((city) => city.id === id) ?? null }

  async resolvePublishedUniversity(slug: string) {
    return this.universities.find((university) => university.slug === slug && university.status === 'PUBLISHED')?.id ?? null
  }
  async universityExists(id: string) { return this.universities.some((university) => university.id === id) }
  async majorExists(id: string) { return this.majors.some((major) => major.id === id) }

  async listPrograms(universityId: string, query: ProgramListQuery, publicOnly: boolean) {
    const university = this.universities.find(({ id }) => id === universityId)
    const items = this.programs.filter((program) =>
      program.universityId === universityId &&
      (!query.status || program.status === query.status) &&
      (!query.studyLevel || program.studyLevel === query.studyLevel) &&
      (!query.language || program.languages.includes(query.language)) &&
      (!query.faculty || textIncludes(program.facultyNameAr, query.faculty) || textIncludes(program.facultyNameEn, query.faculty)) &&
      (!query.search || [program.nameAr, program.nameEn, program.academicMajor.nameAr, program.academicMajor.nameEn].some((value) => textIncludes(value, query.search!))) &&
      (!publicOnly || (university?.status === 'PUBLISHED' && program.status === 'PUBLISHED')),
    ).sort((left, right) => (left.nameAr ?? '').localeCompare(right.nameAr ?? '', 'ar') || left.academicMajor.nameAr.localeCompare(right.academicMajor.nameAr, 'ar') || left.studyLevel.localeCompare(right.studyLevel) || left.id.localeCompare(right.id))
    const total = items.length
    return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit).map(copyProgram), total }
  }

  async createProgram(input: ProgramCreateInput, actorAdminId: string, now: Date) {
    if (!await this.universityExists(input.universityId)) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
    const major = this.majors.find(({ id }) => id === input.academicMajorId)
    if (!major) return { outcome: 'MAJOR_NOT_FOUND' as const }
    if (this.programs.some((program) => program.universityId === input.universityId && program.academicMajorId === input.academicMajorId && program.studyLevel === input.studyLevel && program.nameAr === input.nameAr)) return { outcome: 'CONFLICT' as const }
    const { tuition, ...programInput } = input
    const record: UniversityProgramRecord = {
      ...programInput,
      id: crypto.randomUUID(),
      nameEn: input.nameEn ?? null,
      facultyNameAr: input.facultyNameAr ?? null,
      facultyNameEn: input.facultyNameEn ?? null,
      durationValue: input.durationValue ?? null,
      durationUnit: input.durationUnit ?? null,
      languages: [...input.languages].sort(),
      tuitionFees: tuition ? [{ ...tuition, id: crypto.randomUUID(), createdAt: now, updatedAt: now }] : [],
      publishedAt: input.status === 'PUBLISHED' ? now : null,
      createdAt: now,
      updatedAt: now,
      academicMajor: { id: major.id, slug: major.slug, nameAr: major.nameAr, nameEn: major.nameEn, category: major.category },
    }
    await this.audit.append({ actorAdminId, action: 'university_program.created', resourceType: 'UNIVERSITY_PROGRAM', metadata: { universityId: input.universityId, academicMajorId: input.academicMajorId, studyLevel: input.studyLevel, languageCount: input.languages.length, status: input.status } }, record.id)
    this.programs.push(record)
    return { outcome: 'UPDATED' as const, record: copyProgram(record) }
  }

  async updateProgram(id: string, input: ProgramUpdateInput, actorAdminId: string, now: Date) {
    const index = this.programs.findIndex((program) => program.id === id)
    const current = this.programs[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    const major = input.academicMajorId ? this.majors.find((item) => item.id === input.academicMajorId) : this.majors.find((item) => item.id === current.academicMajorId)
    if (!major) return { outcome: 'MAJOR_NOT_FOUND' as const }
    const nextStatus = input.status ?? current.status
    if (nextStatus === 'PUBLISHED' && !(input.nameAr ?? current.nameAr)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
    const tuitionFees = input.tuition
      ? [...current.tuitionFees.filter((fee) => fee.academicYear !== input.tuition!.academicYear), { ...input.tuition, id: current.tuitionFees.find((fee) => fee.academicYear === input.tuition!.academicYear)?.id ?? crypto.randomUUID(), createdAt: current.tuitionFees.find((fee) => fee.academicYear === input.tuition!.academicYear)?.createdAt ?? now, updatedAt: now }].sort((a, b) => b.academicYear.localeCompare(a.academicYear))
      : current.tuitionFees
    const updated: UniversityProgramRecord = {
      ...current,
      ...input,
      languages: input.languages ? [...input.languages].sort() : current.languages,
      tuitionFees,
      academicMajor: { id: major.id, slug: major.slug, nameAr: major.nameAr, nameEn: major.nameEn, category: major.category },
      publishedAt: nextStatus === 'PUBLISHED' && current.publishedAt === null ? now : current.publishedAt,
      updatedAt: now,
    }
    if (this.programs.some((program) => program.id !== id && program.universityId === updated.universityId && program.academicMajorId === updated.academicMajorId && program.studyLevel === updated.studyLevel && program.nameAr === updated.nameAr)) return { outcome: 'CONFLICT' as const }
    const action = nextStatus === 'ARCHIVED' && current.status !== 'ARCHIVED' ? 'university_program.archived'
      : nextStatus === 'PUBLISHED' && current.status !== 'PUBLISHED' ? 'university_program.published'
        : current.status === 'PUBLISHED' && nextStatus !== 'PUBLISHED' ? 'university_program.unpublished' : 'university_program.updated'
    await this.audit.append({ actorAdminId, action, resourceType: 'UNIVERSITY_PROGRAM', metadata: { universityId: current.universityId, academicMajorId: updated.academicMajorId, changedFields: Object.keys(input).sort(), ...(current.status !== nextStatus ? { fromStatus: current.status, toStatus: nextStatus } : {}) } }, id)
    this.programs[index] = updated
    return { outcome: 'UPDATED' as const, record: copyProgram(updated) }
  }

  matchesUniversity(universityId: string, filters: UniversityDirectoryFilters) {
    const university = this.universities.find(({ id }) => id === universityId)
    if (!university || university.status !== 'PUBLISHED') return false
    if (filters.search && ![university.nameAr, university.nameEn, university.officialName, university.cityAr].some((value) => textIncludes(value, filters.search!))) return false
    if (filters.country && university.countrySlug !== filters.country) return false
    if (filters.featured !== undefined && university.featured !== filters.featured) return false
    if (filters.city && this.cities.find((city) => city.id === university.cityId)?.slug !== filters.city) return false
    if (filters.universityType && university.universityType !== filters.universityType) return false
    if (filters.major || filters.studyLevel || filters.language) {
      return this.programs.some((program) =>
        program.universityId === universityId && program.status === 'PUBLISHED' &&
        (!filters.major || program.academicMajor.slug === filters.major) &&
        (!filters.studyLevel || program.studyLevel === filters.studyLevel) &&
        (!filters.language || program.languages.includes(filters.language)),
      )
    }
    return true
  }

  async filterOptions(filters: UniversityDirectoryFilters): Promise<FilterOptions> {
    const publishedPrograms = this.programs.filter((program) => program.status === 'PUBLISHED' && this.universities.some((university) => university.id === program.universityId && university.status === 'PUBLISHED'))
    const count = (candidate: UniversityDirectoryFilters) => new Set(this.universities.filter((university) => this.matchesUniversity(university.id, candidate)).map(({ id }) => id)).size
    const without = <K extends keyof UniversityDirectoryFilters>(key: K) => {
      const result = { ...filters }
      delete result[key]
      return result
    }
    const majorIds = [...new Set(publishedPrograms.map(({ academicMajorId }) => academicMajorId))]
    const levels = [...new Set(publishedPrograms.map(({ studyLevel }) => studyLevel))].sort()
    const languages = [...new Set(publishedPrograms.flatMap(({ languages: values }) => values))].sort()
    const cities = this.cities.filter((city) => this.universities.some((university) => university.cityId === city.id && university.status === 'PUBLISHED'))
    const types = [...new Set(this.universities.filter(({ status, universityType }) => status === 'PUBLISHED' && universityType).map(({ universityType }) => universityType!))].sort()
    return {
      majors: majorIds.flatMap((id) => {
        const major = this.majors.find((item) => item.id === id)!
        const optionCount = count({ ...without('major'), major: major.slug })
        return optionCount > 0 ? [{ id: major.id, slug: major.slug, nameAr: major.nameAr, nameEn: major.nameEn, category: major.category, value: major.slug, count: optionCount }] : []
      }),
      studyLevels: levels.flatMap((value) => { const optionCount = count({ ...without('studyLevel'), studyLevel: value }); return optionCount > 0 ? [{ value, count: optionCount }] : [] }),
      languages: languages.flatMap((value) => { const optionCount = count({ ...without('language'), language: value }); return optionCount > 0 ? [{ value, count: optionCount }] : [] }),
      cities: cities.flatMap((city) => { const optionCount = count({ ...without('city'), city: city.slug }); return optionCount > 0 ? [{ id: city.id, countryId: city.countryId, slug: city.slug, nameAr: city.nameAr, nameEn: city.nameEn, value: city.slug, count: optionCount }] : [] }),
      universityTypes: types.flatMap((value) => { const optionCount = count({ ...without('universityType'), universityType: value }); return optionCount > 0 ? [{ value, count: optionCount }] : [] }),
    }
  }

  async listMajors(query: CatalogListQuery) {
    const items = this.majors.filter((major) => !query.search || [major.slug, major.nameAr, major.nameEn, major.category].some((value) => textIncludes(value, query.search!))).sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar') || a.id.localeCompare(b.id))
    return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit), total: items.length }
  }
  async createMajor(input: Pick<AcademicMajorRecord, 'slug' | 'nameAr' | 'nameEn' | 'category'>, actorAdminId: string) {
    if (this.majors.some(({ slug }) => slug === input.slug)) return { outcome: 'CONFLICT' as const }
    const record = { ...input, id: crypto.randomUUID(), createdAt: this.now(), updatedAt: this.now() }
    await this.audit.append({ actorAdminId, action: 'academic_major.created', resourceType: 'ACADEMIC_MAJOR', metadata: { slug: record.slug, category: record.category } }, record.id)
    this.majors.push(record)
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }
  async listCities(query: CatalogListQuery) {
    const items = this.cities.filter((city) => (!query.countryId || city.countryId === query.countryId) && (!query.search || [city.slug, city.nameAr, city.nameEn].some((value) => textIncludes(value, query.search!)))).sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar') || a.id.localeCompare(b.id))
    return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit), total: items.length }
  }
  async createCity(input: Pick<CityRecord, 'countryId' | 'slug' | 'nameAr' | 'nameEn'>, actorAdminId: string) {
    if (!this.countryIds.has(input.countryId)) return { outcome: 'COUNTRY_NOT_FOUND' as const }
    if (this.cities.some(({ slug }) => slug === input.slug)) return { outcome: 'CONFLICT' as const }
    const record = { ...input, id: crypto.randomUUID(), createdAt: this.now(), updatedAt: this.now() }
    await this.audit.append({ actorAdminId, action: 'city.created', resourceType: 'CITY', metadata: { countryId: record.countryId, slug: record.slug } }, record.id)
    this.cities.push(record)
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }
}
