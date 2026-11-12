import { Prisma, type AcademicMajor, type City, type UniversityProgram } from '../generated/prisma/client.js'
import { getPrisma } from '../database/client.js'
import type { PublicationStatus } from '../content/types.js'
import type {
  AcademicMajorRecord,
  AcademicMajorUpdateInput,
  CatalogListQuery,
  CityRecord,
  CityUpdateInput,
  FilterOptions,
  ProgramCreateInput,
  ProgramListQuery,
  ProgramStudyLevel,
  ProgramUpdateInput,
  TeachingLanguage,
  UniversityDirectoryFilters,
  UniversityDirectoryRepository,
  UniversityProgramRecord,
} from './types.js'

type ProgramWithRelations = UniversityProgram & {
  academicMajor: AcademicMajor
  languages: Array<{ language: TeachingLanguage }>
  tuitionFees: Array<{
    id: string
    amount: { toString(): string }
    currency: string
    billingPeriod: string
    academicYear: string
    createdAt: Date
    updatedAt: Date
  }>
}

type CountRow = { value: string; count: bigint | number }
type MajorRow = CountRow & { id: string; slug: string; nameAr: string; nameEn: string; category: string | null }
type CityRow = CountRow & { id: string; slug: string; nameAr: string; nameEn: string; countryId: string }

const PROGRAM_LOCK = 9_000_011
const includeProgram = {
  academicMajor: true,
  languages: { select: { language: true }, orderBy: { language: 'asc' as const } },
  tuitionFees: { orderBy: [{ academicYear: 'desc' as const }, { id: 'asc' as const }] as Prisma.UniversityProgramTuitionOrderByWithRelationInput[] },
} as const

const asProgram = (record: ProgramWithRelations): UniversityProgramRecord => ({
  ...record,
  studyLevel: record.studyLevel as ProgramStudyLevel,
  status: record.status as PublicationStatus,
  languages: record.languages.map(({ language }) => language as TeachingLanguage),
  durationUnit: record.durationUnit as UniversityProgramRecord['durationUnit'],
  tuitionFees: record.tuitionFees.map((fee) => ({
    id: fee.id,
    amount: fee.amount.toString(),
    currency: fee.currency,
    billingPeriod: fee.billingPeriod as UniversityProgramRecord['tuitionFees'][number]['billingPeriod'],
    academicYear: fee.academicYear,
    createdAt: fee.createdAt,
    updatedAt: fee.updatedAt,
  })),
  academicMajor: {
    id: record.academicMajor.id,
    slug: record.academicMajor.slug,
    nameAr: record.academicMajor.nameAr,
    nameEn: record.academicMajor.nameEn,
    category: record.academicMajor.category,
  },
})

const asMajor = (record: AcademicMajor): AcademicMajorRecord => ({ ...record })
const asCity = (record: City & { country?: CityRecord['country'] }): CityRecord => {
  const city: CityRecord = {
    id: record.id,
    countryId: record.countryId,
    slug: record.slug,
    nameAr: record.nameAr,
    nameEn: record.nameEn,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  if (record.country) city.country = record.country
  return city
}
const countValue = (value: bigint | number) => Number(value)
const sqlAnd = (conditions: Prisma.Sql[]) => conditions.length > 0
  ? Prisma.sql` AND ${Prisma.join(conditions, ' AND ')}`
  : Prisma.empty

const baseConditions = (filters: UniversityDirectoryFilters, exclude?: 'city' | 'universityType') => {
  const conditions: Prisma.Sql[] = []
  if (filters.search) {
    const pattern = `%${filters.search}%`
    conditions.push(Prisma.sql`(u."nameAr" ILIKE ${pattern} OR u."nameEn" ILIKE ${pattern} OR u."officialName" ILIKE ${pattern} OR u."cityAr" ILIKE ${pattern})`)
  }
  if (filters.country) conditions.push(Prisma.sql`co."slug" = ${filters.country}`)
  if (filters.featured !== undefined) conditions.push(Prisma.sql`u."featured" = ${filters.featured}`)
  if (filters.city && exclude !== 'city') conditions.push(Prisma.sql`ci."slug" = ${filters.city}`)
  if (filters.universityType && exclude !== 'universityType') conditions.push(Prisma.sql`u."universityType" = CAST(${filters.universityType} AS "UniversityType")`)
  return conditions
}

const programConditions = (
  filters: UniversityDirectoryFilters,
  exclude?: 'major' | 'studyLevel' | 'language',
) => {
  const conditions: Prisma.Sql[] = []
  if (filters.major && exclude !== 'major') conditions.push(Prisma.sql`m."slug" = ${filters.major}`)
  if (filters.studyLevel && exclude !== 'studyLevel') conditions.push(Prisma.sql`p."studyLevel" = CAST(${filters.studyLevel} AS "ProgramStudyLevel")`)
  if (filters.language && exclude !== 'language') {
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "UniversityProgramLanguage" selected_language WHERE selected_language."programId" = p."id" AND selected_language."language" = CAST(${filters.language} AS "TeachingLanguage"))`)
  }
  return conditions
}

const programExists = (filters: UniversityDirectoryFilters) => {
  const conditions = programConditions(filters)
  if (conditions.length === 0) return Prisma.empty
  return Prisma.sql` AND EXISTS (
    SELECT 1 FROM "UniversityProgram" p
    JOIN "AcademicMajor" m ON m."id" = p."academicMajorId"
    WHERE p."universityId" = u."id"
      AND p."status" = CAST('PUBLISHED' AS "PublicationStatus")
      ${sqlAnd(conditions)}
  )`
}

const auditMetadata = (metadata: Record<string, unknown>) => metadata as Prisma.InputJsonValue

export class PrismaUniversityDirectoryRepository implements UniversityDirectoryRepository {
  async resolvePublishedUniversity(slug: string) {
    return (await getPrisma().university.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } }))?.id ?? null
  }

  async universityExists(id: string) {
    return await getPrisma().university.count({ where: { id } }) === 1
  }

  async majorExists(id: string) {
    return await getPrisma().academicMajor.count({ where: { id } }) === 1
  }

  async listPrograms(universityId: string, query: ProgramListQuery, publicOnly: boolean) {
    const where: Prisma.UniversityProgramWhereInput = {
      universityId,
      ...(publicOnly ? { status: 'PUBLISHED' } : query.status ? { status: query.status } : {}),
      ...(publicOnly ? { university: { status: 'PUBLISHED' } } : {}),
      ...(query.studyLevel ? { studyLevel: query.studyLevel } : {}),
      ...(query.language ? { languages: { some: { language: query.language } } } : {}),
      ...(query.faculty ? { OR: [
        { facultyNameAr: { contains: query.faculty, mode: 'insensitive' } },
        { facultyNameEn: { contains: query.faculty, mode: 'insensitive' } },
      ] } : {}),
      ...(query.search ? { AND: [{ OR: [
        { nameAr: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
        { academicMajor: { nameAr: { contains: query.search, mode: 'insensitive' } } },
        { academicMajor: { nameEn: { contains: query.search, mode: 'insensitive' } } },
      ] }] } : {}),
    }
    const [items, total] = await Promise.all([
      getPrisma().universityProgram.findMany({
        where,
        include: includeProgram,
        orderBy: [{ nameAr: { sort: 'asc', nulls: 'last' } }, { academicMajor: { nameAr: 'asc' } }, { studyLevel: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      getPrisma().universityProgram.count({ where }),
    ])
    return { items: items.map((record) => asProgram(record as ProgramWithRelations)), total }
  }

  async createProgram(input: ProgramCreateInput, actorAdminId: string, now: Date) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${PROGRAM_LOCK})`
        if (await transaction.university.count({ where: { id: input.universityId } }) !== 1) return { outcome: 'UNIVERSITY_NOT_FOUND' as const }
        if (await transaction.academicMajor.count({ where: { id: input.academicMajorId } }) !== 1) return { outcome: 'MAJOR_NOT_FOUND' as const }
        const record = await transaction.universityProgram.create({
          data: {
            universityId: input.universityId,
            academicMajorId: input.academicMajorId,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            facultyNameAr: input.facultyNameAr ?? null,
            facultyNameEn: input.facultyNameEn ?? null,
            durationValue: input.durationValue ?? null,
            durationUnit: input.durationUnit ?? null,
            studyLevel: input.studyLevel,
            status: input.status,
            officialSourceUrl: input.officialSourceUrl,
            verifiedAt: input.verifiedAt,
            publishedAt: input.status === 'PUBLISHED' ? now : null,
            languages: { create: input.languages.map((language) => ({ language })) },
            ...(input.tuition ? { tuitionFees: { create: input.tuition } } : {}),
          },
          include: includeProgram,
        })
        await transaction.adminAuditLog.create({ data: {
          actorAdminId,
          action: 'university_program.created',
          resourceType: 'UNIVERSITY_PROGRAM',
          resourceId: record.id,
          metadata: auditMetadata({ universityId: input.universityId, academicMajorId: input.academicMajorId, studyLevel: input.studyLevel, languageCount: input.languages.length, status: input.status, hasTuition: Boolean(input.tuition) }),
        } })
        return { outcome: 'UPDATED' as const, record: asProgram(record as ProgramWithRelations) }
      }, { maxWait: 15_000, timeout: 15_000 })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async updateProgram(id: string, input: ProgramUpdateInput, actorAdminId: string, now: Date) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${PROGRAM_LOCK})`
        const current = await transaction.universityProgram.findUnique({ where: { id }, include: includeProgram })
        if (!current) return { outcome: 'NOT_FOUND' as const }
        if (input.academicMajorId && await transaction.academicMajor.count({ where: { id: input.academicMajorId } }) !== 1) return { outcome: 'MAJOR_NOT_FOUND' as const }
        const nextStatus = input.status ?? current.status
        const nextNameAr = input.nameAr ?? current.nameAr
        const nextLanguageCount = input.languages?.length ?? current.languages.length
        if (nextStatus === 'PUBLISHED' && (!nextNameAr || nextLanguageCount === 0)) return { outcome: 'PUBLICATION_REQUIREMENTS' as const }
        const data: Prisma.UniversityProgramUpdateInput = {
          ...(input.academicMajorId ? { academicMajor: { connect: { id: input.academicMajorId } } } : {}),
          ...(input.studyLevel ? { studyLevel: input.studyLevel } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.facultyNameAr !== undefined ? { facultyNameAr: input.facultyNameAr } : {}),
          ...(input.facultyNameEn !== undefined ? { facultyNameEn: input.facultyNameEn } : {}),
          ...(input.durationValue !== undefined ? { durationValue: input.durationValue } : {}),
          ...(input.durationUnit !== undefined ? { durationUnit: input.durationUnit } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.officialSourceUrl ? { officialSourceUrl: input.officialSourceUrl } : {}),
          ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
          ...(nextStatus === 'PUBLISHED' && current.publishedAt === null ? { publishedAt: now } : {}),
          ...(input.languages ? { languages: { deleteMany: {}, create: input.languages.map((language) => ({ language })) } } : {}),
          ...(input.tuition ? { tuitionFees: { upsert: {
            where: { programId_academicYear: { programId: id, academicYear: input.tuition.academicYear } },
            create: input.tuition,
            update: { amount: input.tuition.amount, currency: input.tuition.currency, billingPeriod: input.tuition.billingPeriod },
          } } } : {}),
        }
        const record = await transaction.universityProgram.update({ where: { id }, data, include: includeProgram })
        const changedFields = Object.keys(input).sort()
        const action = nextStatus === 'ARCHIVED' && current.status !== 'ARCHIVED'
          ? 'university_program.archived'
          : nextStatus === 'PUBLISHED' && current.status !== 'PUBLISHED'
            ? 'university_program.published'
            : current.status === 'PUBLISHED' && nextStatus !== 'PUBLISHED'
              ? 'university_program.unpublished'
              : 'university_program.updated'
        await transaction.adminAuditLog.create({ data: {
          actorAdminId,
          action,
          resourceType: 'UNIVERSITY_PROGRAM',
          resourceId: id,
          metadata: auditMetadata({
            universityId: current.universityId,
            academicMajorId: record.academicMajorId,
            changedFields,
            ...(current.status !== nextStatus ? { fromStatus: current.status, toStatus: nextStatus } : {}),
          }),
        } })
        return { outcome: 'UPDATED' as const, record: asProgram(record as ProgramWithRelations) }
      }, { maxWait: 15_000, timeout: 15_000 })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async filterOptions(filters: UniversityDirectoryFilters): Promise<FilterOptions> {
    const prisma = getPrisma()
    const joins = Prisma.sql`FROM "University" u JOIN "Country" co ON co."id" = u."countryId" LEFT JOIN "City" ci ON ci."id" = u."cityId"`
    const majors = await prisma.$queryRaw<MajorRow[]>(Prisma.sql`
      SELECT m."id", m."slug", m."nameAr", m."nameEn", m."category", m."slug" AS value, COUNT(DISTINCT u."id")::int AS count
      FROM "AcademicMajor" m JOIN "UniversityProgram" p ON p."academicMajorId" = m."id"
      JOIN "University" u ON u."id" = p."universityId" JOIN "Country" co ON co."id" = u."countryId" LEFT JOIN "City" ci ON ci."id" = u."cityId"
      WHERE u."status" = CAST('PUBLISHED' AS "PublicationStatus") AND p."status" = CAST('PUBLISHED' AS "PublicationStatus")
      ${sqlAnd(baseConditions(filters))}${sqlAnd(programConditions(filters, 'major'))}
      GROUP BY m."id" ORDER BY m."nameAr" ASC, m."slug" ASC LIMIT 500`)
    const levels = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT p."studyLevel"::text AS value, COUNT(DISTINCT u."id")::int AS count
      FROM "UniversityProgram" p JOIN "AcademicMajor" m ON m."id" = p."academicMajorId"
      JOIN "University" u ON u."id" = p."universityId" JOIN "Country" co ON co."id" = u."countryId" LEFT JOIN "City" ci ON ci."id" = u."cityId"
      WHERE u."status" = CAST('PUBLISHED' AS "PublicationStatus") AND p."status" = CAST('PUBLISHED' AS "PublicationStatus")
      ${sqlAnd(baseConditions(filters))}${sqlAnd(programConditions(filters, 'studyLevel'))}
      GROUP BY p."studyLevel" ORDER BY p."studyLevel" ASC`)
    const languages = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT pl."language"::text AS value, COUNT(DISTINCT u."id")::int AS count
      FROM "UniversityProgramLanguage" pl JOIN "UniversityProgram" p ON p."id" = pl."programId" JOIN "AcademicMajor" m ON m."id" = p."academicMajorId"
      JOIN "University" u ON u."id" = p."universityId" JOIN "Country" co ON co."id" = u."countryId" LEFT JOIN "City" ci ON ci."id" = u."cityId"
      WHERE u."status" = CAST('PUBLISHED' AS "PublicationStatus") AND p."status" = CAST('PUBLISHED' AS "PublicationStatus")
      ${sqlAnd(baseConditions(filters))}${sqlAnd(programConditions(filters, 'language'))}
      GROUP BY pl."language" ORDER BY pl."language" ASC`)
    const cities = await prisma.$queryRaw<CityRow[]>(Prisma.sql`
      SELECT ci."id", ci."slug", ci."nameAr", ci."nameEn", ci."countryId", ci."slug" AS value, COUNT(DISTINCT u."id")::int AS count
      ${joins}
      WHERE u."status" = CAST('PUBLISHED' AS "PublicationStatus") AND ci."id" IS NOT NULL
      ${sqlAnd(baseConditions(filters, 'city'))}${programExists(filters)}
      GROUP BY ci."id" ORDER BY ci."nameAr" ASC, ci."slug" ASC LIMIT 500`)
    const types = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT u."universityType"::text AS value, COUNT(DISTINCT u."id")::int AS count
      ${joins}
      WHERE u."status" = CAST('PUBLISHED' AS "PublicationStatus") AND u."universityType" IS NOT NULL
      ${sqlAnd(baseConditions(filters, 'universityType'))}${programExists(filters)}
      GROUP BY u."universityType" ORDER BY u."universityType" ASC`)
    return {
      majors: majors.map((row) => ({ ...row, count: countValue(row.count) })),
      studyLevels: levels.map((row) => ({ value: row.value, count: countValue(row.count) })),
      languages: languages.map((row) => ({ value: row.value, count: countValue(row.count) })),
      cities: cities.map((row) => ({ ...row, count: countValue(row.count) })),
      universityTypes: types.map((row) => ({ value: row.value, count: countValue(row.count) })),
    }
  }

  async listMajors(query: CatalogListQuery) {
    const where: Prisma.AcademicMajorWhereInput = query.search ? { OR: [
      { slug: { contains: query.search, mode: 'insensitive' } },
      { nameAr: { contains: query.search, mode: 'insensitive' } },
      { nameEn: { contains: query.search, mode: 'insensitive' } },
      { category: { contains: query.search, mode: 'insensitive' } },
    ] } : {}
    const [items, total] = await Promise.all([
      getPrisma().academicMajor.findMany({ where, orderBy: [{ nameAr: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      getPrisma().academicMajor.count({ where }),
    ])
    return { items: items.map(asMajor), total }
  }

  async createMajor(input: Pick<AcademicMajorRecord, 'slug' | 'nameAr' | 'nameEn' | 'category'>, actorAdminId: string) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        const record = await transaction.academicMajor.create({ data: input })
        await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'academic_major.created', resourceType: 'ACADEMIC_MAJOR', resourceId: record.id, metadata: auditMetadata({ slug: record.slug, category: record.category }) } })
        return { outcome: 'UPDATED' as const, record: asMajor(record) }
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async updateMajor(id: string, input: AcademicMajorUpdateInput, actorAdminId: string) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        const current = await transaction.academicMajor.findUnique({ where: { id } })
        if (!current) return { outcome: 'NOT_FOUND' as const }
        const record = await transaction.academicMajor.update({ where: { id }, data: input })
        await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'academic_major.updated', resourceType: 'ACADEMIC_MAJOR', resourceId: id, metadata: auditMetadata({ changedFields: Object.keys(input).sort() }) } })
        return { outcome: 'UPDATED' as const, record: asMajor(record) }
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async deleteMajor(id: string, actorAdminId: string) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.academicMajor.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      if (await transaction.universityProgram.count({ where: { academicMajorId: id } }) > 0) return { outcome: 'IN_USE' as const }
      await transaction.academicMajor.delete({ where: { id } })
      await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'academic_major.deleted', resourceType: 'ACADEMIC_MAJOR', resourceId: id, metadata: auditMetadata({ slug: current.slug }) } })
      return { outcome: 'DELETED' as const }
    })
  }

  async listCities(query: CatalogListQuery) {
    const where: Prisma.CityWhereInput = {
      ...(query.countryId ? { countryId: query.countryId } : {}),
      ...(query.search ? { OR: [
        { slug: { contains: query.search, mode: 'insensitive' } },
        { nameAr: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ] } : {}),
    }
    const include = { country: { select: { id: true, slug: true, nameAr: true, nameEn: true } } } as const
    const [items, total] = await Promise.all([
      getPrisma().city.findMany({ where, include, orderBy: [{ nameAr: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      getPrisma().city.count({ where }),
    ])
    return { items: items.map((record) => asCity(record)), total }
  }

  async createCity(input: Pick<CityRecord, 'countryId' | 'slug' | 'nameAr' | 'nameEn'>, actorAdminId: string) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        if (await transaction.country.count({ where: { id: input.countryId } }) !== 1) return { outcome: 'COUNTRY_NOT_FOUND' as const }
        const record = await transaction.city.create({ data: input, include: { country: { select: { id: true, slug: true, nameAr: true, nameEn: true } } } })
        await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'city.created', resourceType: 'CITY', resourceId: record.id, metadata: auditMetadata({ countryId: record.countryId, slug: record.slug }) } })
        return { outcome: 'UPDATED' as const, record: asCity(record) }
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async updateCity(id: string, input: CityUpdateInput, actorAdminId: string) {
    try {
      return await getPrisma().$transaction(async (transaction) => {
        const current = await transaction.city.findUnique({ where: { id } })
        if (!current) return { outcome: 'NOT_FOUND' as const }
        if (input.countryId && input.countryId !== current.countryId) {
          if (await transaction.university.count({ where: { cityId: id } }) > 0) return { outcome: 'CONFLICT' as const }
          if (await transaction.country.count({ where: { id: input.countryId } }) !== 1) return { outcome: 'COUNTRY_NOT_FOUND' as const }
        }
        const record = await transaction.city.update({ where: { id }, data: input, include: { country: { select: { id: true, slug: true, nameAr: true, nameEn: true } } } })
        await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'city.updated', resourceType: 'CITY', resourceId: id, metadata: auditMetadata({ changedFields: Object.keys(input).sort() }) } })
        return { outcome: 'UPDATED' as const, record: asCity(record) }
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { outcome: 'CONFLICT' as const }
      throw error
    }
  }

  async deleteCity(id: string, actorAdminId: string) {
    return getPrisma().$transaction(async (transaction) => {
      const current = await transaction.city.findUnique({ where: { id } })
      if (!current) return { outcome: 'NOT_FOUND' as const }
      if (await transaction.university.count({ where: { cityId: id } }) > 0) return { outcome: 'IN_USE' as const }
      await transaction.city.delete({ where: { id } })
      await transaction.adminAuditLog.create({ data: { actorAdminId, action: 'city.deleted', resourceType: 'CITY', resourceId: id, metadata: auditMetadata({ slug: current.slug, countryId: current.countryId }) } })
      return { outcome: 'DELETED' as const }
    })
  }
}
