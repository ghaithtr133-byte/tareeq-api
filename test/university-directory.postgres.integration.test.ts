import 'dotenv/config'

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PrismaContentRepository } from '../src/content/prisma-repository.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { PrismaUniversityDirectoryRepository } from '../src/university-directory/prisma-repository.js'

const shouldRun = process.env.RUN_UNIVERSITY_DIRECTORY_DATABASE_INTEGRATION === '1'

describe.runIf(shouldRun)('University directory PostgreSQL integration', () => {
  const contentRepository = new PrismaContentRepository()
  const directoryRepository = new PrismaUniversityDirectoryRepository()
  const marker = randomUUID().slice(0, 8)
  const ids = {
    country: randomUUID(), cityOne: randomUUID(), cityTwo: randomUUID(),
    medicine: randomUUID(), engineering: randomUUID(), universityOne: randomUUID(), universityTwo: randomUUID(),
    medicineBachelors: randomUUID(), engineeringMasters: randomUUID(), medicineMasters: randomUUID(),
    scholarshipOne: randomUUID(), scholarshipTwo: randomUUID(), draftScholarship: randomUUID(),
  }

  beforeAll(async () => {
    const prisma = getPrisma()
    await prisma.country.create({ data: { id: ids.country, nameAr: 'بلد تكامل', nameEn: 'Integration Country', slug: `directory-country-${marker}`, introductionAr: 'مقدمة', detailsAr: 'تفاصيل', status: 'PUBLISHED', publishedAt: new Date() } })
    await prisma.city.createMany({ data: [
      { id: ids.cityOne, countryId: ids.country, slug: `directory-city-one-${marker}`, nameAr: 'مدينة أولى', nameEn: 'City One' },
      { id: ids.cityTwo, countryId: ids.country, slug: `directory-city-two-${marker}`, nameAr: 'مدينة ثانية', nameEn: 'City Two' },
    ] })
    await prisma.academicMajor.createMany({ data: [
      { id: ids.medicine, slug: `directory-medicine-${marker}`, nameAr: 'طب تكامل', nameEn: 'Integration Medicine' },
      { id: ids.engineering, slug: `directory-engineering-${marker}`, nameAr: 'هندسة تكامل', nameEn: 'Integration Engineering' },
    ] })
    await prisma.university.createMany({ data: [
      { id: ids.universityOne, countryId: ids.country, cityId: ids.cityOne, universityType: 'PUBLIC', nameAr: 'جامعة أولى', officialName: 'First Integration University', slug: `directory-university-one-${marker}`, cityAr: 'مدينة أولى', overviewAr: 'نظرة', status: 'PUBLISHED', publishedAt: new Date() },
      { id: ids.universityTwo, countryId: ids.country, cityId: ids.cityTwo, universityType: 'PRIVATE', nameAr: 'جامعة ثانية', officialName: 'Second Integration University', slug: `directory-university-two-${marker}`, cityAr: 'مدينة ثانية', overviewAr: 'نظرة', status: 'PUBLISHED', publishedAt: new Date() },
    ] })
    await prisma.universityProgram.create({ data: { id: ids.medicineBachelors, universityId: ids.universityOne, academicMajorId: ids.medicine, studyLevel: 'BACHELORS', status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/medicine-bachelors', verifiedAt: new Date(), publishedAt: new Date(), languages: { create: [{ language: 'ENGLISH' }, { language: 'ROMANIAN' }] } } })
    await prisma.universityProgram.create({ data: { id: ids.engineeringMasters, universityId: ids.universityOne, academicMajorId: ids.engineering, studyLevel: 'MASTERS', status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/engineering-masters', verifiedAt: new Date(), publishedAt: new Date(), languages: { create: [{ language: 'GERMAN' }] } } })
    await prisma.universityProgram.create({ data: { id: ids.medicineMasters, universityId: ids.universityTwo, academicMajorId: ids.medicine, studyLevel: 'MASTERS', status: 'PUBLISHED', officialSourceUrl: 'https://example.edu/medicine-masters', verifiedAt: new Date(), publishedAt: new Date(), languages: { create: [{ language: 'ENGLISH' }] } } })
    await prisma.scholarship.createMany({ data: [
      { id: ids.scholarshipOne, titleAr: 'منحة الجامعة الأولى', slug: `directory-scholarship-one-${marker}`, countryId: ids.country, universityId: ids.universityOne, studyLevel: 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', applicationStatus: 'OPEN', verifiedDeadline: new Date('2099-01-01T00:00:00.000Z'), officialSourceUrl: 'https://example.edu/scholarship-one', status: 'PUBLISHED', publishedAt: new Date() },
      { id: ids.scholarshipTwo, titleAr: 'منحة الجامعة الثانية', slug: `directory-scholarship-two-${marker}`, countryId: ids.country, universityId: ids.universityTwo, studyLevel: 'MASTERS', fundingType: 'PARTIAL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', applicationStatus: 'CLOSED', officialSourceUrl: 'https://example.edu/scholarship-two', status: 'PUBLISHED', publishedAt: new Date() },
      { id: ids.draftScholarship, titleAr: 'منحة مسودة', slug: `directory-scholarship-draft-${marker}`, countryId: ids.country, universityId: ids.universityOne, studyLevel: 'BACHELORS', fundingType: 'FULL', requirementsAr: 'متطلبات', descriptionAr: 'وصف', status: 'DRAFT' },
    ] })
  }, 30_000)

  afterAll(async () => {
    const prisma = getPrisma()
    await prisma.scholarship.deleteMany({ where: { id: { in: [ids.scholarshipOne, ids.scholarshipTwo, ids.draftScholarship] } } })
    await prisma.universityProgram.deleteMany({ where: { id: { in: [ids.medicineBachelors, ids.engineeringMasters, ids.medicineMasters] } } })
    await prisma.university.deleteMany({ where: { id: { in: [ids.universityOne, ids.universityTwo] } } })
    await prisma.academicMajor.deleteMany({ where: { id: { in: [ids.medicine, ids.engineering] } } })
    await prisma.city.deleteMany({ where: { id: { in: [ids.cityOne, ids.cityTwo] } } })
    await prisma.country.delete({ where: { id: ids.country } })
    await disconnectPrisma()
  }, 30_000)

  it('enforces same-program matching and distinct self-excluding facet counts in PostgreSQL', async () => {
    const falseMatch = await contentRepository.list('universities', {
      page: 1, limit: 12, major: `directory-medicine-${marker}`, studyLevel: 'MASTERS', language: 'GERMAN', sort: 'newest',
    }, true, new Date())
    expect(falseMatch.total).toBe(0)

    const exactMatch = await contentRepository.list('universities', {
      page: 1, limit: 12, major: `directory-medicine-${marker}`, studyLevel: 'BACHELORS', language: 'ENGLISH', city: `directory-city-one-${marker}`, universityType: 'PUBLIC', sort: 'newest',
    }, true, new Date())
    expect(exactMatch.items.map(({ id }) => id)).toEqual([ids.universityOne])

    const options = await directoryRepository.filterOptions({ major: `directory-medicine-${marker}`, language: 'ENGLISH', country: `directory-country-${marker}` })
    expect(options.studyLevels).toEqual(expect.arrayContaining([{ value: 'BACHELORS', count: 1 }, { value: 'MASTERS', count: 1 }]))
    expect(options.languages).toEqual(expect.arrayContaining([{ value: 'ENGLISH', count: 2 }, { value: 'ROMANIAN', count: 1 }]))
  }, 30_000)

  it('filters distinct published Scholarships across the complete matching University set', async () => {
    const allMedicine = await contentRepository.list('scholarships', {
      page: 1, limit: 1, universityMajor: `directory-medicine-${marker}`, sort: 'newest',
    }, true, new Date('2026-11-02T12:00:00.000Z'))
    expect(allMedicine.total).toBe(2)
    expect(allMedicine.items).toHaveLength(1)

    const exact = await contentRepository.list('scholarships', {
      page: 1, limit: 12, universityCountry: `directory-country-${marker}`,
      universityMajor: `directory-medicine-${marker}`, universityStudyLevel: 'BACHELORS',
      universityLanguage: 'ENGLISH', universityCity: `directory-city-one-${marker}`,
      universityType: 'PUBLIC', applicationStatus: 'OPEN', sort: 'deadline',
    }, true, new Date('2026-11-02T12:00:00.000Z'))
    expect(exact.total).toBe(1)
    expect(exact.items.map(({ id }) => id)).toEqual([ids.scholarshipOne])

    const falseMatch = await contentRepository.list('scholarships', {
      page: 1, limit: 12, universityMajor: `directory-medicine-${marker}`,
      universityStudyLevel: 'MASTERS', universityLanguage: 'GERMAN', sort: 'newest',
    }, true, new Date('2026-11-02T12:00:00.000Z'))
    expect(falseMatch.total).toBe(0)
  }, 30_000)
})
