import type { PublicationStatus } from '../content/types.js'
import type { ProgramStudyLevel } from '../university-directory/types.js'

export const admissionRequirementScopes = ['UNIVERSITY', 'STUDY_LEVEL', 'PROGRAM'] as const
export type AdmissionRequirementScope = (typeof admissionRequirementScopes)[number]

export type AdmissionRequirementRecord = {
  id: string
  universityId: string
  scope: AdmissionRequirementScope
  studyLevel: ProgramStudyLevel | null
  programId: string | null
  contentAr: string
  contentEn: string | null
  status: PublicationStatus
  officialSourceUrl: string | null
  verifiedAt: Date | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  program?: { id: string; nameAr: string | null; nameEn: string | null; studyLevel: ProgramStudyLevel } | null
}

export type AdmissionRequirementInput = Pick<AdmissionRequirementRecord,
  'scope' | 'studyLevel' | 'programId' | 'contentAr' | 'contentEn' | 'status' | 'officialSourceUrl' | 'verifiedAt'>
export type AdmissionRequirementUpdate = Partial<Pick<AdmissionRequirementInput, 'contentAr' | 'contentEn' | 'status' | 'officialSourceUrl' | 'verifiedAt'>>

export type GalleryImageRecord = {
  id: string
  universityId: string
  imageUrl: string
  altAr: string | null
  altEn: string | null
  displayOrder: number
  status: PublicationStatus
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type GalleryImageInput = Pick<GalleryImageRecord, 'imageUrl' | 'altAr' | 'altEn' | 'status'>
export type GalleryImageUpdate = Partial<GalleryImageInput>

export type DetailsListQuery = { page: number; limit: number; status?: PublicationStatus; scope?: AdmissionRequirementScope }

export type DetailsMutationResult<T> =
  | { outcome: 'UPDATED'; record: T }
  | { outcome: 'NOT_FOUND' | 'UNIVERSITY_NOT_FOUND' | 'PROGRAM_NOT_FOUND' | 'PROGRAM_UNIVERSITY_MISMATCH' | 'PUBLICATION_REQUIREMENTS' | 'GALLERY_LIMIT_REACHED' }

export type GalleryReorderResult =
  | { outcome: 'UPDATED'; records: GalleryImageRecord[] }
  | { outcome: 'UNIVERSITY_NOT_FOUND' | 'ORDER_SET_MISMATCH' }

export interface UniversityDetailsRepository {
  resolvePublishedUniversity(slug: string): Promise<string | null>
  universityExists(id: string): Promise<boolean>
  listAdmissionRequirements(universityId: string, query: DetailsListQuery, publicOnly: boolean): Promise<{ items: AdmissionRequirementRecord[]; total: number }>
  createAdmissionRequirement(universityId: string, input: AdmissionRequirementInput, actorAdminId: string, now: Date): Promise<DetailsMutationResult<AdmissionRequirementRecord>>
  updateAdmissionRequirement(id: string, input: AdmissionRequirementUpdate, actorAdminId: string, now: Date): Promise<DetailsMutationResult<AdmissionRequirementRecord>>
  listGallery(universityId: string, query: DetailsListQuery, publicOnly: boolean): Promise<{ items: GalleryImageRecord[]; total: number }>
  createGalleryImage(universityId: string, input: GalleryImageInput, actorAdminId: string, now: Date): Promise<DetailsMutationResult<GalleryImageRecord>>
  updateGalleryImage(id: string, input: GalleryImageUpdate, actorAdminId: string, now: Date): Promise<DetailsMutationResult<GalleryImageRecord>>
  reorderGallery(universityId: string, orderedIds: string[], actorAdminId: string): Promise<GalleryReorderResult>
  detachGalleryImage(id: string, actorAdminId: string): Promise<DetailsMutationResult<{ id: string }>>
}
