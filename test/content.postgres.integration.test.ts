import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { verifyDisposableTestDatabase } from '../src/database/test-safety.js'
import { PrismaContentRepository } from '../src/content/prisma-repository.js'
import { ContentService } from '../src/content/service.js'
import type { ContentResource } from '../src/content/types.js'

const shouldRun = process.env.RUN_CONTENT_DATABASE_INTEGRATION === '1'
// These two scenarios deliberately perform a broad relationship graph and a
// complete-set reorder against remote PostgreSQL. Keep the allowance local to
// the integration test; production transaction limits remain unchanged.
const remoteContentScenarioTimeoutMs = 60_000
describe.runIf(shouldRun)('content PostgreSQL integration', () => {
  const repository = new PrismaContentRepository()
  const service = new ContentService(repository)
  const createdIds = new Map<ContentResource, string[]>([
    ['countries', []], ['universities', []], ['scholarships', []], ['services', []], ['articles', []],
  ])
  const runToken = randomUUID().slice(0, 8)
  const actorAdminId = randomUUID()
  const slug = (name: string) => `integration-${runToken}-${name}`

  const track = <T extends { id: string }>(resource: ContentResource, record: T) => {
    createdIds.get(resource)?.push(record.id)
    return record
  }

  beforeAll(async () => {
    await verifyDisposableTestDatabase()
    await getPrisma().$queryRaw`SELECT 1`
    await getPrisma().adminUser.create({
      data: {
        id: actorAdminId,
        name: 'Content Integration Admin',
        email: `content-integration-${runToken}@example.invalid`,
        passwordHash: '$argon2id$integration-test-only',
        role: 'ADMIN',
      },
    })
  }, remoteContentScenarioTimeoutMs)

  afterAll(async () => {
    const prisma = getPrisma()
    await prisma.adminAuditLog.deleteMany({ where: { actorAdminId } })
    await prisma.articleScholarship.deleteMany({
      where: {
        OR: [
          { articleId: { in: createdIds.get('articles') ?? [] } },
          { scholarshipId: { in: createdIds.get('scholarships') ?? [] } },
        ],
      },
    })
    await prisma.article.deleteMany({ where: { id: { in: createdIds.get('articles') ?? [] } } })
    await prisma.scholarship.deleteMany({ where: { id: { in: createdIds.get('scholarships') ?? [] } } })
    await prisma.university.deleteMany({ where: { id: { in: createdIds.get('universities') ?? [] } } })
    await prisma.service.deleteMany({ where: { id: { in: createdIds.get('services') ?? [] } } })
    await prisma.country.deleteMany({ where: { id: { in: createdIds.get('countries') ?? [] } } })

    const remaining = await Promise.all([
      prisma.article.count({ where: { id: { in: createdIds.get('articles') ?? [] } } }),
      prisma.scholarship.count({ where: { id: { in: createdIds.get('scholarships') ?? [] } } }),
      prisma.university.count({ where: { id: { in: createdIds.get('universities') ?? [] } } }),
      prisma.service.count({ where: { id: { in: createdIds.get('services') ?? [] } } }),
      prisma.country.count({ where: { id: { in: createdIds.get('countries') ?? [] } } }),
    ])
    expect(remaining).toEqual([0, 0, 0, 0, 0])
    await prisma.adminUser.delete({ where: { id: actorAdminId } })
    await disconnectPrisma()
  }, remoteContentScenarioTimeoutMs)

  it('persists relationships, enforces unique slugs, filters publication state, and updates records', async () => {
    const country = track('countries', await service.create('countries', {
      nameAr: 'بلد اختبار التكامل', slug: slug('country'), introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
      imageUrl: 'https://example.edu/integration-country.jpg', imageAltAr: 'صورة بلد اختبار التكامل',
      featured: true, status: 'PUBLISHED',
    }, actorAdminId))
    const university = track('universities', await service.create('universities', {
      nameAr: 'جامعة اختبار التكامل', officialName: 'Integration University', slug: slug('university'),
      countryId: country.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة', status: 'PUBLISHED', featured: false,
    }, actorAdminId))
    const scholarship = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة اختبار التكامل', slug: slug('scholarship'), countryId: country.id,
      universityId: university.id, studyLevel: 'MASTERS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/integration',
      applicationStatus: 'OPEN', status: 'PUBLISHED', featured: true,
    }, actorAdminId))
    const draftService = track('services', await service.create('services', {
      titleAr: 'خدمة اختبار التكامل', slug: slug('service'), summaryAr: 'ملخص',
      descriptionAr: 'وصف', status: 'DRAFT', featured: false,
    }, actorAdminId))
    const publishedService = track('services', await service.create('services', {
      titleAr: 'خدمة منشورة لاختبار التكامل', slug: slug('published-service'), summaryAr: 'ملخص',
      descriptionAr: 'وصف', status: 'PUBLISHED', featured: false,
    }, actorAdminId))
    const article = track('articles', await service.create('articles', {
      titleAr: 'مقال اختبار التكامل', slug: slug('article'), summaryAr: 'ملخص',
      bodyAr: [{ type: 'paragraph', text: 'نص' }], countryId: country.id,
      universityId: university.id, scholarshipId: scholarship.id, status: 'PUBLISHED', featured: true,
    }, actorAdminId))

    // The route-level schema test proves omitted status stays absent. These
    // real PostgreSQL writes prove the resulting partial update preserves the
    // persisted publication state and first publication time for every model.
    for (const [resource, id, data, publishedAt] of [
      ['countries', country.id, { imageUrl: 'https://example.edu/updated-country.jpg' }, country.publishedAt],
      ['universities', university.id, { imageUrl: 'https://example.edu/updated-university.jpg' }, university.publishedAt],
      ['scholarships', scholarship.id, { imageUrl: 'https://example.edu/updated-scholarship.jpg' }, scholarship.publishedAt],
      ['services', publishedService.id, { imageUrl: 'https://example.edu/updated-service.jpg' }, publishedService.publishedAt],
      ['articles', article.id, { coverImageUrl: 'https://example.edu/updated-article.jpg' }, article.publishedAt],
    ] as const) {
      const updated = await service.update(resource, id, data, actorAdminId)
      expect(updated).toMatchObject({ status: 'PUBLISHED', publishedAt })
    }

    await expect(service.create('countries', {
      nameAr: 'تكرار', slug: country.slug, introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    }, actorAdminId)).rejects.toMatchObject({ code: 'SLUG_CONFLICT' })

    const countries = await service.list('countries', {
      page: 1, limit: 12, search: 'اختبار التكامل', featured: true,
    }, true)
    expect(countries.pagination.total).toBe(1)
    expect(countries.items[0]?.slug).toBe(country.slug)

    const hiddenDraft = await repository.findBySlug('services', draftService.slug, true)
    expect(hiddenDraft).toBeNull()
    const publishedArticle = await service.getPublic('articles', slug('article'))
    expect(publishedArticle.countryId).toBe(country.id)

    const updated = await service.update(
      'services',
      draftService.id,
      { status: 'PUBLISHED' },
      actorAdminId,
    )
    expect(updated.status).toBe('PUBLISHED')
    expect(updated.publishedAt).toBeInstanceOf(Date)
    expect(await repository.findBySlug('services', draftService.slug, true)).not.toBeNull()
  }, remoteContentScenarioTimeoutMs)

  it('rejects real foreign-key and cross-country relationship violations', async () => {
    await expect(repository.create('universities', {
      nameAr: 'جامعة غير صالحة', officialName: 'Invalid University', slug: slug('invalid-university'),
      countryId: '22222222-2222-4222-8222-222222222222', cityAr: 'مدينة', overviewAr: 'نظرة',
      status: 'DRAFT', featured: false, publishedAt: null,
    }, {
      actorAdminId,
      action: 'content.university.created',
      resourceType: 'UNIVERSITY',
      metadata: { status: 'DRAFT' },
    })).rejects.toMatchObject({ code: 'RELATIONSHIP_INVALID' })

    const universityCountry = track('countries', await service.create('countries', {
      nameAr: 'بلد الجامعة المستقلة', slug: slug('university-country'), introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
      imageUrl: 'https://example.edu/integration-university-country.jpg', imageAltAr: 'صورة بلد الجامعة المستقلة',
      status: 'PUBLISHED',
    }, actorAdminId))
    const independentUniversity = track('universities', await service.create('universities', {
      nameAr: 'جامعة مستقلة', officialName: 'Independent Integration University', slug: slug('independent-university'),
      countryId: universityCountry.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', summaryAr: 'ملخص الجامعة المستقلة',
      status: 'PUBLISHED', featured: false,
    }, actorAdminId))
    const secondCountry = track('countries', await service.create('countries', {
      nameAr: 'بلد ثان', slug: slug('second-country'), introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    }, actorAdminId))
    const firstUniversity = await repository.findBySlug('universities', independentUniversity.slug, false)
    expect(firstUniversity?.id).toBe(independentUniversity.id)
    await expect(service.create('scholarships', {
      titleAr: 'منحة غير متسقة', slug: slug('invalid-scholarship'), countryId: secondCountry.id,
      universityId: firstUniversity?.id, studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    }, actorAdminId)).rejects.toMatchObject({ code: 'RELATIONSHIP_INVALID' })
  }, 30_000)

  it('persists ordered Article Scholarship links and rolls them back with a failed audit write', async () => {
    const open = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة مفتوحة مرتبطة', slug: slug('related-open'), studyLevel: 'MASTERS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة المفتوحة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/related-open',
      applicationStatus: 'OPEN', status: 'PUBLISHED',
    }, actorAdminId))
    const closed = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة مغلقة مرتبطة', slug: slug('related-closed'), studyLevel: 'MASTERS', fundingType: 'FULL',
      summaryAr: 'ملخص المنحة المغلقة', requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/related-closed',
      applicationStatus: 'OPEN', verifiedDeadline: '2000-01-01T00:00:00.000Z', status: 'PUBLISHED',
    }, actorAdminId))
    const draft = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة مسودة مرتبطة', slug: slug('related-draft'), studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    }, actorAdminId))
    const article = track('articles', await service.create('articles', {
      titleAr: 'مقال بمنح متعددة', slug: slug('multiple-related'), summaryAr: 'ملخص',
      bodyAr: [{ type: 'paragraph', text: 'نص' }], scholarshipIds: [closed.id, draft.id, open.id],
      status: 'PUBLISHED',
    }, actorAdminId))

    expect(article.scholarshipId).toBe(closed.id)
    expect(article.scholarshipIds).toEqual([closed.id, draft.id, open.id])
    const publicArticle = await service.getPublic('articles', article.slug)
    expect((publicArticle.relatedScholarships as Array<{ id: string; effectiveApplicationStatus: string }>)).toEqual([
      expect.objectContaining({ id: closed.id, effectiveApplicationStatus: 'CLOSED' }),
      expect.objectContaining({ id: open.id, effectiveApplicationStatus: 'OPEN' }),
    ])

    await expect(repository.update('articles', article.id, {
      scholarshipId: open.id,
      scholarshipIds: [open.id],
    }, {
      actorAdminId: randomUUID(),
      action: 'content.article.updated',
      resourceType: 'ARTICLE',
      metadata: { changedFields: ['scholarshipId', 'scholarshipIds'], scholarshipAssociationCount: 1 },
    })).rejects.toMatchObject({ code: 'RELATIONSHIP_INVALID' })

    const afterRollback = await service.getAdmin('articles', article.id)
    expect(afterRollback.scholarshipId).toBe(closed.id)
    expect(afterRollback.scholarshipIds).toEqual([closed.id, draft.id, open.id])
  }, 30_000)

  it('preserves legacy featured rows, transitions featuredAt, and atomically persists manual reorder storage', async () => {
    let clock = new Date('2026-11-14T09:00:00.000Z')
    const timedService = new ContentService(repository, () => new Date(clock))
    const legacy = await getPrisma().service.create({ data: {
      titleAr: 'خدمة مميزة قديمة', slug: slug('legacy-featured-service'), summaryAr: 'ملخص', descriptionAr: 'وصف',
      featured: true, featuredAt: null, status: 'PUBLISHED',
    } })
    createdIds.get('services')?.push(legacy.id)
    const current = track('services', await timedService.create('services', {
      titleAr: 'خدمة مميزة حديثة', slug: slug('current-featured-service'), summaryAr: 'ملخص', descriptionAr: 'وصف',
      featured: true, status: 'PUBLISHED',
    }, actorAdminId))
    expect(current.featuredAt).toEqual(clock)
    const featured = await timedService.list('services', { page: 1, limit: 50, featured: true }, true)
    expect(featured.items.slice(0, 2).map(({ id }) => id)).toEqual([current.id, legacy.id])

    clock = new Date('2026-11-15T09:00:00.000Z')
    await timedService.update('services', current.id, { titleAr: 'تحرير عادي' }, actorAdminId)
    expect((await timedService.getAdmin('services', current.id)).featuredAt).toEqual(new Date('2026-11-14T09:00:00.000Z'))
    await timedService.update('services', current.id, { featured: false }, actorAdminId)
    expect((await timedService.getAdmin('services', current.id)).featuredAt).toBeNull()
    clock = new Date('2026-11-16T09:00:00.000Z')
    await timedService.update('services', current.id, { featured: true }, actorAdminId)
    expect((await timedService.getAdmin('services', current.id)).featuredAt).toEqual(clock)

    const before = await getPrisma().service.findMany({ where: { id: { in: [legacy.id, current.id] } }, orderBy: { id: 'asc' } })
    const allIds = (await getPrisma().service.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { id: 'asc' }, select: { id: true } })).map(({ id }) => id)
    const orderedIds = [current.id, legacy.id, ...allIds.filter((id) => id !== current.id && id !== legacy.id)]
    expect(await repository.reorder('services', orderedIds, actorAdminId)).toMatchObject({ outcome: 'UPDATED' })
    const persisted = await getPrisma().service.findMany({ where: { id: { in: [legacy.id, current.id] } }, select: { id: true, manualOrder: true } })
    expect(persisted).toEqual(expect.arrayContaining([{ id: current.id, manualOrder: 0 }, { id: legacy.id, manualOrder: 1 }]))
    const incomplete = await repository.reorder('services', [current.id], actorAdminId)
    expect(incomplete).toEqual({ outcome: 'ORDER_SET_MISMATCH' })
    const after = await getPrisma().service.findMany({ where: { id: { in: [legacy.id, current.id] } }, orderBy: { id: 'asc' } })
    expect(after.map(({ manualOrder }) => manualOrder)).toEqual(before.map((item) => item.id === current.id ? 0 : item.id === legacy.id ? 1 : item.manualOrder))
  }, remoteContentScenarioTimeoutMs)
})
