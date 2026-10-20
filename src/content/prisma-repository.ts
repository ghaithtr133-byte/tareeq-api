import { getPrisma } from '../database/client.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ApiError } from '../shared/http.js'
import type {
  ContentEntity,
  ContentListQuery,
  ContentRepository,
  ContentResource,
  ContentWriteData,
} from './types.js'

const relationSelections = {
  country: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
  university: { select: { id: true, slug: true, nameAr: true } },
} as const

const asEntity = (value: unknown) => value as ContentEntity
const asEntities = (value: unknown[]) => value.map(asEntity)
const skipFor = (query: ContentListQuery) => (query.page - 1) * query.limit

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
        const [items, total] = await prisma.$transaction([
          prisma.country.findMany({ where, orderBy, ...pagination }),
          prisma.country.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'universities': {
        const where: Prisma.UniversityWhereInput = {
          ...visibility,
          ...(query.featured === undefined ? {} : { featured: query.featured }),
          ...(query.country ? { country: { slug: query.country } } : {}),
          ...(query.search
            ? { OR: [
                { nameAr: { contains: query.search, mode: 'insensitive' } },
                { nameEn: { contains: query.search, mode: 'insensitive' } },
                { officialName: { contains: query.search, mode: 'insensitive' } },
                { cityAr: { contains: query.search, mode: 'insensitive' } },
              ] }
            : {}),
        }
        const orderBy: Prisma.UniversityOrderByWithRelationInput[] =
          query.sort === 'name'
            ? [{ nameAr: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'asc' }]
        const [items, total] = await prisma.$transaction([
          prisma.university.findMany({
            where, orderBy, ...pagination,
            include: { country: relationSelections.country },
          }),
          prisma.university.count({ where }),
        ])
        return { items: asEntities(items), total }
      }
      case 'scholarships': {
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
          ...(query.university ? { university: { slug: query.university } } : {}),
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
        const [items, total] = await prisma.$transaction([
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
        const [items, total] = await prisma.$transaction([
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
        const [items, total] = await prisma.$transaction([
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
        case 'countries': return prisma.country.findUnique({ where: { id } })
        case 'universities': return prisma.university.findUnique({ where: { id }, include: { country: relationSelections.country } })
        case 'scholarships': return prisma.scholarship.findUnique({ where: { id }, include: { country: relationSelections.country, university: relationSelections.university } })
        case 'services': return prisma.service.findUnique({ where: { id } })
        case 'articles': return prisma.article.findUnique({ where: { id }, include: { country: relationSelections.country, university: relationSelections.university, scholarship: { select: { id: true, slug: true, titleAr: true } } } })
      }
    })()
    return record ? asEntity(record) : null
  }

  async findBySlug(resource: ContentResource, slug: string, publicOnly: boolean) {
    const prisma = getPrisma()
    const status = publicOnly ? { status: 'PUBLISHED' as const } : {}
    const record = await (async () => {
      switch (resource) {
        case 'countries': return prisma.country.findFirst({ where: { slug, ...status } })
        case 'universities': return prisma.university.findFirst({ where: { slug, ...status }, include: { country: relationSelections.country } })
        case 'scholarships': return prisma.scholarship.findFirst({ where: { slug, ...status }, include: { country: relationSelections.country, university: relationSelections.university } })
        case 'services': return prisma.service.findFirst({ where: { slug, ...status } })
        case 'articles': return prisma.article.findFirst({ where: { slug, ...status }, include: { country: relationSelections.country, university: relationSelections.university, scholarship: { select: { id: true, slug: true, titleAr: true } } } })
      }
    })()
    return record ? asEntity(record) : null
  }

  async create(resource: ContentResource, data: ContentWriteData) {
    const prisma = getPrisma()
    try {
      switch (resource) {
        case 'countries': return asEntity(await prisma.country.create({ data: data as unknown as Prisma.CountryUncheckedCreateInput }))
        case 'universities': return asEntity(await prisma.university.create({ data: data as unknown as Prisma.UniversityUncheckedCreateInput, include: { country: relationSelections.country } }))
        case 'scholarships': return asEntity(await prisma.scholarship.create({ data: data as unknown as Prisma.ScholarshipUncheckedCreateInput, include: { country: relationSelections.country, university: relationSelections.university } }))
        case 'services': return asEntity(await prisma.service.create({ data: data as unknown as Prisma.ServiceUncheckedCreateInput }))
        case 'articles': return asEntity(await prisma.article.create({ data: data as unknown as Prisma.ArticleUncheckedCreateInput }))
      }
    } catch (error) {
      return handleWriteError(error)
    }
  }

  async update(resource: ContentResource, id: string, data: ContentWriteData) {
    const prisma = getPrisma()
    try {
      switch (resource) {
        case 'countries': return asEntity(await prisma.country.update({ where: { id }, data: data as unknown as Prisma.CountryUncheckedUpdateInput }))
        case 'universities': return asEntity(await prisma.university.update({ where: { id }, data: data as unknown as Prisma.UniversityUncheckedUpdateInput, include: { country: relationSelections.country } }))
        case 'scholarships': return asEntity(await prisma.scholarship.update({ where: { id }, data: data as unknown as Prisma.ScholarshipUncheckedUpdateInput, include: { country: relationSelections.country, university: relationSelections.university } }))
        case 'services': return asEntity(await prisma.service.update({ where: { id }, data: data as unknown as Prisma.ServiceUncheckedUpdateInput }))
        case 'articles': return asEntity(await prisma.article.update({ where: { id }, data: data as unknown as Prisma.ArticleUncheckedUpdateInput }))
      }
    } catch (error) {
      return handleWriteError(error)
    }
  }
}
