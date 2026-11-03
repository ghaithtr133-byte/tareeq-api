import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { z } from 'zod'

import { PrismaClient } from '../src/generated/prisma/client.js'
import type { Prisma } from '../src/generated/prisma/client.js'
import {
  applyCleanupPlan,
  applySeedPlan,
  type BatchStatus,
  type DemoSeedRepository,
  type DemoSeedWriter,
  type FixtureInspection,
  planDemoCleanup,
  planDemoSeed,
} from './demo-seed-core.js'
import {
  buildDemoFixtures,
  DEMO_OPERATIONAL_EXCLUSIONS,
  type DemoFixture,
  type DemoModel,
  type DemoVisibility,
  fixtureCounts,
  fixtureOwnershipHash,
} from './demo-seed-fixtures.js'

const reportsDirectory = resolve('reports/demo-seed')
const activeManifestPath = resolve(reportsDirectory, 'active.json')
const expectedMigrationDirectory = resolve('prisma/migrations')
const targetIdentitySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.-]+:\d{1,5}\/[A-Za-z0-9._-]+$/)

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('Tareeq Academy reversible demo seed'),
  batchId: z.uuid(),
  status: z.enum(['PLANNED', 'FAILED', 'COMMITTED', 'CLEANED']),
  visibility: z.enum(['private', 'published']),
  baseTimeUtc: z.iso.datetime(),
  createdAtUtc: z.iso.datetime(),
  updatedAtUtc: z.iso.datetime(),
  targetIdentityHash: z.string().regex(/^[a-f0-9]{64}$/),
  fixtureDigest: z.string().regex(/^[a-f0-9]{64}$/),
  records: z.array(z.object({
    key: z.string().min(1),
    model: z.string().min(1),
    id: z.string().nullable(),
    ownershipHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceUrl: z.url().nullable(),
  })),
})

type DemoManifest = z.infer<typeof manifestSchema>

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    if ('toFixed' in value && typeof value.toFixed === 'function') return value.toFixed(2)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

const matchesExpected = (actual: unknown, expected: Record<string, unknown>) => {
  if (!actual || typeof actual !== 'object') return false
  const selected = Object.fromEntries(
    Object.keys(expected).map((key) => [key, (actual as Record<string, unknown>)[key]]),
  )
  return JSON.stringify(canonical(selected)) === JSON.stringify(canonical(expected))
}

const fixtureDigest = (fixtures: DemoFixture[]) => createHash('sha256')
  .update(JSON.stringify(fixtures.map((fixture) => ({
    key: fixture.key,
    model: fixture.model,
    id: fixture.id,
    ownershipHash: fixtureOwnershipHash(fixture),
    sourceUrl: fixture.sourceUrl,
  }))))
  .digest('hex')

const targetIdentity = (databaseUrl: string) => {
  const parsed = new URL(databaseUrl)
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('BLOCKED — Demo seed requires a PostgreSQL connection URL.')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!parsed.hostname || !databaseName) {
    throw new Error('BLOCKED — Database target identity cannot be established.')
  }
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${databaseName}`
}

const hashTargetIdentity = (identity: string) =>
  createHash('sha256').update(identity).digest('hex')

const verifyTargetIdentity = (databaseUrl: string) => {
  const configured = targetIdentitySchema.safeParse(process.env.DEMO_SEED_TARGET_ID)
  if (!configured.success || configured.data !== targetIdentity(databaseUrl)) {
    throw new Error(
      'BLOCKED — DEMO_SEED_TARGET_ID is missing or does not match the configured database host, port, and database name.',
    )
  }
  return configured.data
}

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown

const loadManifest = async (batchId: string) => {
  try {
    return manifestSchema.parse(await readJson(resolve(reportsDirectory, `${batchId}.json`)))
  } catch (error) {
    throw new Error('BLOCKED — The requested demo-seed manifest is missing or invalid.', { cause: error })
  }
}

const loadActiveManifest = async (): Promise<DemoManifest | null> => {
  try {
    const pointer = z.object({ batchId: z.uuid() }).parse(await readJson(activeManifestPath))
    return loadManifest(pointer.batchId)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new Error('BLOCKED — The active demo-seed manifest pointer is invalid.', { cause: error })
    }
    throw error
  }
}

const saveManifest = async (manifest: DemoManifest) => {
  manifest.updatedAtUtc = new Date().toISOString()
  await mkdir(reportsDirectory, { recursive: true })
  await writeFile(
    resolve(reportsDirectory, `${manifest.batchId}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    activeManifestPath,
    `${JSON.stringify({ batchId: manifest.batchId }, null, 2)}\n`,
    'utf8',
  )
}

const validateManifestFixtures = (manifest: DemoManifest, fixtures: DemoFixture[]) => {
  if (manifest.fixtureDigest !== fixtureDigest(fixtures)) {
    throw new Error(
      'BLOCKED — Fixture definitions no longer match the saved batch manifest; automatic seed or cleanup is refused.',
    )
  }
  const expectedRecords = fixtures.map((fixture) => ({
    key: fixture.key,
    model: fixture.model,
    id: fixture.id,
    ownershipHash: fixtureOwnershipHash(fixture),
    sourceUrl: fixture.sourceUrl,
  }))
  if (JSON.stringify(manifest.records) !== JSON.stringify(expectedRecords)) {
    throw new Error('BLOCKED — Manifest record ownership does not match the fixture catalog.')
  }
}

const findActual = async (
  prisma: Prisma.TransactionClient | PrismaClient,
  fixture: DemoFixture,
): Promise<unknown> => {
  const data = fixture.data
  switch (fixture.model) {
    case 'Country': return prisma.country.findUnique({ where: { id: fixture.id! } })
    case 'City': return prisma.city.findUnique({ where: { id: fixture.id! } })
    case 'AcademicMajor': return prisma.academicMajor.findUnique({ where: { id: fixture.id! } })
    case 'University': return prisma.university.findUnique({ where: { id: fixture.id! } })
    case 'UniversityProgram': return prisma.universityProgram.findUnique({ where: { id: fixture.id! } })
    case 'UniversityProgramLanguage': return prisma.universityProgramLanguage.findUnique({
      where: { programId_language: { programId: String(data.programId), language: data.language as never } },
    })
    case 'UniversityProgramTuition': return prisma.universityProgramTuition.findUnique({ where: { id: fixture.id! } })
    case 'UniversityAdmissionRequirement': return prisma.universityAdmissionRequirement.findUnique({ where: { id: fixture.id! } })
    case 'UniversityGalleryImage': return prisma.universityGalleryImage.findUnique({ where: { id: fixture.id! } })
    case 'Scholarship': return prisma.scholarship.findUnique({ where: { id: fixture.id! } })
    case 'Service': return prisma.service.findUnique({ where: { id: fixture.id! } })
    case 'FaqEntry': return prisma.faqEntry.findUnique({ where: { id: fixture.id! } })
    case 'Article': return prisma.article.findUnique({ where: { id: fixture.id! } })
    case 'ArticleScholarship': return prisma.articleScholarship.findUnique({
      where: { articleId_scholarshipId: {
        articleId: String(data.articleId), scholarshipId: String(data.scholarshipId),
      } },
    })
    case 'StudentApplication': return prisma.studentApplication.findUnique({ where: { id: fixture.id! } })
    case 'GeneralInquiry': return prisma.generalInquiry.findUnique({ where: { id: fixture.id! } })
    case 'AnalyticsEvent': return prisma.analyticsEvent.findUnique({ where: { id: fixture.id! } })
  }
}

const hasUniqueCollision = async (
  prisma: Prisma.TransactionClient | PrismaClient,
  fixture: DemoFixture,
) => {
  const data = fixture.data
  switch (fixture.model) {
    case 'Country': return Boolean(await prisma.country.findUnique({ where: { slug: String(data.slug) } }))
    case 'City': return Boolean(await prisma.city.findUnique({ where: { slug: String(data.slug) } }))
    case 'AcademicMajor': return Boolean(await prisma.academicMajor.findUnique({ where: { slug: String(data.slug) } }))
    case 'University': return Boolean(await prisma.university.findUnique({ where: { slug: String(data.slug) } }))
    case 'Scholarship': return Boolean(await prisma.scholarship.findUnique({ where: { slug: String(data.slug) } }))
    case 'Service': return Boolean(await prisma.service.findUnique({ where: { slug: String(data.slug) } }))
    case 'Article': return Boolean(await prisma.article.findUnique({ where: { slug: String(data.slug) } }))
    case 'UniversityProgram': return Boolean(await prisma.universityProgram.findFirst({ where: {
      universityId: String(data.universityId), academicMajorId: String(data.academicMajorId),
      studyLevel: data.studyLevel as never, nameAr: data.nameAr as string | null,
    } }))
    case 'UniversityProgramTuition': return Boolean(await prisma.universityProgramTuition.findFirst({
      where: { programId: String(data.programId), academicYear: String(data.academicYear) },
    }))
    case 'ArticleScholarship': return Boolean(await prisma.articleScholarship.findFirst({
      where: { articleId: String(data.articleId), displayOrder: Number(data.displayOrder) },
    }))
    default: return false
  }
}

const createFixture = async (prisma: Prisma.TransactionClient, fixture: DemoFixture) => {
  switch (fixture.model) {
    case 'Country': await prisma.country.create({ data: fixture.data as never }); break
    case 'City': await prisma.city.create({ data: fixture.data as never }); break
    case 'AcademicMajor': await prisma.academicMajor.create({ data: fixture.data as never }); break
    case 'University': await prisma.university.create({ data: fixture.data as never }); break
    case 'UniversityProgram': await prisma.universityProgram.create({ data: fixture.data as never }); break
    case 'UniversityProgramLanguage': await prisma.universityProgramLanguage.create({ data: fixture.data as never }); break
    case 'UniversityProgramTuition': await prisma.universityProgramTuition.create({ data: fixture.data as never }); break
    case 'UniversityAdmissionRequirement': await prisma.universityAdmissionRequirement.create({ data: fixture.data as never }); break
    case 'UniversityGalleryImage': await prisma.universityGalleryImage.create({ data: fixture.data as never }); break
    case 'Scholarship': await prisma.scholarship.create({ data: fixture.data as never }); break
    case 'Service': await prisma.service.create({ data: fixture.data as never }); break
    case 'FaqEntry': await prisma.faqEntry.create({ data: fixture.data as never }); break
    case 'Article': await prisma.article.create({ data: fixture.data as never }); break
    case 'ArticleScholarship': await prisma.articleScholarship.create({ data: fixture.data as never }); break
    case 'StudentApplication': await prisma.studentApplication.create({ data: fixture.data as never }); break
    case 'GeneralInquiry': await prisma.generalInquiry.create({ data: fixture.data as never }); break
    case 'AnalyticsEvent': await prisma.analyticsEvent.create({ data: fixture.data as never }); break
  }
}

const removeFixture = async (prisma: Prisma.TransactionClient, fixture: DemoFixture) => {
  const data = fixture.data
  switch (fixture.model) {
    case 'Country': await prisma.country.delete({ where: { id: fixture.id! } }); break
    case 'City': await prisma.city.delete({ where: { id: fixture.id! } }); break
    case 'AcademicMajor': await prisma.academicMajor.delete({ where: { id: fixture.id! } }); break
    case 'University': await prisma.university.delete({ where: { id: fixture.id! } }); break
    case 'UniversityProgram': await prisma.universityProgram.delete({ where: { id: fixture.id! } }); break
    case 'UniversityProgramLanguage': await prisma.universityProgramLanguage.delete({ where: {
      programId_language: { programId: String(data.programId), language: data.language as never },
    } }); break
    case 'UniversityProgramTuition': await prisma.universityProgramTuition.delete({ where: { id: fixture.id! } }); break
    case 'UniversityAdmissionRequirement': await prisma.universityAdmissionRequirement.delete({ where: { id: fixture.id! } }); break
    case 'UniversityGalleryImage': await prisma.universityGalleryImage.delete({ where: { id: fixture.id! } }); break
    case 'Scholarship': await prisma.scholarship.delete({ where: { id: fixture.id! } }); break
    case 'Service': await prisma.service.delete({ where: { id: fixture.id! } }); break
    case 'FaqEntry': await prisma.faqEntry.delete({ where: { id: fixture.id! } }); break
    case 'Article': await prisma.article.delete({ where: { id: fixture.id! } }); break
    case 'ArticleScholarship': await prisma.articleScholarship.delete({ where: {
      articleId_scholarshipId: { articleId: String(data.articleId), scholarshipId: String(data.scholarshipId) },
    } }); break
    case 'StudentApplication': await prisma.studentApplication.delete({ where: { id: fixture.id! } }); break
    case 'GeneralInquiry': await prisma.generalInquiry.delete({ where: { id: fixture.id! } }); break
    case 'AnalyticsEvent': await prisma.analyticsEvent.delete({ where: { id: fixture.id! } }); break
  }
}

const idsFor = (fixtures: DemoFixture[], model: DemoModel) => fixtures
  .filter((fixture) => fixture.model === model && fixture.id)
  .map((fixture) => fixture.id!)

class PrismaDemoSeedRepository implements DemoSeedRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async inspect(fixtures: DemoFixture[]): Promise<FixtureInspection[]> {
    const inspections: FixtureInspection[] = []
    for (const fixture of fixtures) {
      const actual = await findActual(this.prisma, fixture)
      if (actual) {
        inspections.push({
          key: fixture.key,
          state: matchesExpected(actual, fixture.data) ? 'EXACT' : 'DRIFTED',
        })
      } else {
        inspections.push({
          key: fixture.key,
          state: await hasUniqueCollision(this.prisma, fixture) ? 'COLLISION' : 'MISSING',
        })
      }
    }
    return inspections
  }

  async externalDependencyBlockers(fixtures: DemoFixture[]) {
    const countryIds = idsFor(fixtures, 'Country')
    const cityIds = idsFor(fixtures, 'City')
    const majorIds = idsFor(fixtures, 'AcademicMajor')
    const universityIds = idsFor(fixtures, 'University')
    const programIds = idsFor(fixtures, 'UniversityProgram')
    const tuitionIds = idsFor(fixtures, 'UniversityProgramTuition')
    const admissionIds = idsFor(fixtures, 'UniversityAdmissionRequirement')
    const galleryIds = idsFor(fixtures, 'UniversityGalleryImage')
    const scholarshipIds = idsFor(fixtures, 'Scholarship')
    const serviceIds = idsFor(fixtures, 'Service')
    const faqIds = idsFor(fixtures, 'FaqEntry')
    const articleIds = idsFor(fixtures, 'Article')
    const applicationIds = idsFor(fixtures, 'StudentApplication')
    const inquiryIds = idsFor(fixtures, 'GeneralInquiry')
    const blockers: string[] = []
    const check = async (label: string, count: Promise<number>) => {
      if (await count > 0) blockers.push(label)
    }

    await check('Country.University', this.prisma.university.count({ where: { countryId: { in: countryIds }, id: { notIn: universityIds } } }))
    await check('Country.City', this.prisma.city.count({ where: { countryId: { in: countryIds }, id: { notIn: cityIds } } }))
    await check('Country.Scholarship', this.prisma.scholarship.count({ where: { countryId: { in: countryIds }, id: { notIn: scholarshipIds } } }))
    await check('Country.Article', this.prisma.article.count({ where: { countryId: { in: countryIds }, id: { notIn: articleIds } } }))
    await check('Country.StudentApplication', this.prisma.studentApplication.count({ where: { countryId: { in: countryIds }, id: { notIn: applicationIds } } }))
    await check('City.University', this.prisma.university.count({ where: { cityId: { in: cityIds }, id: { notIn: universityIds } } }))
    await check('University.Program', this.prisma.universityProgram.count({ where: { universityId: { in: universityIds }, id: { notIn: programIds } } }))
    await check('University.Scholarship', this.prisma.scholarship.count({ where: { universityId: { in: universityIds }, id: { notIn: scholarshipIds } } }))
    await check('University.Article', this.prisma.article.count({ where: { universityId: { in: universityIds }, id: { notIn: articleIds } } }))
    await check('University.StudentApplication', this.prisma.studentApplication.count({ where: { universityId: { in: universityIds }, id: { notIn: applicationIds } } }))
    await check('University.AdmissionRequirement', this.prisma.universityAdmissionRequirement.count({ where: { universityId: { in: universityIds }, id: { notIn: admissionIds } } }))
    await check('University.Gallery', this.prisma.universityGalleryImage.count({ where: { universityId: { in: universityIds }, id: { notIn: galleryIds } } }))
    await check('AcademicMajor.Program', this.prisma.universityProgram.count({ where: { academicMajorId: { in: majorIds }, id: { notIn: programIds } } }))
    await check('Program.Tuition', this.prisma.universityProgramTuition.count({ where: { programId: { in: programIds }, id: { notIn: tuitionIds } } }))
    await check('Program.AdmissionRequirement', this.prisma.universityAdmissionRequirement.count({ where: { programId: { in: programIds }, id: { notIn: admissionIds } } }))
    await check('Scholarship.StudentApplication', this.prisma.studentApplication.count({ where: { scholarshipId: { in: scholarshipIds }, id: { notIn: applicationIds } } }))
    await check('Scholarship.LegacyArticle', this.prisma.article.count({ where: { scholarshipId: { in: scholarshipIds }, id: { notIn: articleIds } } }))
    await check('Service.FaqEntry', this.prisma.faqEntry.count({ where: { serviceId: { in: serviceIds }, id: { notIn: faqIds } } }))
    await check('Content.FaqEntry', this.prisma.faqEntry.count({ where: {
      id: { notIn: faqIds },
      OR: [
        { countryId: { in: countryIds } },
        { universityId: { in: universityIds } },
        { scholarshipId: { in: scholarshipIds } },
      ],
    } }))
    await check('Application.EmailNotification', this.prisma.emailNotification.count({ where: { applicationId: { in: applicationIds } } }))
    await check('Inquiry.EmailNotification', this.prisma.emailNotification.count({ where: { inquiryId: { in: inquiryIds } } }))

    const expectedProgramLanguages = new Set(fixtures
      .filter(({ model }) => model === 'UniversityProgramLanguage')
      .map(({ data }) => `${String(data.programId)}:${String(data.language)}`))
    const programLanguages = await this.prisma.universityProgramLanguage.findMany({
      where: { programId: { in: programIds } }, select: { programId: true, language: true },
    })
    if (programLanguages.some((row) => !expectedProgramLanguages.has(`${row.programId}:${row.language}`))) {
      blockers.push('Program.Language')
    }

    const expectedArticleScholarships = new Set(fixtures
      .filter(({ model }) => model === 'ArticleScholarship')
      .map(({ data }) => `${String(data.articleId)}:${String(data.scholarshipId)}`))
    const articleScholarships = await this.prisma.articleScholarship.findMany({
      where: { OR: [{ articleId: { in: articleIds } }, { scholarshipId: { in: scholarshipIds } }] },
      select: { articleId: true, scholarshipId: true },
    })
    if (articleScholarships.some((row) => !expectedArticleScholarships.has(`${row.articleId}:${row.scholarshipId}`))) {
      blockers.push('Article.Scholarship')
    }

    return [...new Set(blockers)].sort()
  }

  transaction<T>(operation: (writer: DemoSeedWriter) => Promise<T>) {
    return this.prisma.$transaction(async (transaction) => operation({
      create: (fixture) => createFixture(transaction, fixture),
      remove: (fixture) => removeFixture(transaction, fixture),
    }), { maxWait: 15_000, timeout: 60_000 })
  }
}

const migrationPreflight = async (prisma: PrismaClient) => {
  const local = (await readdir(expectedMigrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  let rows: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
  try {
    rows = await prisma.$queryRaw`
      SELECT "migration_name", "finished_at", "rolled_back_at"
      FROM "_prisma_migrations"
      ORDER BY "started_at" ASC
    `
  } catch (error) {
    throw new Error(
      'BLOCKED — Applied migration history could not be read safely; no repair or write was attempted.',
      { cause: error },
    )
  }
  const successful = new Set(rows
    .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .map((row) => row.migration_name))
  const pending = local.filter((name) => !successful.has(name))
  const failed = rows
    .filter((row) => row.finished_at === null || row.rolled_back_at !== null)
    .map((row) => row.migration_name)
  const unknown = rows.map((row) => row.migration_name).filter((name) => !local.includes(name))
  return { local, applied: local.filter((name) => successful.has(name)), pending, failed, unknown }
}

const valueFor = (name: string) => {
  const exact = process.argv.find(
    (argument) => typeof argument === 'string' && argument.startsWith(`${name}=`),
  )
  if (exact) return exact.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const hasFlag = (name: string) => process.argv.includes(name)

const requireWriteAuthorization = () => {
  if (
    process.env.DEMO_SEED_ALLOW_WRITES !== 'true' ||
    valueFor('--confirm-write') !== 'TAREEQ_DEMO_SEED'
  ) {
    throw new Error(
      'BLOCKED — Writes require DEMO_SEED_ALLOW_WRITES=true and --confirm-write=TAREEQ_DEMO_SEED.',
    )
  }
}

const requirePublicationAuthorization = () => {
  if (
    process.env.DEMO_SEED_ALLOW_PUBLICATION !== 'true' ||
    valueFor('--confirm-publication') !== 'TAREEQ_DEMO_PUBLICATION'
  ) {
    throw new Error(
      'BLOCKED — Published demo data requires DEMO_SEED_ALLOW_PUBLICATION=true and --confirm-publication=TAREEQ_DEMO_PUBLICATION.',
    )
  }
}

let prisma: PrismaClient | undefined
let safePhase = 'INITIALIZATION'

try {
  const command = process.argv[2]
  const dryRun = hasFlag('--dry-run')
  const visibility = (valueFor('--visibility') ?? 'private') as DemoVisibility
  if (visibility !== 'private' && visibility !== 'published') {
    throw new Error('BLOCKED — --visibility must be private or published.')
  }

  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('BLOCKED — DIRECT_DATABASE_URL or DATABASE_URL is required.')
  safePhase = 'TARGET_VERIFICATION'
  const verifiedTarget = verifyTargetIdentity(databaseUrl)
  safePhase = 'PRISMA_INITIALIZATION'
  const adapter = new PrismaPg({ connectionString: databaseUrl })
  prisma = new PrismaClient({ adapter })
  safePhase = 'MIGRATION_PREFLIGHT'
  const migrations = await migrationPreflight(prisma)
  if (command === 'preflight') {
    safePhase = 'PROTECTED_COUNT_PREFLIGHT'
    const counts = {
      administrators: await prisma.adminUser.count(),
      countries: await prisma.country.count(),
      universities: await prisma.university.count(),
      scholarships: await prisma.scholarship.count(),
      services: await prisma.service.count(),
      articles: await prisma.article.count(),
    }
    console.log(JSON.stringify({
      mode: 'READ_ONLY',
      targetVerified: true,
      migrations,
      protectedRecordCounts: counts,
    }, null, 2))
  } else if (command === 'seed') {
    safePhase = 'SEED_PLANNING'
    if (migrations.pending.length > 0 || migrations.failed.length > 0 || migrations.unknown.length > 0) {
      throw new Error('BLOCKED — Demo seed requires a clean, fully applied local migration history.')
    }
    if (!dryRun) requireWriteAuthorization()
    if (visibility === 'published' && !dryRun) requirePublicationAuthorization()

    let manifest = await loadActiveManifest()
    if (manifest?.status === 'CLEANED') manifest = null
    if (manifest && manifest.visibility !== visibility) {
      throw new Error('BLOCKED — The active demo batch uses a different visibility profile.')
    }
    const baseTime = manifest ? new Date(manifest.baseTimeUtc) : new Date()
    const fixtures = buildDemoFixtures(baseTime, visibility)
    if (manifest) {
      if (manifest.targetIdentityHash !== hashTargetIdentity(verifiedTarget)) {
        throw new Error('BLOCKED — The active manifest belongs to a different database target.')
      }
      validateManifestFixtures(manifest, fixtures)
    }
    const repository = new PrismaDemoSeedRepository(prisma)
    const inspections = await repository.inspect(fixtures)
    const plan = planDemoSeed(fixtures, inspections, manifest?.status ?? 'NONE')

    if (dryRun) {
      console.log(JSON.stringify({
        mode: 'READ_ONLY_DRY_RUN', targetVerified: true, visibility,
        batchStatus: manifest?.status ?? 'NONE', migrationPrerequisites: 'PASS',
        expectedRecordCounts: fixtureCounts(fixtures), plan: plan.counts,
        excludedModels: DEMO_OPERATIONAL_EXCLUSIONS,
      }, null, 2))
    } else {
      const now = new Date().toISOString()
      manifest ??= {
        schemaVersion: 1,
        task: 'Tareeq Academy reversible demo seed',
        batchId: randomUUID(),
        status: 'PLANNED',
        visibility,
        baseTimeUtc: baseTime.toISOString(),
        createdAtUtc: now,
        updatedAtUtc: now,
        targetIdentityHash: hashTargetIdentity(verifiedTarget),
        fixtureDigest: fixtureDigest(fixtures),
        records: fixtures.map((fixture) => ({
          key: fixture.key, model: fixture.model, id: fixture.id,
          ownershipHash: fixtureOwnershipHash(fixture), sourceUrl: fixture.sourceUrl,
        })),
      }
      manifest.status = 'PLANNED'
      await saveManifest(manifest)
      try {
        await applySeedPlan(repository, plan)
        manifest.status = 'COMMITTED'
        await saveManifest(manifest)
      } catch (error) {
        manifest.status = 'FAILED'
        await saveManifest(manifest)
        throw error
      }
      console.log(JSON.stringify({
        mode: 'WRITE_CONFIRMED', batchId: manifest.batchId,
        visibility, status: manifest.status, counts: plan.counts,
        manifest: `reports/demo-seed/${manifest.batchId}.json`,
      }, null, 2))
    }
  } else if (command === 'cleanup') {
    safePhase = 'CLEANUP_PLANNING'
    const batchId = valueFor('--batch')
    if (!batchId || !z.uuid().safeParse(batchId).success) {
      throw new Error('BLOCKED — Cleanup requires --batch=<manifest batch UUID>.')
    }
    const manifest = await loadManifest(batchId)
    if (manifest.targetIdentityHash !== hashTargetIdentity(verifiedTarget)) {
      throw new Error('BLOCKED — The cleanup manifest belongs to a different database target.')
    }
    const fixtures = buildDemoFixtures(new Date(manifest.baseTimeUtc), manifest.visibility)
    validateManifestFixtures(manifest, fixtures)
    const repository = new PrismaDemoSeedRepository(prisma)
    const inspections = await repository.inspect(fixtures)
    const blockers = await repository.externalDependencyBlockers(fixtures)
    const plan = planDemoCleanup(fixtures, inspections, manifest.status as BatchStatus, blockers)

    if (dryRun) {
      console.log(JSON.stringify({
        mode: 'READ_ONLY_CLEANUP_DRY_RUN', targetVerified: true,
        batchId, status: manifest.status, blockers, exactAffectedCounts: plan.counts,
        manifest: `reports/demo-seed/${batchId}.json`,
        retainedAppendOnlyAuditRows: true,
      }, null, 2))
    } else {
      requireWriteAuthorization()
      if (valueFor('--confirm-cleanup') !== batchId) {
        throw new Error('BLOCKED — Destructive cleanup requires --confirm-cleanup=<same batch UUID>.')
      }
      await applyCleanupPlan(repository, plan)
      manifest.status = 'CLEANED'
      await saveManifest(manifest)
      console.log(JSON.stringify({
        mode: 'CLEANUP_CONFIRMED', batchId, status: manifest.status,
        removed: plan.counts, retainedAppendOnlyAuditRows: true,
      }, null, 2))
    }
  } else {
    throw new Error('Use one explicit command: preflight, seed, or cleanup.')
  }
} catch (error) {
  const cause = error instanceof Error ? error.cause : undefined
  const candidateCode = [error, cause].find(
    (value) => typeof value === 'object' && value !== null && 'code' in value,
  ) as { code?: unknown } | undefined
  const safeCode = typeof candidateCode?.code === 'string' && /^[A-Z0-9_]{2,30}$/.test(candidateCode.code)
    ? candidateCode.code
    : null
  const candidateName = [cause, error].find(
    (value) => value instanceof Error && /^[A-Za-z][A-Za-z0-9]{1,60}$/.test(value.name),
  ) as Error | undefined
  const safeCategory = candidateName?.name ?? null
  const diagnostic = [
    `phase ${safePhase}`,
    safeCategory ? `category ${safeCategory}` : null,
    safeCode ? `code ${safeCode}` : null,
  ].filter(Boolean).join(', ')
  const message = error instanceof Error && error.message.startsWith('BLOCKED')
    ? `${error.message}${diagnostic ? ` Safe diagnostic: ${diagnostic}.` : ''}`
    : `Demo seed command failed safely.${diagnostic ? ` Safe diagnostic: ${diagnostic}.` : ''} No credentials or database details were displayed.`
  console.error(message)
  process.exitCode = 1
} finally {
  await prisma?.$disconnect()
}
