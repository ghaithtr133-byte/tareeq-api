import { ApiError } from '../shared/http.js'
import type {
  AdmissionRequirementInput,
  AdmissionRequirementRecord,
  AdmissionRequirementUpdate,
  DetailsListQuery,
  GalleryImageInput,
  GalleryImageUpdate,
  UniversityDetailsRepository,
} from './types.js'

const errorFor = (outcome: 'NOT_FOUND' | 'UNIVERSITY_NOT_FOUND' | 'PROGRAM_NOT_FOUND' | 'PROGRAM_UNIVERSITY_MISMATCH' | 'PUBLICATION_REQUIREMENTS' | 'GALLERY_LIMIT_REACHED') => ({
  NOT_FOUND: new ApiError(404, 'UNIVERSITY_DETAIL_NOT_FOUND', 'University detail entry not found.'),
  UNIVERSITY_NOT_FOUND: new ApiError(404, 'CONTENT_NOT_FOUND', 'University not found.'),
  PROGRAM_NOT_FOUND: new ApiError(400, 'UNIVERSITY_PROGRAM_NOT_FOUND', 'Select an existing University program.', { fields: { programId: ['Select an existing University program.'] } }),
  PROGRAM_UNIVERSITY_MISMATCH: new ApiError(400, 'PROGRAM_UNIVERSITY_MISMATCH', 'The selected program does not belong to this University.', { fields: { programId: ['Select a program belonging to this University.'] } }),
  PUBLICATION_REQUIREMENTS: new ApiError(400, 'PUBLICATION_REQUIREMENTS_NOT_MET', 'An official HTTPS source and verification time are required before publishing admission requirements.'),
  GALLERY_LIMIT_REACHED: new ApiError(409, 'GALLERY_ACTIVE_IMAGE_LIMIT_REACHED', 'A University can have at most 10 active gallery images.', { fields: { status: ['Archive an active image before adding or restoring another.'] } }),
})[outcome]

const publicRequirement = ({ id, scope, studyLevel, programId, contentAr, contentEn, officialSourceUrl, verifiedAt, publishedAt, program }: AdmissionRequirementRecord) => ({
  id, scope, studyLevel, programId, contentAr, contentEn, officialSourceUrl, verifiedAt, publishedAt, program: program ?? null,
})

export class UniversityDetailsService {
  constructor(private readonly repository: UniversityDetailsRepository, private readonly now: () => Date = () => new Date()) {}

  async publicAdmissionRequirements(slug: string) {
    const universityId = await this.publishedUniversity(slug)
    const result = await this.repository.listAdmissionRequirements(universityId, { page: 1, limit: 100 }, true)
    const items = result.items.map(publicRequirement)
    return {
      university: items.filter((item) => item.scope === 'UNIVERSITY'),
      studyLevels: items.filter((item) => item.scope === 'STUDY_LEVEL'),
      programs: items.filter((item) => item.scope === 'PROGRAM'),
    }
  }

  async adminAdmissionRequirements(universityId: string, query: DetailsListQuery) {
    await this.requireUniversity(universityId)
    return this.paginated(await this.repository.listAdmissionRequirements(universityId, query, false), query)
  }

  async createAdmissionRequirement(universityId: string, input: AdmissionRequirementInput, actorId: string) {
    this.validateAdmission(input)
    const result = await this.repository.createAdmissionRequirement(universityId, input, actorId, this.now())
    if (result.outcome !== 'UPDATED') throw errorFor(result.outcome)
    return result.record
  }

  async updateAdmissionRequirement(id: string, input: AdmissionRequirementUpdate, actorId: string) {
    if (input.officialSourceUrl) this.https(input.officialSourceUrl, 'officialSourceUrl')
    if (input.verifiedAt) this.notFuture(input.verifiedAt, 'verifiedAt')
    const result = await this.repository.updateAdmissionRequirement(id, input, actorId, this.now())
    if (result.outcome !== 'UPDATED') throw errorFor(result.outcome)
    return result.record
  }

  async publicGallery(slug: string) {
    const universityId = await this.publishedUniversity(slug)
    const result = await this.repository.listGallery(universityId, { page: 1, limit: 100 }, true)
    return { items: result.items.map(({ id, imageUrl, altAr, altEn, displayOrder, publishedAt }) => ({ id, imageUrl, altAr, altEn, displayOrder, publishedAt })) }
  }

  async adminGallery(universityId: string, query: DetailsListQuery) {
    await this.requireUniversity(universityId)
    return this.paginated(await this.repository.listGallery(universityId, query, false), query)
  }

  async createGalleryImage(universityId: string, input: GalleryImageInput, actorId: string) {
    this.https(input.imageUrl, 'imageUrl')
    const result = await this.repository.createGalleryImage(universityId, input, actorId, this.now())
    if (result.outcome !== 'UPDATED') throw errorFor(result.outcome)
    return result.record
  }

  async updateGalleryImage(id: string, input: GalleryImageUpdate, actorId: string) {
    if (input.imageUrl) this.https(input.imageUrl, 'imageUrl')
    const result = await this.repository.updateGalleryImage(id, input, actorId, this.now())
    if (result.outcome !== 'UPDATED') throw errorFor(result.outcome)
    return result.record
  }

  async reorderGallery(universityId: string, orderedIds: string[], actorId: string) {
    const result = await this.repository.reorderGallery(universityId, orderedIds, actorId)
    if (result.outcome === 'UNIVERSITY_NOT_FOUND') throw errorFor(result.outcome)
    if (result.outcome === 'ORDER_SET_MISMATCH') throw new ApiError(409, 'GALLERY_ORDER_SET_MISMATCH', 'Submit every non-archived gallery image exactly once.', { fields: { orderedIds: ['Refresh the gallery and retry with the complete active image set.'] } })
    if (result.outcome !== 'UPDATED') throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.')
    return { items: result.records }
  }

  async detachGalleryImage(id: string, actorId: string) {
    const result = await this.repository.detachGalleryImage(id, actorId)
    if (result.outcome !== 'UPDATED') throw errorFor(result.outcome)
    return result.record
  }

  private validateAdmission(input: AdmissionRequirementInput) {
    const validShape = input.scope === 'UNIVERSITY'
      ? input.studyLevel === null && input.programId === null
      : input.scope === 'STUDY_LEVEL'
        ? input.studyLevel !== null && input.programId === null
        : input.studyLevel === null && input.programId !== null
    if (!validShape) throw new ApiError(400, 'ADMISSION_SCOPE_INVALID', 'Requirement scope does not match its studyLevel/programId fields.')
    if (input.officialSourceUrl) this.https(input.officialSourceUrl, 'officialSourceUrl')
    if (input.verifiedAt) this.notFuture(input.verifiedAt, 'verifiedAt')
    if (input.status === 'PUBLISHED' && (!input.officialSourceUrl || !input.verifiedAt)) throw errorFor('PUBLICATION_REQUIREMENTS')
  }

  private async publishedUniversity(slug: string) {
    const id = await this.repository.resolvePublishedUniversity(slug)
    if (!id) throw errorFor('UNIVERSITY_NOT_FOUND')
    return id
  }

  private async requireUniversity(id: string) {
    if (!await this.repository.universityExists(id)) throw errorFor('UNIVERSITY_NOT_FOUND')
  }

  private https(value: string, field: string) {
    try { if (new URL(value).protocol !== 'https:') throw new Error('HTTPS required') } catch {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Use a valid HTTPS URL.', { fields: { [field]: ['Use a valid HTTPS URL.'] } })
    }
  }

  private notFuture(value: Date, field: string) {
    if (value.getTime() > this.now().getTime()) throw new ApiError(400, 'VALIDATION_ERROR', 'Verification time cannot be in the future.', { fields: { [field]: ['Use the actual verification time.'] } })
  }

  private paginated<T>(result: { items: T[]; total: number }, query: DetailsListQuery) {
    return { items: result.items, pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) } }
  }
}
