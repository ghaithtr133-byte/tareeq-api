import { getPrisma } from '../database/client.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ApiError } from '../shared/http.js'
import type { AuditIntent } from '../audit/types.js'
import type { UniversityDirectoryFilters } from '../university-directory/types.js'
import {
  analyzeDeletionImpact,
  deletionImpactDigest,
  impactItem,
  type ConfirmedDeletionExecution,
  type DeletionChallengeIssue,
  type DeletionExecution,
  type DeletionImpact,
  type DeletionImpactItem,
} from './deletion-impact.js'
import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
} from './types.js'

const relationSelections = {
  country: { select: { id: true, slug: true, nameAr: true, nameEn: true, countryCode: true } },
  city: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
  university: { select: { id: true, slug: true, nameAr: true } },
} as const

const articleInclude = (publicOnly: boolean) => ({
  country: relationSelections.country,
  university: relationSelections.university,
  scholarship: { select: { id: true, slug: true, titleAr: true } },
  relatedScholarships: {
    ...(publicOnly ? { where: { scholarship: { status: 'PUBLISHED' as const } } } : {}),
    orderBy: [{ displayOrder: 'asc' as const }, { scholarshipId: 'asc' as const }],
    select: {
      scholarshipId: true,
      scholarship: { select: {
        id: true, slug: true, titleAr: true, imageUrl: true,
        applicationStatus: true, verifiedDeadline: true,
        country: { select: { id: true, slug: true, nameAr: true } },
      } },
    },
  },
}) satisfies Prisma.ArticleInclude

type ArticleJoinView = {
  scholarshipId: string
  scholarship: {
    id: string
    slug: string
    titleAr: string
    imageUrl: string | null
    applicationStatus: string
    verifiedDeadline: Date | null
    country: { id: string; slug: string; nameAr: string } | null
  }
}

const asEntity = (value: unknown) => value as ContentEntity
const asEntities = (value: unknown[]) => value.map(asEntity)
const asArticle = (value: unknown) => {
  const record = value as Record<string, unknown> & { relatedScholarships: ArticleJoinView[] }
  return asEntity({
    ...record,
    scholarshipIds: record.relatedScholarships.map(({ scholarshipId }) => scholarshipId),
    relatedScholarships: record.relatedScholarships.map(({ scholarship }) => scholarship),
  })
}
const asResourceEntity = (resource: ContentResource, value: unknown) => resource === 'articles' ? asArticle(value) : asEntity(value)
const skipFor = (query: ContentListQuery) => (query.page - 1) * query.limit

const universityDirectoryWhere = (
  filters: UniversityDirectoryFilters,
): Prisma.UniversityWhereInput => {
  const programFilter: Prisma.UniversityProgramWhereInput | undefined = filters.major || filters.studyLevel || filters.language
    ? { status: 'PUBLISHED' }
    : undefined
  if (programFilter && filters.major) programFilter.academicMajor = { slug: filters.major }
  if (programFilter && filters.studyLevel) programFilter.studyLevel = filters.studyLevel
  if (programFilter && filters.language) programFilter.languages = { some: { language: filters.language } }
  return {
    ...(filters.featured === undefined ? {} : { featured: filters.featured }),
    ...(filters.country ? { country: { slug: filters.country } } : {}),
    ...(filters.city ? { city: { slug: filters.city } } : {}),
    ...(filters.universityType ? { universityType: filters.universityType } : {}),
    ...(programFilter ? { programs: { some: programFilter } } : {}),
    ...(filters.search
      ? { OR: [
          { nameAr: { contains: filters.search, mode: 'insensitive' } },
          { nameEn: { contains: filters.search, mode: 'insensitive' } },
          { officialName: { contains: filters.search, mode: 'insensitive' } },
          { cityAr: { contains: filters.search, mode: 'insensitive' } },
        ] }
      : {}),
  }
}

const universityListFilters = (query: ContentListQuery): UniversityDirectoryFilters => ({
  ...(query.search ? { search: query.search } : {}),
  ...(query.country ? { country: query.country } : {}),
  ...(query.featured === undefined ? {} : { featured: query.featured }),
  ...(query.major ? { major: query.major } : {}),
  ...(query.studyLevel ? { studyLevel: query.studyLevel as NonNullable<UniversityDirectoryFilters['studyLevel']> } : {}),
  ...(query.language ? { language: query.language as NonNullable<UniversityDirectoryFilters['language']> } : {}),
  ...(query.city ? { city: query.city } : {}),
  ...(query.universityType ? { universityType: query.universityType } : {}),
})

const scholarshipUniversityFilters = (query: ContentListQuery): UniversityDirectoryFilters => ({
  ...(query.universitySearch ? { search: query.universitySearch } : {}),
  ...(query.universityCountry ? { country: query.universityCountry } : {}),
  ...(query.universityFeatured === undefined ? {} : { featured: query.universityFeatured }),
  ...(query.universityMajor ? { major: query.universityMajor } : {}),
  ...(query.universityStudyLevel ? { studyLevel: query.universityStudyLevel } : {}),
  ...(query.universityLanguage ? { language: query.universityLanguage } : {}),
  ...(query.universityCity ? { city: query.universityCity } : {}),
  ...(query.universityType ? { universityType: query.universityType } : {}),
})

const auditData = (audit: AuditIntent, resourceId: string) => ({
  ...audit,
  resourceId,
  metadata: audit.metadata as Prisma.InputJsonValue,
})

const handleWriteError = (error: unknown): never => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined
  if (code === 'P2002') {
    throw new ApiError(409, 'SLUG_CONFLICT', 'The slug is already in use.', {
      fields: { slug: ['Choose a unique slug.'] },
    })
  }
  if (code === 'P2003') {
    throw new ApiError(400, 'RELATIONSHIP_INVALID', 'A related record does not exist.', {
      fields: { relationship: ['Select an existing related record.'] },
    })
  }
  throw error
}

type DatabaseClient = ReturnType<typeof getPrisma> | Prisma.TransactionClient
type CountAndSamples = { count: number; sampleIds: string[] }

const countAndSamples = async (
  count: Promise<number>,
  samples: Promise<Array<{ id: string }>>,
): Promise<CountAndSamples> => {
  const [total, records] = await Promise.all([count, samples])
  return { count: total, sampleIds: records.map(({ id }) => id) }
}

const targetAuditResourceType = (resource: ContentResource) => ({
  countries: 'COUNTRY', universities: 'UNIVERSITY', scholarships: 'SCHOLARSHIP', services: 'SERVICE', articles: 'ARTICLE',
} as const)[resource]

export class PrismaContentRepository implements ContentRepository {
  async deletionImpact(resource: ContentResource, id: string): Promise<DeletionImpact | null> {
    return this.buildDeletionImpact(getPrisma(), resource, id)
  }

  async issueDeletionChallenge(
    resource: ContentResource,
    id: string,
    actorAdminId: string,
    expiresAt: Date,
  ): Promise<DeletionChallengeIssue> {
    return getPrisma().$transaction(async (transaction) => {
      if (!(await this.lockTarget(transaction, resource, id))) return { outcome: 'NOT_FOUND' }
      const impact = await this.buildDeletionImpact(transaction, resource, id)
      if (!impact) return { outcome: 'NOT_FOUND' }
      if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED', impact }
      if (impact.outcome === 'SAFE') return { outcome: 'SAFE', impact }
      const challenge = await transaction.hardDeleteChallenge.create({ data: {
        actorAdminId,
        resourceType: targetAuditResourceType(resource),
        resourceId: id,
        impactHash: deletionImpactDigest(impact),
        expiresAt,
      } })
      return { outcome: 'ISSUED', impact, challenge: { id: challenge.id, expiresAt: challenge.expiresAt } }
    })
  }

  async confirmHardDelete(
    resource: ContentResource,
    id: string,
    challengeId: string,
    actorAdminId: string,
    now: Date,
  ): Promise<ConfirmedDeletionExecution> {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        if (!(await this.lockTarget(transaction, resource, id))) return { outcome: 'NOT_FOUND' as const }
        const impact = await this.buildDeletionImpact(transaction, resource, id)
        if (!impact) return { outcome: 'NOT_FOUND' as const }
        if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED' as const, impact }

        const challenge = await transaction.hardDeleteChallenge.findUnique({ where: { id: challengeId } })
        if (
          !challenge ||
          challenge.actorAdminId !== actorAdminId ||
          challenge.resourceType !== targetAuditResourceType(resource) ||
          challenge.resourceId !== id ||
          challenge.consumedAt !== null ||
          challenge.expiresAt <= now ||
          challenge.impactHash !== deletionImpactDigest(impact) ||
          impact.outcome !== 'REQUIRES_CONFIRMATION'
        ) return { outcome: 'STALE' as const, impact }

        await this.executeConfirmedDeletion(transaction, resource, id)
        await transaction.hardDeleteChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } })
        await transaction.adminAuditLog.create({ data: {
          actorAdminId,
          action: `content.${resource}.hard_deleted`,
          resourceType: targetAuditResourceType(resource),
          resourceId: id,
          metadata: {
            deletionMode: 'CONFIRMED',
            previousStatus: impact.target.status,
            challengeId: challenge.id,
            effects: impact.items
              .filter((item) => item.effect === 'DELETE' || item.effect === 'UNLINK' || item.effect === 'SET_NULL')
              .map(({ resourceType, effect, count, relationshipPath }) => ({ resourceType, effect, count, relationshipPath })),
          },
        } })
        return { outcome: 'DELETED' as const, id, impact }
      })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      if (code === 'P2003') {
        const impact = await this.deletionImpact(resource, id)
        if (impact) return { outcome: 'BLOCKED', impact: { ...impact, outcome: 'BLOCKED', items: [...impact.items, impactItem('UNKNOWN_REFERENCE', 'UNKNOWN', 0, `${resource}.confirm`, 'FOREIGN_KEY_REVALIDATION_FAILED', { canConfirm: false, blocked: true })] } }
      }
      throw error
    }
  }

  async deleteIfSafe(resource: ContentResource, id: string, actorAdminId: string): Promise<DeletionExecution> {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        if (!(await this.lockTarget(transaction, resource, id))) return { outcome: 'NOT_FOUND' as const }
        const impact = await this.buildDeletionImpact(transaction, resource, id)
        if (!impact) return { outcome: 'NOT_FOUND' as const }
        if (impact.outcome === 'BLOCKED') return { outcome: 'BLOCKED' as const, impact }
        if (impact.outcome === 'REQUIRES_CONFIRMATION') return { outcome: 'REQUIRES_CONFIRMATION' as const, impact }
        await ({
          countries: () => transaction.country.delete({ where: { id } }),
          universities: () => transaction.university.delete({ where: { id } }),
          scholarships: () => transaction.scholarship.delete({ where: { id } }),
          services: () => transaction.service.delete({ where: { id } }),
          articles: () => Promise.resolve(undefined),
        })[resource]()
        await transaction.adminAuditLog.create({ data: {
          actorAdminId,
          action: `content.${resource}.hard_deleted`,
          resourceType: targetAuditResourceType(resource),
          resourceId: id,
          metadata: { deletionMode: 'SAFE_INITIAL', previousStatus: impact.target.status },
        } })
        return { outcome: 'DELETED' as const, id, impact }
      })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      if (code === 'P2003') {
        const impact = await this.deletionImpact(resource, id)
        if (impact) return impact.outcome === 'REQUIRES_CONFIRMATION'
          ? { outcome: 'REQUIRES_CONFIRMATION', impact }
          : { outcome: 'BLOCKED', impact: { ...impact, outcome: 'BLOCKED', items: [...impact.items, impactItem('UNKNOWN_REFERENCE', 'UNKNOWN', 0, `${resource}.delete`, 'FOREIGN_KEY_REVALIDATION_FAILED', { canConfirm: false, blocked: true })] } }
      }
      throw error
    }
  }

  private async lockTarget(transaction: Prisma.TransactionClient, resource: ContentResource, id: string) {
    const locked = await ({
      countries: () => transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Country" WHERE "id" = ${id} FOR UPDATE`,
      universities: () => transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "University" WHERE "id" = ${id} FOR UPDATE`,
      scholarships: () => transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Scholarship" WHERE "id" = ${id} FOR UPDATE`,
      services: () => transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Service" WHERE "id" = ${id} FOR UPDATE`,
      articles: () => Promise.resolve([] as Array<{ id: string }>),
    })[resource]()
    return locked.length > 0
  }

  private async executeConfirmedDeletion(transaction: Prisma.TransactionClient, resource: ContentResource, id: string) {
    switch (resource) {
      case 'countries':
        await transaction.countryStudyGuideSection.deleteMany({ where: { countryId: id } })
        await transaction.scholarship.updateMany({ where: { countryId: id }, data: { countryId: null } })
        await transaction.article.updateMany({ where: { countryId: id }, data: { countryId: null } })
        await transaction.country.delete({ where: { id } })
        return
      case 'universities':
        await transaction.universityGalleryImage.deleteMany({ where: { universityId: id } })
        await transaction.universityAdmissionRequirement.deleteMany({ where: { universityId: id } })
        await transaction.universityProgramLanguage.deleteMany({ where: { program: { universityId: id } } })
        await transaction.universityProgramTuition.deleteMany({ where: { program: { universityId: id } } })
        await transaction.universityProgram.deleteMany({ where: { universityId: id } })
        await transaction.scholarship.updateMany({ where: { universityId: id }, data: { universityId: null } })
        await transaction.article.updateMany({ where: { universityId: id }, data: { universityId: null } })
        await transaction.university.delete({ where: { id } })
        return
      case 'scholarships':
        await transaction.scholarshipDetailItem.deleteMany({ where: { scholarshipId: id } })
        await transaction.articleScholarship.deleteMany({ where: { scholarshipId: id } })
        await transaction.article.updateMany({ where: { scholarshipId: id }, data: { scholarshipId: null } })
        await transaction.scholarship.delete({ where: { id } })
        return
      case 'services':
        await transaction.serviceDetailItem.deleteMany({ where: { serviceId: id } })
        await transaction.service.delete({ where: { id } })
        return
      case 'articles':
        throw new Error('Article hard deletion is not supported.')
    }
  }

  private async buildDeletionImpact(database: DatabaseClient, resource: ContentResource, id: string): Promise<DeletionImpact | null> {
    const result = await (async () => {
      switch (resource) {
        case 'countries': {
          const target = await database.country.findUnique({ where: { id }, select: { id: true, slug: true, status: true } })
          if (!target) return null
          const [universities, cities, scholarships, articles, applications, faqs, guides, programs, programLanguages, tuitionFees, admissions, galleries, universityScholarships, universityArticles, universityApplications, universityFaqs, scholarshipDetails, scholarshipLinks, audits, analytics] = await Promise.all([
            countAndSamples(database.university.count({ where: { countryId: id } }), database.university.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.city.count({ where: { countryId: id } }), database.city.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.scholarship.count({ where: { countryId: id } }), database.scholarship.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.article.count({ where: { countryId: id } }), database.article.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.studentApplication.count({ where: { countryId: id } }), database.studentApplication.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.faqEntry.count({ where: { countryId: id } }), database.faqEntry.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.countryStudyGuideSection.count({ where: { countryId: id } }), database.countryStudyGuideSection.findMany({ where: { countryId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityProgram.count({ where: { university: { countryId: id } } }), database.universityProgram.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityProgramLanguage.count({ where: { program: { university: { countryId: id } } } }), database.universityProgramLanguage.findMany({ where: { program: { university: { countryId: id } } }, select: { programId: true }, take: 5 }).then((rows) => rows.map(({ programId }) => ({ id: programId })))),
            countAndSamples(database.universityProgramTuition.count({ where: { program: { university: { countryId: id } } } }), database.universityProgramTuition.findMany({ where: { program: { university: { countryId: id } } }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityAdmissionRequirement.count({ where: { university: { countryId: id } } }), database.universityAdmissionRequirement.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityGalleryImage.count({ where: { university: { countryId: id } } }), database.universityGalleryImage.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.scholarship.count({ where: { university: { countryId: id } } }), database.scholarship.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.article.count({ where: { university: { countryId: id } } }), database.article.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.studentApplication.count({ where: { university: { countryId: id } } }), database.studentApplication.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.faqEntry.count({ where: { university: { countryId: id } } }), database.faqEntry.findMany({ where: { university: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.scholarshipDetailItem.count({ where: { scholarship: { countryId: id } } }), database.scholarshipDetailItem.findMany({ where: { scholarship: { countryId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.articleScholarship.count({ where: { scholarship: { countryId: id } } }), database.articleScholarship.findMany({ where: { scholarship: { countryId: id } }, select: { articleId: true }, take: 5 }).then((rows) => rows.map(({ articleId }) => ({ id: articleId })))),
            countAndSamples(database.adminAuditLog.count({ where: { resourceType: 'COUNTRY', resourceId: id } }), database.adminAuditLog.findMany({ where: { resourceType: 'COUNTRY', resourceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.analyticsEvent.count({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] } }), database.analyticsEvent.findMany({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] }, select: { id: true }, take: 5 })),
          ])
          return this.toDeletionImpact(resource, target, [
            this.dependency('UNIVERSITY', 'BLOCK', universities, 'country.universities', 'COUNTRY_UNIVERSITIES_RESTRICT'),
            this.dependency('CITY', 'BLOCK', cities, 'country.cities', 'COUNTRY_CITIES_RESTRICT'),
            this.dependency('SCHOLARSHIP', 'UNLINK', scholarships, 'country.scholarships', 'COUNTRY_SCHOLARSHIPS_UNLINK'),
            this.dependency('ARTICLE', 'UNLINK', articles, 'country.articles', 'COUNTRY_ARTICLES_UNLINK'),
            this.dependency('STUDENT_APPLICATION', 'BLOCK', applications, 'country.studentApplications', 'STUDENT_APPLICATION_HISTORY_PROTECTED'),
            this.dependency('FAQ_ENTRY', 'BLOCK', faqs, 'country.faqEntries', 'COUNTRY_FAQS_RESTRICT'),
            this.dependency('COUNTRY_STUDY_GUIDE_SECTION', 'DELETE', guides, 'country.studyGuideSections', 'COUNTRY_GUIDES_EXPLICIT_DELETE'),
            this.dependency('UNIVERSITY_PROGRAM', 'BLOCK', programs, 'country.universities.programs', 'TRANSITIVE_UNIVERSITY_PROGRAM_RESTRICT'),
            this.dependency('UNIVERSITY_PROGRAM_LANGUAGE', 'BLOCK', programLanguages, 'country.universities.programs.languages', 'TRANSITIVE_PROGRAM_LANGUAGE_NOT_REACHED'),
            this.dependency('UNIVERSITY_PROGRAM_TUITION', 'BLOCK', tuitionFees, 'country.universities.programs.tuitionFees', 'TRANSITIVE_PROGRAM_TUITION_NOT_REACHED'),
            this.dependency('UNIVERSITY_ADMISSION_REQUIREMENT', 'BLOCK', admissions, 'country.universities.admissionRequirements', 'TRANSITIVE_ADMISSION_RESTRICT'),
            this.dependency('UNIVERSITY_GALLERY_IMAGE', 'BLOCK', galleries, 'country.universities.galleryImages', 'TRANSITIVE_GALLERY_RESTRICT'),
            this.dependency('SCHOLARSHIP', 'BLOCK', universityScholarships, 'country.universities.scholarships', 'TRANSITIVE_SCHOLARSHIP_RESTRICT'),
            this.dependency('ARTICLE', 'BLOCK', universityArticles, 'country.universities.articles', 'TRANSITIVE_ARTICLE_RESTRICT'),
            this.dependency('STUDENT_APPLICATION', 'BLOCK', universityApplications, 'country.universities.studentApplications', 'TRANSITIVE_STUDENT_APPLICATION_PROTECTED'),
            this.dependency('FAQ_ENTRY', 'BLOCK', universityFaqs, 'country.universities.faqEntries', 'TRANSITIVE_FAQ_RESTRICT'),
            this.dependency('SCHOLARSHIP_DETAIL_ITEM', 'PRESERVE', scholarshipDetails, 'country.scholarships.detailItems', 'TRANSITIVE_SCHOLARSHIP_DETAILS_PRESERVED'),
            this.dependency('ARTICLE_SCHOLARSHIP', 'PRESERVE', scholarshipLinks, 'country.scholarships.relatedArticles', 'TRANSITIVE_ARTICLE_LINKS_PRESERVED'),
            this.dependency('ADMIN_AUDIT_LOG', 'PRESERVE', audits, 'country.auditHistory', 'AUDIT_HISTORY_PRESERVED'),
            this.dependency('ANALYTICS_EVENT', 'PRESERVE', analytics, 'country.analyticsPaths', 'ANALYTICS_HISTORY_PRESERVED'),
          ])
        }
        case 'universities': {
          const target = await database.university.findUnique({ where: { id }, select: { id: true, slug: true, status: true } })
          if (!target) return null
          const [programs, languages, tuitionFees, admissions, galleries, scholarships, articles, applications, faqs, scholarshipDetails, scholarshipLinks, audits, analytics] = await Promise.all([
            countAndSamples(database.universityProgram.count({ where: { universityId: id } }), database.universityProgram.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityProgramLanguage.count({ where: { program: { universityId: id } } }), database.universityProgramLanguage.findMany({ where: { program: { universityId: id } }, select: { programId: true }, take: 5 }).then((rows) => rows.map(({ programId }) => ({ id: programId })))),
            countAndSamples(database.universityProgramTuition.count({ where: { program: { universityId: id } } }), database.universityProgramTuition.findMany({ where: { program: { universityId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityAdmissionRequirement.count({ where: { universityId: id } }), database.universityAdmissionRequirement.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.universityGalleryImage.count({ where: { universityId: id } }), database.universityGalleryImage.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.scholarship.count({ where: { universityId: id } }), database.scholarship.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.article.count({ where: { universityId: id } }), database.article.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.studentApplication.count({ where: { universityId: id } }), database.studentApplication.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.faqEntry.count({ where: { universityId: id } }), database.faqEntry.findMany({ where: { universityId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.scholarshipDetailItem.count({ where: { scholarship: { universityId: id } } }), database.scholarshipDetailItem.findMany({ where: { scholarship: { universityId: id } }, select: { id: true }, take: 5 })),
            countAndSamples(database.articleScholarship.count({ where: { scholarship: { universityId: id } } }), database.articleScholarship.findMany({ where: { scholarship: { universityId: id } }, select: { articleId: true }, take: 5 }).then((rows) => rows.map(({ articleId }) => ({ id: articleId })))),
            countAndSamples(database.adminAuditLog.count({ where: { resourceType: 'UNIVERSITY', resourceId: id } }), database.adminAuditLog.findMany({ where: { resourceType: 'UNIVERSITY', resourceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.analyticsEvent.count({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] } }), database.analyticsEvent.findMany({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] }, select: { id: true }, take: 5 })),
          ])
          return this.toDeletionImpact(resource, target, [
            this.dependency('UNIVERSITY_PROGRAM', 'DELETE', programs, 'university.programs', 'UNIVERSITY_PROGRAMS_EXPLICIT_DELETE'),
            this.dependency('UNIVERSITY_PROGRAM_LANGUAGE', 'DELETE', languages, 'university.programs.languages', 'UNIVERSITY_PROGRAM_LANGUAGES_EXPLICIT_DELETE'),
            this.dependency('UNIVERSITY_PROGRAM_TUITION', 'DELETE', tuitionFees, 'university.programs.tuitionFees', 'UNIVERSITY_PROGRAM_TUITION_EXPLICIT_DELETE'),
            this.dependency('UNIVERSITY_ADMISSION_REQUIREMENT', 'DELETE', admissions, 'university.admissionRequirements', 'UNIVERSITY_ADMISSIONS_EXPLICIT_DELETE'),
            this.dependency('UNIVERSITY_GALLERY_IMAGE', 'DELETE', galleries, 'university.galleryImages', 'UNIVERSITY_GALLERY_EXPLICIT_DELETE'),
            this.dependency('SCHOLARSHIP', 'UNLINK', scholarships, 'university.scholarships', 'UNIVERSITY_SCHOLARSHIPS_UNLINK'),
            this.dependency('ARTICLE', 'UNLINK', articles, 'university.articles', 'UNIVERSITY_ARTICLES_UNLINK'),
            this.dependency('STUDENT_APPLICATION', 'BLOCK', applications, 'university.studentApplications', 'STUDENT_APPLICATION_HISTORY_PROTECTED'),
            this.dependency('FAQ_ENTRY', 'BLOCK', faqs, 'university.faqEntries', 'UNIVERSITY_FAQS_RESTRICT'),
            this.dependency('SCHOLARSHIP_DETAIL_ITEM', 'PRESERVE', scholarshipDetails, 'university.scholarships.detailItems', 'TRANSITIVE_SCHOLARSHIP_DETAILS_PRESERVED'),
            this.dependency('ARTICLE_SCHOLARSHIP', 'PRESERVE', scholarshipLinks, 'university.scholarships.relatedArticles', 'TRANSITIVE_ARTICLE_LINKS_PRESERVED'),
            this.dependency('ADMIN_AUDIT_LOG', 'PRESERVE', audits, 'university.auditHistory', 'AUDIT_HISTORY_PRESERVED'),
            this.dependency('ANALYTICS_EVENT', 'PRESERVE', analytics, 'university.analyticsPaths', 'ANALYTICS_HISTORY_PRESERVED'),
          ])
        }
        case 'scholarships': {
          const target = await database.scholarship.findUnique({ where: { id }, select: { id: true, slug: true, status: true } })
          if (!target) return null
          const [details, legacyArticles, articleLinks, applications, faqs, audits, analytics] = await Promise.all([
            countAndSamples(database.scholarshipDetailItem.count({ where: { scholarshipId: id } }), database.scholarshipDetailItem.findMany({ where: { scholarshipId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.article.count({ where: { scholarshipId: id } }), database.article.findMany({ where: { scholarshipId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.articleScholarship.count({ where: { scholarshipId: id } }), database.articleScholarship.findMany({ where: { scholarshipId: id }, select: { articleId: true }, take: 5 }).then((rows) => rows.map(({ articleId }) => ({ id: articleId })))),
            countAndSamples(database.studentApplication.count({ where: { scholarshipId: id } }), database.studentApplication.findMany({ where: { scholarshipId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.faqEntry.count({ where: { scholarshipId: id } }), database.faqEntry.findMany({ where: { scholarshipId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.adminAuditLog.count({ where: { resourceType: 'SCHOLARSHIP', resourceId: id } }), database.adminAuditLog.findMany({ where: { resourceType: 'SCHOLARSHIP', resourceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.analyticsEvent.count({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] } }), database.analyticsEvent.findMany({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] }, select: { id: true }, take: 5 })),
          ])
          return this.toDeletionImpact(resource, target, [
            this.dependency('SCHOLARSHIP_DETAIL_ITEM', 'DELETE', details, 'scholarship.detailItems', 'SCHOLARSHIP_DETAILS_EXPLICIT_DELETE'),
            this.dependency('ARTICLE', 'UNLINK', legacyArticles, 'scholarship.legacyArticles', 'SCHOLARSHIP_LEGACY_ARTICLES_UNLINK'),
            this.dependency('ARTICLE_SCHOLARSHIP', 'UNLINK', articleLinks, 'scholarship.relatedArticles', 'SCHOLARSHIP_ARTICLE_LINKS_UNLINK'),
            this.dependency('STUDENT_APPLICATION', 'BLOCK', applications, 'scholarship.studentApplications', 'STUDENT_APPLICATION_HISTORY_PROTECTED'),
            this.dependency('FAQ_ENTRY', 'BLOCK', faqs, 'scholarship.faqEntries', 'SCHOLARSHIP_FAQS_RESTRICT'),
            this.dependency('ADMIN_AUDIT_LOG', 'PRESERVE', audits, 'scholarship.auditHistory', 'AUDIT_HISTORY_PRESERVED'),
            this.dependency('ANALYTICS_EVENT', 'PRESERVE', analytics, 'scholarship.analyticsPaths', 'ANALYTICS_HISTORY_PRESERVED'),
          ])
        }
        case 'services': {
          const target = await database.service.findUnique({ where: { id }, select: { id: true, slug: true, status: true } })
          if (!target) return null
          const [details, faqs, audits, analytics] = await Promise.all([
            countAndSamples(database.serviceDetailItem.count({ where: { serviceId: id } }), database.serviceDetailItem.findMany({ where: { serviceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.faqEntry.count({ where: { serviceId: id } }), database.faqEntry.findMany({ where: { serviceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.adminAuditLog.count({ where: { resourceType: 'SERVICE', resourceId: id } }), database.adminAuditLog.findMany({ where: { resourceType: 'SERVICE', resourceId: id }, select: { id: true }, take: 5 })),
            countAndSamples(database.analyticsEvent.count({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] } }), database.analyticsEvent.findMany({ where: { OR: [{ path: { endsWith: `/${target.slug}` } }, { targetPath: { endsWith: `/${target.slug}` } }] }, select: { id: true }, take: 5 })),
          ])
          return this.toDeletionImpact(resource, target, [
            this.dependency('SERVICE_DETAIL_ITEM', 'DELETE', details, 'service.detailItems', 'SERVICE_DETAILS_EXPLICIT_DELETE'),
            this.dependency('FAQ_ENTRY', 'BLOCK', faqs, 'service.faqEntries', 'SERVICE_FAQS_RESTRICT'),
            this.dependency('ADMIN_AUDIT_LOG', 'PRESERVE', audits, 'service.auditHistory', 'AUDIT_HISTORY_PRESERVED'),
            this.dependency('ANALYTICS_EVENT', 'PRESERVE', analytics, 'service.analyticsPaths', 'ANALYTICS_HISTORY_PRESERVED'),
          ])
        }
        case 'articles': return null
      }
    })()
    return result
  }

  private dependency(
    resourceType: DeletionImpactItem['resourceType'],
    effect: DeletionImpactItem['effect'],
    result: CountAndSamples,
    relationshipPath: string,
    code: string,
  ) {
    return impactItem(resourceType, effect, result.count, relationshipPath, code, { sampleIds: result.sampleIds })
  }

  private toDeletionImpact(
    resource: ContentResource,
    target: { id: string; slug: string; status: string },
    items: DeletionImpactItem[],
  ): DeletionImpact {
    if (target.slug.startsWith('demo-e2e-')) {
      items.push(impactItem('DEMO_FIXTURE', 'BLOCK', 1, `${resource}.demoFixture`, 'DEMO_FIXTURE_PROTECTED', { sampleIds: [target.id], canConfirm: false, blocked: true }))
    }
    return analyzeDeletionImpact({
      target: { resource, id: target.id, slug: target.slug, status: target.status as DeletionImpact['target']['status'] },
      items,
      analysisComplete: true,
    })
  }

  async reorder(resource: ContentResource, orderedIds: string[], actorAdminId: string) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${9_000_040})`
      const records = await ({
        countries: () => transaction.country.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' } }),
        universities: () => transaction.university.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' } }),
        scholarships: () => transaction.scholarship.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' } }),
        services: () => transaction.service.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' } }),
        articles: () => transaction.article.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' } }),
      })[resource]()
      if (records.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || records.some((record) => !orderedIds.includes(record.id))) return { outcome: 'ORDER_SET_MISMATCH' as const }
      for (const [displayOrder, id] of orderedIds.entries()) await ({ countries: () => transaction.country.update({ where: { id }, data: { displayOrder } }), universities: () => transaction.university.update({ where: { id }, data: { displayOrder } }), scholarships: () => transaction.scholarship.update({ where: { id }, data: { displayOrder } }), services: () => transaction.service.update({ where: { id }, data: { displayOrder } }), articles: () => transaction.article.update({ where: { id }, data: { displayOrder } }) })[resource]()
      const auditResourceId = orderedIds[0]
      if (auditResourceId) await transaction.adminAuditLog.create({ data: { actorAdminId, action: `content.${resource}.reordered`, resourceType: ({ countries: 'COUNTRY', universities: 'UNIVERSITY', scholarships: 'SCHOLARSHIP', services: 'SERVICE', articles: 'ARTICLE' } as const)[resource], resourceId: auditResourceId, metadata: { count: orderedIds.length } } })
      const recordsById = new Map(records.map((record) => [record.id, record]))
      return { outcome: 'UPDATED' as const, records: orderedIds.map((id, displayOrder) => asEntity({ ...recordsById.get(id)!, displayOrder })) }
    })
  }
  async list(
    resource: ContentResource,
    query: ContentListQuery,
    publicOnly: boolean,
    now: Date,
  ) {
    const visibility = publicOnly
      ? { status: 'PUBLISHED' as const }
      : query.status
        ? { status: query.status }
        : {}
    const pagination = { skip: skipFor(query), take: query.limit }
    const prisma = getPrisma()

    switch (resource) {
      case 'countries': {
        const where: Prisma.CountryWhereInput = {
          ...visibility,
          ...(query.featured === undefined ? {} : { featured: query.featured }),
          ...(query.search
            ? { OR: [
                { nameAr: { contains: query.search, mode: 'insensitive' } },
                { nameEn: { contains: query.search, mode: 'insensitive' } },
                { introductionAr: { contains: query.search, mode: 'insensitive' } },
              ] }
            : {}),
        }
        const orderBy: Prisma.CountryOrderByWithRelationInput[] =
          query.sort === 'newest'
            ? [{ createdAt: 'desc' }, { id: 'asc' }]
            : [{ displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await Promise.all([
          prisma.country.findMany({ where, orderBy, ...pagination }),
          prisma.country.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'universities': {
        const where: Prisma.UniversityWhereInput = {
          ...visibility,
          ...universityDirectoryWhere(universityListFilters(query)),
        }
        const orderBy: Prisma.UniversityOrderByWithRelationInput[] =
          query.sort === 'name'
            ? [{ nameAr: 'asc' }, { id: 'asc' }]
            : publicOnly && query.sort === undefined
              ? [{ displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
              : [{ createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await Promise.all([
          prisma.university.findMany({
            where, orderBy, ...pagination,
            include: { country: relationSelections.country, city: relationSelections.city },
          }),
          prisma.university.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'scholarships': {
        const directoryFilters = scholarshipUniversityFilters(query)
        const hasDirectoryFilters = Object.keys(directoryFilters).length > 0
        const effectiveApplicationStatus: Prisma.ScholarshipWhereInput | undefined = query.applicationStatus === 'CLOSED'
          ? { OR: [
              { applicationStatus: 'CLOSED' as const },
              { verifiedDeadline: { lt: now } },
            ] }
          : query.applicationStatus === 'OPEN'
            ? {
                applicationStatus: 'OPEN' as const,
                OR: [
                  { verifiedDeadline: null },
                  { verifiedDeadline: { gte: now } },
                ],
              }
            : undefined
        const search: Prisma.ScholarshipWhereInput | undefined = query.search
          ? { OR: [
              { titleAr: { contains: query.search, mode: 'insensitive' } },
              { titleEn: { contains: query.search, mode: 'insensitive' } },
              { descriptionAr: { contains: query.search, mode: 'insensitive' } },
            ] }
          : undefined
        const where: Prisma.ScholarshipWhereInput = {
          ...visibility,
          ...(query.featured === undefined ? {} : { featured: query.featured }),
          ...(query.country ? { country: { slug: query.country } } : {}),
          ...(hasDirectoryFilters
            ? { university: { is: {
                status: 'PUBLISHED',
                ...(query.university ? { slug: query.university } : {}),
                ...universityDirectoryWhere(directoryFilters),
              } } }
            : query.university ? { university: { slug: query.university } } : {}),
          ...(query.studyLevel ? { studyLevel: query.studyLevel } : {}),
          ...(query.fundingType ? { fundingType: query.fundingType } : {}),
          ...(
            effectiveApplicationStatus || search
              ? { AND: [effectiveApplicationStatus, search].filter(
                  (condition): condition is Prisma.ScholarshipWhereInput => Boolean(condition),
                ) }
              : {}
          ),
        }
        const orderBy: Prisma.ScholarshipOrderByWithRelationInput[] = publicOnly
          ? query.sort === 'deadline'
            ? [{ featured: 'desc' }, { verifiedDeadline: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
            : query.sort === 'newest'
              ? [{ featured: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]
              : [{ featured: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
          : query.sort === 'deadline'
            ? [{ verifiedDeadline: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await Promise.all([
          prisma.scholarship.findMany({
            where, orderBy, ...pagination,
            include: {
              country: relationSelections.country,
              university: relationSelections.university,
            },
          }),
          prisma.scholarship.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'services': {
        const where: Prisma.ServiceWhereInput = {
          ...visibility,
          ...(query.featured === undefined ? {} : { featured: query.featured }),
        }
        const orderBy: Prisma.ServiceOrderByWithRelationInput[] =
          query.sort === 'newest'
            ? [{ createdAt: 'desc' }, { id: 'asc' }]
            : [{ displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await Promise.all([
          prisma.service.findMany({ where, orderBy, ...pagination }),
          prisma.service.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'articles': {
        const where: Prisma.ArticleWhereInput = {
          ...visibility,
          ...(query.featured === undefined ? {} : { featured: query.featured }),
          ...(query.country ? { country: { slug: query.country } } : {}),
          ...(query.search
            ? { OR: [
                { titleAr: { contains: query.search, mode: 'insensitive' } },
                { titleEn: { contains: query.search, mode: 'insensitive' } },
                { summaryAr: { contains: query.search, mode: 'insensitive' } },
              ] }
            : {}),
        }
        const orderBy: Prisma.ArticleOrderByWithRelationInput[] = publicOnly && query.sort === undefined
          ? [{ displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await Promise.all([
          prisma.article.findMany({
            where,
            orderBy,
            ...pagination,
            include: {
              country: relationSelections.country,
              university: relationSelections.university,
              scholarship: { select: { id: true, slug: true, titleAr: true } },
            },
          }),
          prisma.article.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
    }
  }

  async findById(resource: ContentResource, id: string) {
    const prisma = getPrisma()
    const record = await (async () => {
      switch (resource) {
        case 'countries': return prisma.country.findUnique({ where: { id }, include: { studyGuideSections: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'universities': return prisma.university.findUnique({ where: { id }, include: { country: relationSelections.country, city: relationSelections.city } })
        case 'scholarships': return prisma.scholarship.findUnique({ where: { id }, include: { country: relationSelections.country, university: relationSelections.university, detailItems: { orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'services': return prisma.service.findUnique({ where: { id }, include: { detailItems: { orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'articles': return prisma.article.findUnique({ where: { id }, include: articleInclude(false) })
      }
    })()
    return record ? asResourceEntity(resource, record) : null
  }

  async findBySlug(resource: ContentResource, slug: string, publicOnly: boolean) {
    const prisma = getPrisma()
    const status = publicOnly ? { status: 'PUBLISHED' as const } : {}
    const record = await (async () => {
      switch (resource) {
        case 'countries': return prisma.country.findFirst({ where: { slug, ...status }, include: { studyGuideSections: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'universities': return prisma.university.findFirst({ where: { slug, ...status }, include: { country: relationSelections.country, city: relationSelections.city } })
        case 'scholarships': return prisma.scholarship.findFirst({ where: { slug, ...status }, include: { country: relationSelections.country, university: relationSelections.university, detailItems: { orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'services': return prisma.service.findFirst({ where: { slug, ...status }, include: { detailItems: { orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }] } } })
        case 'articles': return prisma.article.findFirst({ where: { slug, ...status }, include: articleInclude(publicOnly) })
      }
    })()
    return record ? asResourceEntity(resource, record) : null
  }

  async findCityById(id: string) {
    return getPrisma().city.findUnique({ where: { id }, select: { id: true, countryId: true, slug: true } })
  }

  async countScholarshipsByIds(ids: string[]) {
    return getPrisma().scholarship.count({ where: { id: { in: ids } } })
  }

  async scholarshipFilterOptions() {
    const [studyLevels, fundingTypes] = await Promise.all([
      getPrisma().scholarship.groupBy({ by: ['studyLevel'], where: { status: 'PUBLISHED', studyLevel: { not: '' } }, _count: { _all: true }, orderBy: { studyLevel: 'asc' } }),
      getPrisma().scholarship.groupBy({ by: ['fundingType'], where: { status: 'PUBLISHED', fundingType: { not: '' } }, _count: { _all: true }, orderBy: { fundingType: 'asc' } }),
    ])
    return { studyLevels: studyLevels.map((row) => ({ value: row.studyLevel, count: row._count._all })), fundingTypes: fundingTypes.map((row) => ({ value: row.fundingType, count: row._count._all })) }
  }

  async create(
    resource: ContentResource,
    data: ContentWriteData,
    audit: AuditIntent,
  ) {
    const prisma = getPrisma()
    try {
      return await prisma.$transaction(async (transaction) => {
        const record = await (async () => {
          switch (resource) {
            case 'countries': return transaction.country.create({ data: data as unknown as Prisma.CountryUncheckedCreateInput })
            case 'universities': return transaction.university.create({ data: data as unknown as Prisma.UniversityUncheckedCreateInput, include: { country: relationSelections.country, city: relationSelections.city } })
            case 'scholarships': return transaction.scholarship.create({ data: data as unknown as Prisma.ScholarshipUncheckedCreateInput, include: { country: relationSelections.country, university: relationSelections.university } })
            case 'services': return transaction.service.create({ data: data as unknown as Prisma.ServiceUncheckedCreateInput })
            case 'articles': {
              const { scholarshipIds, ...fields } = data
              const ids = Array.isArray(scholarshipIds) ? scholarshipIds as string[] : []
              return transaction.article.create({
                data: {
                  ...fields as unknown as Prisma.ArticleUncheckedCreateInput,
                  relatedScholarships: { create: ids.map((scholarshipId, displayOrder) => ({ scholarshipId, displayOrder })) },
                },
                include: articleInclude(false),
              })
            }
          }
        })()
        await transaction.adminAuditLog.create({ data: auditData(audit, record.id) })
        return asResourceEntity(resource, record)
      })
    } catch (error) {
      return handleWriteError(error)
    }
  }

  async update(
    resource: ContentResource,
    id: string,
    data: ContentWriteData,
    audit: AuditIntent,
  ) {
    const prisma = getPrisma()
    try {
      return await prisma.$transaction(async (transaction) => {
        const record = await (async () => {
          switch (resource) {
            case 'countries': return transaction.country.update({ where: { id }, data: data as unknown as Prisma.CountryUncheckedUpdateInput })
            case 'universities': return transaction.university.update({ where: { id }, data: data as unknown as Prisma.UniversityUncheckedUpdateInput, include: { country: relationSelections.country, city: relationSelections.city } })
            case 'scholarships': return transaction.scholarship.update({ where: { id }, data: data as unknown as Prisma.ScholarshipUncheckedUpdateInput, include: { country: relationSelections.country, university: relationSelections.university } })
            case 'services': return transaction.service.update({ where: { id }, data: data as unknown as Prisma.ServiceUncheckedUpdateInput })
            case 'articles': {
              const { scholarshipIds, ...fields } = data
              const replacesAssociations = Array.isArray(scholarshipIds)
              const ids = replacesAssociations ? scholarshipIds as string[] : []
              return transaction.article.update({
                where: { id },
                data: {
                  ...fields as unknown as Prisma.ArticleUncheckedUpdateInput,
                  ...(replacesAssociations ? { relatedScholarships: {
                    deleteMany: {},
                    create: ids.map((scholarshipId, displayOrder) => ({ scholarshipId, displayOrder })),
                  } } : {}),
                },
                include: articleInclude(false),
              })
            }
          }
        })()
        await transaction.adminAuditLog.create({ data: auditData(audit, id) })
        return asResourceEntity(resource, record)
      })
    } catch (error) {
      return handleWriteError(error)
    }
  }
}
