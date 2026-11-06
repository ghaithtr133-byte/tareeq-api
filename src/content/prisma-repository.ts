import { getPrisma } from '../database/client.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ApiError } from '../shared/http.js'
import type { AuditIntent } from '../audit/types.js'
import type { UniversityDirectoryFilters } from '../university-directory/types.js'
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

export class PrismaContentRepository implements ContentRepository {
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
        const orderBy: Prisma.ScholarshipOrderByWithRelationInput[] =
          query.sort === 'deadline'
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
        const [items, total] = await Promise.all([
          prisma.article.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
