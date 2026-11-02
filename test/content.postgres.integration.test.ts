import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { PrismaContentRepository } from '../src/content/prisma-repository.js'
import { ContentService } from '../src/content/service.js'
import type { ContentResource } from '../src/content/types.js'

const shouldRun = process.env.RUN_CONTENT_DATABASE_INTEGRATION === '1'
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
  }, 30_000)

  afterAll(async () => {
    const prisma = getPrisma()
    await prisma.adminAuditLog.deleteMany({ where: { actorAdminId } })
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
  }, 30_000)

  it('persists relationships, enforces unique slugs, filters publication state, and updates records', async () => {
    const country = track('countries', await service.create('countries', {
      nameAr: 'بلد اختبار التكامل', slug: slug('country'), introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
      featured: true, displayOrder: 1, status: 'PUBLISHED',
    }, actorAdminId))
    const university = track('universities', await service.create('universities', {
      nameAr: 'جامعة اختبار التكامل', officialName: 'Integration University', slug: slug('university'),
      countryId: country.id, cityAr: 'مدينة', overviewAr: 'نظرة عامة', status: 'PUBLISHED', featured: false,
    }, actorAdminId))
    const scholarship = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة اختبار التكامل', slug: slug('scholarship'), countryId: country.id,
      universityId: university.id, studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/integration',
      applicationStatus: 'OPEN', status: 'PUBLISHED', featured: true,
    }, actorAdminId))
    const draftService = track('services', await service.create('services', {
      titleAr: 'خدمة اختبار التكامل', slug: slug('service'), summaryAr: 'ملخص',
      descriptionAr: 'وصف', displayOrder: 1, status: 'DRAFT', featured: false,
    }, actorAdminId))
    track('articles', await service.create('articles', {
      titleAr: 'مقال اختبار التكامل', slug: slug('article'), summaryAr: 'ملخص',
      bodyAr: [{ type: 'paragraph', text: 'نص' }], countryId: country.id,
      universityId: university.id, scholarshipId: scholarship.id, status: 'PUBLISHED', featured: true,
    }, actorAdminId))

    await expect(service.create('countries', {
      nameAr: 'تكرار', slug: country.slug, introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    }, actorAdminId)).rejects.toMatchObject({ code: 'SLUG_CONFLICT' })

    const countries = await service.list('countries', {
      page: 1, limit: 12, search: 'اختبار التكامل', featured: true, sort: 'manual',
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
  }, 30_000)

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

    const secondCountry = track('countries', await service.create('countries', {
      nameAr: 'بلد ثان', slug: slug('second-country'), introductionAr: 'مقدمة', detailsAr: 'تفاصيل',
    }, actorAdminId))
    const firstUniversity = await repository.findBySlug('universities', slug('university'), false)
    expect(firstUniversity).not.toBeNull()
    await expect(service.create('scholarships', {
      titleAr: 'منحة غير متسقة', slug: slug('invalid-scholarship'), countryId: secondCountry.id,
      universityId: firstUniversity?.id, studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT',
    }, actorAdminId)).rejects.toMatchObject({ code: 'RELATIONSHIP_INVALID' })
  }, 30_000)

  it('persists ordered Article Scholarship links and rolls them back with a failed audit write', async () => {
    const open = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة مفتوحة مرتبطة', slug: slug('related-open'), studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/related-open',
      applicationStatus: 'OPEN', status: 'PUBLISHED',
    }, actorAdminId))
    const closed = track('scholarships', await service.create('scholarships', {
      titleAr: 'منحة مغلقة مرتبطة', slug: slug('related-closed'), studyLevel: 'MASTERS', fundingType: 'FULL',
      requirementsAr: 'متطلبات', descriptionAr: 'وصف', officialSourceUrl: 'https://example.edu/related-closed',
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
})
