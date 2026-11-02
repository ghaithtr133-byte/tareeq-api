import type {
  AdmissionRequirementInput,
  AdmissionRequirementRecord,
  AdmissionRequirementUpdate,
  DetailsListQuery,
  GalleryImageInput,
  GalleryImageRecord,
  GalleryImageUpdate,
  UniversityDetailsRepository,
} from '../../src/university-details/types.js'
import { InMemoryAuditRepository } from './in-memory-audit-repository.js'

export class InMemoryUniversityDetailsRepository implements UniversityDetailsRepository {
  readonly universities: Array<{ id: string; slug: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }> = []
  readonly programs: Array<{ id: string; universityId: string; nameAr: string | null; nameEn: string | null; studyLevel: 'FOUNDATION' | 'DIPLOMA' | 'BACHELORS' | 'MASTERS' | 'PHD' }> = []
  readonly requirements: AdmissionRequirementRecord[] = []
  readonly images: GalleryImageRecord[] = []

  constructor(readonly audit = new InMemoryAuditRepository()) {}

  async resolvePublishedUniversity(slug: string) { return this.universities.find((item) => item.slug === slug && item.status === 'PUBLISHED')?.id ?? null }
  async universityExists(id: string) { return this.universities.some((item) => item.id === id) }

  async listAdmissionRequirements(universityId: string, query: DetailsListQuery, publicOnly: boolean) {
    const items = this.requirements.filter((item) => item.universityId === universityId && (!query.status || item.status === query.status) && (!query.scope || item.scope === query.scope) && (!publicOnly || item.status === 'PUBLISHED')).sort((a, b) => a.scope.localeCompare(b.scope) || (a.studyLevel ?? '').localeCompare(b.studyLevel ?? '') || a.id.localeCompare(b.id))
    return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit).map((item) => ({ ...item, program: item.program ? { ...item.program } : null })), total: items.length }
  }

  async createAdmissionRequirement(universityId: string, input: AdmissionRequirementInput, actorAdminId: string, now: Date) {
    if (!await this.universityExists(universityId)) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
    const program = input.programId ? this.programs.find(({ id }) => id === input.programId) : null
    if (input.programId && !program) return { outcome: 'PROGRAM_NOT_FOUND' as const }
    if (program && program.universityId !== universityId) return { outcome: 'PROGRAM_UNIVERSITY_MISMATCH' as const }
    if (input.status === 'PUBLISHED' && (!input.officialSourceUrl || !input.verifiedAt)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
    const record: AdmissionRequirementRecord = { ...input, id: crypto.randomUUID(), universityId, publishedAt: input.status === 'PUBLISHED' ? now : null, createdAt: now, updatedAt: now, program: program ? { id: program.id, nameAr: program.nameAr, nameEn: program.nameEn, studyLevel: program.studyLevel } : null }
    await this.audit.append({ actorAdminId, action: 'university_admission_requirement.created', resourceType: 'UNIVERSITY_ADMISSION_REQUIREMENT', metadata: { universityId, scope: input.scope, studyLevel: input.studyLevel, programId: input.programId, status: input.status } }, record.id)
    this.requirements.push(record)
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async updateAdmissionRequirement(id: string, input: AdmissionRequirementUpdate, actorAdminId: string, now: Date) {
    const index = this.requirements.findIndex((item) => item.id === id)
    const current = this.requirements[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    const nextStatus = input.status ?? current.status
    const source = input.officialSourceUrl === undefined ? current.officialSourceUrl : input.officialSourceUrl
    const verified = input.verifiedAt === undefined ? current.verifiedAt : input.verifiedAt
    if (nextStatus === 'PUBLISHED' && (!source || !verified)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
    const record = { ...current, ...input, publishedAt: nextStatus === 'PUBLISHED' && !current.publishedAt ? now : current.publishedAt, updatedAt: now }
    await this.audit.append({ actorAdminId, action: 'university_admission_requirement.updated', resourceType: 'UNIVERSITY_ADMISSION_REQUIREMENT', metadata: { universityId: current.universityId, scope: current.scope, changedFields: Object.keys(input).sort() } }, id)
    this.requirements[index] = record
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async listGallery(universityId: string, query: DetailsListQuery, publicOnly: boolean) {
    const items = this.images.filter((item) => item.universityId === universityId && (!query.status || item.status === query.status) && (!publicOnly || item.status === 'PUBLISHED')).sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
    return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit).map((item) => ({ ...item })), total: items.length }
  }

  async createGalleryImage(universityId: string, input: GalleryImageInput, actorAdminId: string, now: Date) {
    if (!await this.universityExists(universityId)) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
    const displayOrder = Math.max(-1, ...this.images.filter((item) => item.universityId === universityId && item.status !== 'ARCHIVED').map((item) => item.displayOrder)) + 1
    const record: GalleryImageRecord = { ...input, id: crypto.randomUUID(), universityId, displayOrder, publishedAt: input.status === 'PUBLISHED' ? now : null, createdAt: now, updatedAt: now }
    await this.audit.append({ actorAdminId, action: 'university_gallery_image.attached', resourceType: 'UNIVERSITY_GALLERY_IMAGE', metadata: { universityId, status: input.status, displayOrder } }, record.id)
    this.images.push(record)
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async updateGalleryImage(id: string, input: GalleryImageUpdate, actorAdminId: string, now: Date) {
    const index = this.images.findIndex((item) => item.id === id)
    const current = this.images[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    const nextStatus = input.status ?? current.status
    const record = { ...current, ...input, publishedAt: nextStatus === 'PUBLISHED' && !current.publishedAt ? now : current.publishedAt, updatedAt: now }
    await this.audit.append({ actorAdminId, action: 'university_gallery_image.updated', resourceType: 'UNIVERSITY_GALLERY_IMAGE', metadata: { universityId: current.universityId, changedFields: Object.keys(input).sort() } }, id)
    this.images[index] = record
    return { outcome: 'UPDATED' as const, record: { ...record } }
  }

  async reorderGallery(universityId: string, orderedIds: string[], actorAdminId: string) {
    if (!await this.universityExists(universityId)) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
    const expected = this.images.filter((item) => item.universityId === universityId && item.status !== 'ARCHIVED').map(({ id }) => id).sort()
    if (expected.length !== orderedIds.length || expected.some((id, index) => id !== [...orderedIds].sort()[index])) return { outcome: 'ORDER_SET_MISMATCH' as const }
    await this.audit.append({ actorAdminId, action: 'university_gallery.reordered', resourceType: 'UNIVERSITY', metadata: { imageCount: orderedIds.length } }, universityId)
    orderedIds.forEach((id, displayOrder) => { const image = this.images.find((item) => item.id === id)!; image.displayOrder = displayOrder })
    return { outcome: 'UPDATED' as const, records: orderedIds.map((id) => ({ ...this.images.find((item) => item.id === id)! })) }
  }

  async detachGalleryImage(id: string, actorAdminId: string) {
    const index = this.images.findIndex((item) => item.id === id)
    const current = this.images[index]
    if (!current) return { outcome: 'NOT_FOUND' as const }
    await this.audit.append({ actorAdminId, action: 'university_gallery_image.detached', resourceType: 'UNIVERSITY_GALLERY_IMAGE', metadata: { universityId: current.universityId, displayOrder: current.displayOrder } }, id)
    this.images.splice(index, 1)
    return { outcome: 'UPDATED' as const, record: { id } }
  }
}
