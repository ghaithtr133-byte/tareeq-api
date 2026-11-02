import type {
  Prisma,
  UniversityAdmissionRequirement,
  UniversityGalleryImage,
  UniversityProgram,
} from '../generated/prisma/client.js'

import { getPrisma } from '../database/client.js'
import type { PublicationStatus } from '../content/types.js'
import type { ProgramStudyLevel } from '../university-directory/types.js'
import type {
  AdmissionRequirementInput,
  AdmissionRequirementRecord,
  AdmissionRequirementUpdate,
  DetailsListQuery,
  GalleryImageInput,
  GalleryImageRecord,
  GalleryImageUpdate,
  UniversityDetailsRepository,
} from './types.js'

const programSelect = { id: true, nameAr: true, nameEn: true, studyLevel: true } as const
const auditMetadata = (value: Record<string, unknown>) => value as Prisma.InputJsonValue
type AdmissionWithProgram = UniversityAdmissionRequirement & {
  program: Pick<UniversityProgram, 'id' | 'nameAr' | 'nameEn' | 'studyLevel'> | null
}

const admission = (record: AdmissionWithProgram): AdmissionRequirementRecord => ({
  ...record,
  scope: record.scope as AdmissionRequirementRecord['scope'],
  studyLevel: record.studyLevel as ProgramStudyLevel | null,
  status: record.status as PublicationStatus,
  program: record.program ? { ...record.program, studyLevel: record.program.studyLevel as ProgramStudyLevel } : null,
})
const gallery = (record: UniversityGalleryImage): GalleryImageRecord => ({ ...record, status: record.status as PublicationStatus })

export class PrismaUniversityDetailsRepository implements UniversityDetailsRepository {
  async resolvePublishedUniversity(slug: string) {
    return (await getPrisma().university.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }))?.id ?? null
  }

  async universityExists(id: string) {
    return await getPrisma().university.count({ where: { id } }) === 1
  }

  async listAdmissionRequirements(universityId: string, query: DetailsListQuery, publicOnly: boolean) {
    const where: Prisma.UniversityAdmissionRequirementWhereInput = {
      universityId,
      ...(publicOnly ? { status: 'PUBLISHED', university: { status: 'PUBLISHED' } } : query.status ? { status: query.status } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
    }
    const [items, total] = await Promise.all([
      getPrisma().universityAdmissionRequirement.findMany({
        where, include: { program: { select: programSelect } },
        orderBy: [{ scope: 'asc' }, { studyLevel: 'asc' }, { programId: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit, take: query.limit,
      }),
      getPrisma().universityAdmissionRequirement.count({ where }),
    ])
    return { items: items.map(admission), total }
  }

  async createAdmissionRequirement(universityId: string, input: AdmissionRequirementInput, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      if (await transaction.university.count({ where: { id: universityId } }) !== 1) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
      if (input.programId) {
        const program = await transaction.universityProgram.findUnique({ where: { id: input.programId }, select: { universityId: true } })
        if (!program) return { outcome: 'PROGRAM_NOT_FOUND' as const }
        if (program.universityId !== universityId) return { outcome: 'PROGRAM_UNIVERSITY_MISMATCH' as const }
      }
      if (input.status === 'PUBLISHED' && (!input.officialSourceUrl || !input.verifiedAt)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
      const record = await transaction.universityAdmissionRequirement.create({
        data: { ...input, universityId, publishedAt: input.status === 'PUBLISHED' ? now : null },
        include: { program: { select: programSelect } },
      })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action: 'university_admission_requirement.created', resourceType: 'UNIVERSITY_ADMISSION_REQUIREMENT', resourceId: record.id,
        metadata: auditMetadata({ universityId, scope: input.scope, studyLevel: input.studyLevel, programId: input.programId, status: input.status }),
      } })
      return { outcome: 'UPDATED' as const, record: admission(record) }
    })
  }

  async updateAdmissionRequirement(id: string, input: AdmissionRequirementUpdate, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.universityAdmissionRequirement.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      const nextStatus = input.status ?? current.status
      const nextSource = input.officialSourceUrl === undefined ? current.officialSourceUrl : input.officialSourceUrl
      const nextVerifiedAt = input.verifiedAt === undefined ? current.verifiedAt : input.verifiedAt
      if (nextStatus === 'PUBLISHED' && (!nextSource || !nextVerifiedAt)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
      const record = await transaction.universityAdmissionRequirement.update({
        where: { id }, data: {
          ...input,
          ...(nextStatus === 'PUBLISHED' && !current.publishedAt ? { publishedAt: now } : {}),
        }, include: { program: { select: programSelect } },
      })
      const action = nextStatus === 'ARCHIVED' && current.status !== 'ARCHIVED'
        ? 'university_admission_requirement.archived'
        : nextStatus === 'PUBLISHED' && current.status !== 'PUBLISHED'
          ? 'university_admission_requirement.published'
          : 'university_admission_requirement.updated'
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action, resourceType: 'UNIVERSITY_ADMISSION_REQUIREMENT', resourceId: id,
        metadata: auditMetadata({ universityId: current.universityId, scope: current.scope, changedFields: Object.keys(input).sort(), ...(current.status !== nextStatus ? { fromStatus: current.status, toStatus: nextStatus } : {}) }),
      } })
      return { outcome: 'UPDATED' as const, record: admission(record) }
    })
  }

  async listGallery(universityId: string, query: DetailsListQuery, publicOnly: boolean) {
    const where: Prisma.UniversityGalleryImageWhereInput = {
      universityId,
      ...(publicOnly ? { status: 'PUBLISHED', university: { status: 'PUBLISHED' } } : query.status ? { status: query.status } : {}),
    }
    const [items, total] = await Promise.all([
      getPrisma().universityGalleryImage.findMany({ where, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      getPrisma().universityGalleryImage.count({ where }),
    ])
    return { items: items.map(gallery), total }
  }

  async createGalleryImage(universityId: string, input: GalleryImageInput, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      if (await transaction.university.count({ where: { id: universityId } }) !== 1) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
      const maximum = await transaction.universityGalleryImage.aggregate({ where: { universityId, status: { not: 'ARCHIVED' } }, _max: { displayOrder: true } })
      const record = await transaction.universityGalleryImage.create({ data: { ...input, universityId, displayOrder: (maximum._max.displayOrder ?? -1) + 1, publishedAt: input.status === 'PUBLISHED' ? now : null } })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action: 'university_gallery_image.attached', resourceType: 'UNIVERSITY_GALLERY_IMAGE', resourceId: record.id,
        metadata: auditMetadata({ universityId, status: input.status, displayOrder: record.displayOrder }),
      } })
      return { outcome: 'UPDATED' as const, record: gallery(record) }
    })
  }

  async updateGalleryImage(id: string, input: GalleryImageUpdate, actorAdminId: string, now: Date) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.universityGalleryImage.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      const nextStatus = input.status ?? current.status
      const record = await transaction.universityGalleryImage.update({ where: { id }, data: { ...input, ...(nextStatus === 'PUBLISHED' && !current.publishedAt ? { publishedAt: now } : {}) } })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action: nextStatus === 'PUBLISHED' && current.status !== 'PUBLISHED' ? 'university_gallery_image.published' : 'university_gallery_image.updated',
        resourceType: 'UNIVERSITY_GALLERY_IMAGE', resourceId: id,
        metadata: auditMetadata({ universityId: current.universityId, changedFields: Object.keys(input).sort(), ...(current.status !== nextStatus ? { fromStatus: current.status, toStatus: nextStatus } : {}) }),
      } })
      return { outcome: 'UPDATED' as const, record: gallery(record) }
    })
  }

  async reorderGallery(universityId: string, orderedIds: string[], actorAdminId: string) {
    return getPrisma().$transaction(async (transaction) => {
      if (await transaction.university.count({ where: { id: universityId } }) !== 1) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
      const active = await transaction.universityGalleryImage.findMany({ where: { universityId, status: { not: 'ARCHIVED' } }, orderBy: [{ id: 'asc' }], select: { id: true } })
      const expected = active.map(({ id }) => id).sort()
      if (expected.length !== orderedIds.length || expected.some((id, index) => id !== [...orderedIds].sort()[index])) return { outcome: 'ORDER_SET_MISMATCH' as const }
      for (const [displayOrder, id] of orderedIds.entries()) await transaction.universityGalleryImage.update({ where: { id }, data: { displayOrder } })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action: 'university_gallery.reordered', resourceType: 'UNIVERSITY', resourceId: universityId,
        metadata: auditMetadata({ imageCount: orderedIds.length }),
      } })
      const records = await transaction.universityGalleryImage.findMany({ where: { universityId, status: { not: 'ARCHIVED' } }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] })
      return { outcome: 'UPDATED' as const, records: records.map(gallery) }
    })
  }

  async detachGalleryImage(id: string, actorAdminId: string) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.universityGalleryImage.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      await transaction.universityGalleryImage.delete({ where: { id } })
      await transaction.adminAuditLog.create({ data: {
        actorAdminId, action: 'university_gallery_image.detached', resourceType: 'UNIVERSITY_GALLERY_IMAGE', resourceId: id,
        metadata: auditMetadata({ universityId: current.universityId, displayOrder: current.displayOrder }),
      } })
      return { outcome: 'UPDATED' as const, record: { id } }
    })
  }
}
