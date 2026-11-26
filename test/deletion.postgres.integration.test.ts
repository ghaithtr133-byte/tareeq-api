import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PrismaContentRepository } from '../src/content/prisma-repository.js'
import { contentResources, type ContentResource } from '../src/content/types.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { verifyDisposableTestDatabase } from '../src/database/test-safety.js'
import { PrismaSubmissionRepository } from '../src/submissions/prisma-repository.js'

const shouldRun = process.env.RUN_DELETION_DATABASE_INTEGRATION === '1'
const runToken = randomUUID().slice(0, 8)
const created = new Map<ContentResource, string[]>([
  ['countries', []], ['universities', []], ['scholarships', []], ['services', []], ['articles', []],
])
const applicationIds: string[] = []
const inquiryIds: string[] = []
let actorAdminId = ''
// This test performs ordered teardown across several FK-restricted tables on
// a remote disposable database. It is deliberately test-only and scoped here.
const cleanupTransactionOptions = { maxWait: 15_000, timeout: 30_000 } as const
const completeHardDeleteScenarioTimeoutMs = 90_000

const track = (resource: ContentResource, id: string) => {
  created.get(resource)?.push(id)
  return id
}

const audit = (action: string, resourceType: 'STUDENT_APPLICATION' | 'GENERAL_INQUIRY') => ({
  actorAdminId,
  action,
  resourceType,
  metadata: { integration: true },
})

const cleanup = async () => {
  const prisma = getPrisma()
  const ids = (resource: ContentResource) => created.get(resource) ?? []
  const notificationFilters = [
    { applicationId: { in: applicationIds } },
    { inquiryId: { in: inquiryIds } },
    ...(actorAdminId ? [{ adminUserId: actorAdminId }] : []),
  ]
  await prisma.$transaction(async (transaction) => {
    if (actorAdminId) {
      await transaction.adminAuditLog.deleteMany({ where: { actorAdminId } })
      await transaction.hardDeleteChallenge.deleteMany({ where: { actorAdminId } })
    }
    await transaction.emailNotification.deleteMany({ where: {
      OR: notificationFilters,
    } })
    await transaction.studentApplication.deleteMany({ where: { id: { in: applicationIds } } })
    await transaction.generalInquiry.deleteMany({ where: { id: { in: inquiryIds } } })
    await transaction.articleScholarship.deleteMany({ where: {
      OR: [{ articleId: { in: ids('articles') } }, { scholarshipId: { in: ids('scholarships') } }],
    } })
    await transaction.article.deleteMany({ where: { id: { in: ids('articles') } } })
    await transaction.scholarshipDetailItem.deleteMany({ where: { scholarshipId: { in: ids('scholarships') } } })
    await transaction.scholarship.deleteMany({ where: { id: { in: ids('scholarships') } } })
    await transaction.universityProgramLanguage.deleteMany({ where: { program: { universityId: { in: ids('universities') } } } })
    await transaction.universityProgramTuition.deleteMany({ where: { program: { universityId: { in: ids('universities') } } } })
    await transaction.universityProgram.deleteMany({ where: { universityId: { in: ids('universities') } } })
    await transaction.university.deleteMany({ where: { id: { in: ids('universities') } } })
    await transaction.serviceDetailItem.deleteMany({ where: { serviceId: { in: ids('services') } } })
    await transaction.service.deleteMany({ where: { id: { in: ids('services') } } })
    await transaction.countryStudyGuideSection.deleteMany({ where: { countryId: { in: ids('countries') } } })
    await transaction.country.deleteMany({ where: { id: { in: ids('countries') } } })
    if (actorAdminId) await transaction.adminUser.deleteMany({ where: { id: actorAdminId } })
  }, cleanupTransactionOptions)
  for (const [resource, resourceIds] of created) {
    const remaining = await (async () => {
      switch (resource) {
        case 'countries': return prisma.country.count({ where: { id: { in: resourceIds } } })
        case 'universities': return prisma.university.count({ where: { id: { in: resourceIds } } })
        case 'scholarships': return prisma.scholarship.count({ where: { id: { in: resourceIds } } })
        case 'services': return prisma.service.count({ where: { id: { in: resourceIds } } })
        case 'articles': return prisma.article.count({ where: { id: { in: resourceIds } } })
      }
    })()
    expect(remaining).toBe(0)
  }
  created.forEach((resourceIds) => { resourceIds.length = 0 })
  applicationIds.length = 0
  inquiryIds.length = 0
  actorAdminId = ''
}

const createPublishedContent = async (): Promise<Array<{ resource: ContentResource; id: string }>> => {
  const prisma = getPrisma()
  const publishedAt = new Date()
  // A partially failed prior test must never make the next invocation reuse a
  // slug. The IDs remain traceable through the suite-level run token.
  const fixtureToken = `${runToken}-${randomUUID().slice(0, 8)}`
  const country = await prisma.country.create({ data: {
    nameAr: `بلد حذف ${fixtureToken}`, slug: `delete-country-${fixtureToken}`, introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    imageUrl: 'https://example.invalid/country.jpg', imageAltAr: 'صورة البلد', status: 'PUBLISHED', publishedAt,
  } })
  track('countries', country.id)
  const universityCountry = await prisma.country.create({ data: {
    nameAr: `بلد جامعة حذف ${fixtureToken}`, slug: `delete-university-country-${fixtureToken}`, introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    imageUrl: 'https://example.invalid/university-country.jpg', imageAltAr: 'صورة بلد الجامعة', status: 'PUBLISHED', publishedAt,
  } })
  track('countries', universityCountry.id)
  const university = await prisma.university.create({ data: {
    nameAr: `جامعة حذف ${fixtureToken}`, officialName: `Deletion University ${fixtureToken}`, slug: `delete-university-${fixtureToken}`,
    countryId: universityCountry.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص عربي', status: 'PUBLISHED', publishedAt,
  } })
  track('universities', university.id)
  const scholarship = await prisma.scholarship.create({ data: {
    titleAr: `منحة حذف ${fixtureToken}`, slug: `delete-scholarship-${fixtureToken}`, studyLevel: 'MASTERS', fundingType: 'FULL',
    summaryAr: 'ملخص عربي', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.invalid/scholarship', status: 'PUBLISHED', publishedAt,
  } })
  track('scholarships', scholarship.id)
  const service = await prisma.service.create({ data: {
    titleAr: `خدمة حذف ${fixtureToken}`, slug: `delete-service-${fixtureToken}`, summaryAr: 'ملخص', descriptionAr: 'وصف', status: 'PUBLISHED', publishedAt,
  } })
  track('services', service.id)
  const article = await prisma.article.create({ data: {
    titleAr: `مقال حذف ${fixtureToken}`, slug: `delete-article-${fixtureToken}`, summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'PUBLISHED', publishedAt,
  } })
  track('articles', article.id)
  return [
    { resource: 'countries', id: country.id },
    { resource: 'universities', id: university.id },
    { resource: 'scholarships', id: scholarship.id },
    { resource: 'services', id: service.id },
    { resource: 'articles', id: article.id },
  ]
}

describe.runIf(shouldRun)('PostgreSQL confirmed content and submission deletion', () => {
  beforeAll(async () => {
    await verifyDisposableTestDatabase()
    await getPrisma().$queryRaw`SELECT 1`
  })

  afterEach(async () => {
    await cleanup()
  }, completeHardDeleteScenarioTimeoutMs)

  afterAll(async () => {
    await cleanup()
    await disconnectPrisma()
  }, completeHardDeleteScenarioTimeoutMs)

  it('deletes published content without confirmation when it has no additional dependent records', async () => {
    const prisma = getPrisma()
    const actor = await prisma.adminUser.create({ data: {
      name: 'Deletion integration super admin', email: `deletion-${runToken}-${randomUUID().slice(0, 8)}@example.invalid`, passwordHash: '$argon2id$integration-only', role: 'SUPER_ADMIN',
    } })
    actorAdminId = actor.id
    const fixtures = await createPublishedContent()
    const repository = new PrismaContentRepository()

    expect(fixtures.map(({ resource }) => resource)).toEqual(contentResources)
    for (const { resource, id } of fixtures) {
      const deleted = await repository.deleteIfSafe(resource, id, actor.id)
      expect(deleted).toMatchObject({ outcome: 'DELETED', id })
    }

    expect(await prisma.adminAuditLog.count({ where: { actorAdminId: actor.id, action: { endsWith: '.hard_deleted' } } })).toBe(5)
    // The confirmed Country target is deleted. The second tracked Country is
    // deliberately only the required parent of the University fixture and is
    // preserved until the FK-safe afterEach cleanup removes it.
    const confirmedCountryIds = fixtures.filter(({ resource }) => resource === 'countries').map(({ id }) => id)
    expect(await prisma.country.count({ where: { id: { in: confirmedCountryIds } } })).toBe(0)
    expect(await prisma.country.count({ where: { id: { in: created.get('countries') ?? [] } } })).toBe(1)
  }, completeHardDeleteScenarioTimeoutMs)

  it('unlinks an Article from independent Country, University, and Scholarship records without deleting them', async () => {
    const prisma = getPrisma()
    const actor = await prisma.adminUser.create({ data: {
      name: 'Article deletion integration admin', email: `article-deletion-${runToken}-${randomUUID().slice(0, 8)}@example.invalid`, passwordHash: '$argon2id$integration-only', role: 'ADMIN',
    } })
    actorAdminId = actor.id
    const fixtureToken = `${runToken}-${randomUUID().slice(0, 8)}`
    const country = await prisma.country.create({ data: {
      nameAr: `بلد مقال ${fixtureToken}`, slug: `article-country-${fixtureToken}`, introductionAr: 'مقدمة', detailsAr: 'تفاصيل', status: 'DRAFT',
    } })
    track('countries', country.id)
    const university = await prisma.university.create({ data: {
      nameAr: `جامعة مقال ${fixtureToken}`, officialName: `Article Association University ${fixtureToken}`, slug: `article-university-${fixtureToken}`,
      countryId: country.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'DRAFT',
    } })
    track('universities', university.id)
    const scholarship = await prisma.scholarship.create({ data: {
      titleAr: `منحة مقال ${fixtureToken}`, slug: `article-scholarship-${fixtureToken}`, studyLevel: 'MASTERS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    } })
    track('scholarships', scholarship.id)
    const article = await prisma.article.create({ data: {
      titleAr: `مقال مرتبط ${fixtureToken}`, slug: `article-linked-${fixtureToken}`, summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }],
      countryId: country.id, universityId: university.id, scholarshipId: scholarship.id, status: 'PUBLISHED', publishedAt: new Date(),
    } })
    track('articles', article.id)
    await prisma.articleScholarship.create({ data: { articleId: article.id, scholarshipId: scholarship.id, displayOrder: 0 } })

    const repository = new PrismaContentRepository()
    await expect(repository.deleteIfSafe('articles', article.id, actor.id)).resolves.toMatchObject({
      outcome: 'DELETED', id: article.id, impact: { outcome: 'SAFE', items: [expect.objectContaining({ resourceType: 'ARTICLE_SCHOLARSHIP', effect: 'UNLINK' })] },
    })
    await expect(prisma.article.findUnique({ where: { id: article.id } })).resolves.toBeNull()
    await expect(prisma.articleScholarship.count({ where: { articleId: article.id } })).resolves.toBe(0)
    await expect(prisma.country.findUnique({ where: { id: country.id } })).resolves.not.toBeNull()
    await expect(prisma.university.findUnique({ where: { id: university.id } })).resolves.not.toBeNull()
    await expect(prisma.scholarship.findUnique({ where: { id: scholarship.id } })).resolves.not.toBeNull()

    const unlinkCountry = await prisma.country.create({ data: {
      nameAr: `بلد فك الارتباط ${fixtureToken}`, slug: `unlink-country-${fixtureToken}`, introductionAr: 'مقدمة', detailsAr: 'تفاصيل', status: 'DRAFT',
    } })
    track('countries', unlinkCountry.id)
    const preservedScholarship = await prisma.scholarship.create({ data: {
      titleAr: `منحة فك الارتباط ${fixtureToken}`, slug: `unlink-scholarship-${fixtureToken}`, countryId: unlinkCountry.id,
      studyLevel: 'MASTERS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    } })
    track('scholarships', preservedScholarship.id)
    const preservedArticle = await prisma.article.create({ data: {
      titleAr: `مقال فك الارتباط ${fixtureToken}`, slug: `unlink-article-${fixtureToken}`, countryId: unlinkCountry.id,
      summaryAr: 'ملخص', bodyAr: [{ type: 'paragraph', text: 'نص' }], status: 'DRAFT',
    } })
    track('articles', preservedArticle.id)

    await expect(repository.deleteIfSafe('countries', unlinkCountry.id, actor.id)).resolves.toMatchObject({ outcome: 'DELETED', id: unlinkCountry.id })
    await expect(prisma.scholarship.findUnique({ where: { id: preservedScholarship.id } })).resolves.toMatchObject({ countryId: null })
    await expect(prisma.article.findUnique({ where: { id: preservedArticle.id } })).resolves.toMatchObject({ countryId: null })
  }, completeHardDeleteScenarioTimeoutMs)

  it('keeps changed dependency graphs and failed submission deletion transactions intact', async () => {
    const prisma = getPrisma()
    const actor = await prisma.adminUser.create({ data: {
      name: 'Deletion rollback super admin', email: `deletion-rollback-${runToken}-${randomUUID().slice(0, 8)}@example.invalid`, passwordHash: '$argon2id$integration-only', role: 'SUPER_ADMIN',
    } })
    actorAdminId = actor.id
    const content = await createPublishedContent()
    const service = content.find(({ resource }) => resource === 'services')
    if (!service) throw new Error('Expected a Service fixture.')
    const contentRepository = new PrismaContentRepository()
    const issued = await contentRepository.issueDeletionChallenge('services', service.id, actor.id, new Date(Date.now() + 60_000))
    expect(issued.outcome).toBe('ISSUED')
    if (issued.outcome !== 'ISSUED') throw new Error('Expected a deletion challenge.')
    await prisma.serviceDetailItem.create({ data: { serviceId: service.id, kind: 'STEP', titleAr: 'تبع اختبار', displayOrder: 0 } })
    const stale = await contentRepository.confirmHardDelete('services', service.id, issued.challenge.id, actor.id, new Date())
    expect(stale.outcome).toBe('STALE')
    await expect(prisma.service.findUnique({ where: { id: service.id } })).resolves.not.toBeNull()

    const submissions = new PrismaSubmissionRepository()
    const application = await submissions.createApplication({
      applicationType: 'SCHOLARSHIP_ASSISTANCE', scholarshipId: null, countryId: null, universityId: null, studyLevel: null,
      intendedMajor: null, fullName: 'طالب اختبار', email: `application-${runToken}@example.invalid`, phone: null, message: 'رسالة اختبار', privacyAcceptedAt: new Date(),
    })
    applicationIds.push(application.id)
    const inquiry = await submissions.createInquiry({
      fullName: 'مستفسر اختبار', email: `inquiry-${runToken}@example.invalid`, phone: null, subject: 'موضوع', message: 'رسالة اختبار', privacyAcceptedAt: new Date(),
    })
    inquiryIds.push(inquiry.id)
    const applicationNotifications = await prisma.emailNotification.count({ where: { applicationId: application.id } })
    const inquiryNotifications = await prisma.emailNotification.count({ where: { inquiryId: inquiry.id } })
    expect(applicationNotifications).toBeGreaterThan(0)
    expect(inquiryNotifications).toBeGreaterThan(0)

    await expect(submissions.deleteApplication(application.id, { ...audit('student_application.deleted', 'STUDENT_APPLICATION'), actorAdminId: randomUUID() })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.studentApplication.findUnique({ where: { id: application.id } })).resolves.not.toBeNull()
    expect(await prisma.emailNotification.count({ where: { applicationId: application.id } })).toBe(applicationNotifications)

    await expect(submissions.deleteApplication(application.id, audit('student_application.deleted', 'STUDENT_APPLICATION'))).resolves.toMatchObject({ outcome: 'DELETED', id: application.id })
    await expect(submissions.deleteInquiry(inquiry.id, audit('general_inquiry.deleted', 'GENERAL_INQUIRY'))).resolves.toMatchObject({ outcome: 'DELETED', id: inquiry.id })
    await expect(prisma.emailNotification.count({ where: { OR: [{ applicationId: application.id }, { inquiryId: inquiry.id }] } })).resolves.toBe(0)
    expect(await prisma.adminAuditLog.findMany({ where: { actorAdminId: actor.id, action: { in: ['student_application.deleted', 'general_inquiry.deleted'] } } })).toHaveLength(2)
  }, completeHardDeleteScenarioTimeoutMs)
})
