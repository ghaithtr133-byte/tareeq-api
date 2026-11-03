import { describe, expect, it } from 'vitest'

import {
  applyCleanupPlan,
  applySeedPlan,
  type DemoSeedRepository,
  type DemoSeedWriter,
  type FixtureInspection,
  planDemoCleanup,
  planDemoSeed,
} from '../scripts/demo-seed-core.js'
import {
  buildDemoFixtures,
  DEMO_OPERATIONAL_EXCLUSIONS,
  fixtureCounts,
} from '../scripts/demo-seed-fixtures.js'

const BASE_TIME = new Date('2026-11-03T12:00:00.000Z')
const privateFixtures = buildDemoFixtures(BASE_TIME, 'private')

const inspections = (state: FixtureInspection['state']): FixtureInspection[] =>
  privateFixtures.map(({ key }) => ({ key, state }))

class InMemoryDemoRepository implements DemoSeedRepository {
  readonly records = new Set<string>()
  readonly permanentRecords = new Set(['permanent-country', 'permanent-admin'])
  blockers: string[] = []
  failOnCreate: number | null = null
  creates = 0
  removes = 0

  inspect = async () => privateFixtures.map(({ key }) => ({
    key,
    state: this.records.has(key) ? 'EXACT' as const : 'MISSING' as const,
  }))

  externalDependencyBlockers = async () => this.blockers

  async transaction<T>(operation: (writer: DemoSeedWriter) => Promise<T>) {
    const snapshot = new Set(this.records)
    const writer: DemoSeedWriter = {
      create: async (fixture) => {
        this.creates += 1
        if (this.failOnCreate === this.creates) throw new Error('simulated transaction failure')
        this.records.add(fixture.key)
      },
      remove: async (fixture) => {
        this.removes += 1
        this.records.delete(fixture.key)
      },
    }
    try {
      return await operation(writer)
    } catch (error) {
      this.records.clear()
      snapshot.forEach((key) => this.records.add(key))
      throw error
    }
  }
}

describe('reversible demo seed fixtures', () => {
  it('builds the exact focused coverage matrix with stable unique fixture identifiers', () => {
    expect(privateFixtures).toHaveLength(88)
    expect(fixtureCounts(privateFixtures)).toEqual({
      Country: 3,
      City: 4,
      AcademicMajor: 3,
      University: 4,
      UniversityProgram: 5,
      UniversityProgramLanguage: 6,
      UniversityProgramTuition: 3,
      UniversityAdmissionRequirement: 3,
      UniversityGalleryImage: 3,
      Scholarship: 4,
      Service: 3,
      FaqEntry: 18,
      Article: 3,
      ArticleScholarship: 6,
      StudentApplication: 4,
      GeneralInquiry: 4,
      AnalyticsEvent: 12,
    })
    expect(new Set(privateFixtures.map(({ key }) => key)).size).toBe(privateFixtures.length)
    const ids = privateFixtures.flatMap(({ id }) => id ? [id] : [])
    expect(new Set(ids).size).toBe(ids.length)
    expect(DEMO_OPERATIONAL_EXCLUSIONS).toContain('AdminUser')
    expect(DEMO_OPERATIONAL_EXCLUSIONS).toContain('EmailNotification')
    expect(DEMO_OPERATIONAL_EXCLUSIONS).toContain('AdminAuditLog')
  })

  it('defaults every publishable fixture to private while preserving draft and archive edge cases', () => {
    const statuses = privateFixtures
      .map(({ data }) => data.status)
      .filter((status) => typeof status === 'string')
    expect(statuses).not.toContain('PUBLISHED')
    expect(statuses).toContain('DRAFT')
    expect(statuses).toContain('ARCHIVED')

    const publishedFixtures = buildDemoFixtures(BASE_TIME, 'published')
    expect(publishedFixtures.some(({ data }) => data.status === 'PUBLISHED')).toBe(true)
    expect(publishedFixtures.find(({ key }) => key === 'scholarship.synthetic-open-draft')?.data.status).toBe('DRAFT')
    expect(publishedFixtures.filter(({ model }) => model === 'UniversityGalleryImage')
      .every(({ data }) => data.status === 'DRAFT')).toBe(true)
  })

  it('keeps every relationship inside the fixture catalog and uses synthetic workflow identities', () => {
    const ids = new Set(privateFixtures.flatMap(({ id }) => id ? [id] : []))
    const relationshipFields = [
      'countryId', 'cityId', 'universityId', 'academicMajorId', 'programId',
      'scholarshipId', 'articleId', 'serviceId',
    ]
    for (const fixture of privateFixtures) {
      for (const field of relationshipFields) {
        const value = fixture.data[field]
        if (typeof value === 'string') expect(ids.has(value), `${fixture.key}.${field}`).toBe(true)
      }
    }
    const emails = privateFixtures
      .filter(({ model }) => model === 'StudentApplication' || model === 'GeneralInquiry')
      .map(({ data }) => data.email)
    expect(emails.every((email) => String(email).endsWith('@example.invalid'))).toBe(true)
  })

  it('satisfies the migration checks and representative edge-case shapes', () => {
    const programs = privateFixtures.filter(({ model }) => model === 'UniversityProgram')
    expect(programs.every(({ data }) =>
      String(data.officialSourceUrl).startsWith('https://') &&
      data.verifiedAt instanceof Date &&
      Number(data.durationValue) > 0 &&
      ['MONTHS', 'YEARS'].includes(String(data.durationUnit)),
    )).toBe(true)

    const tuition = privateFixtures.filter(({ model }) => model === 'UniversityProgramTuition')
    expect(tuition.every(({ data }) =>
      /^\d{4}\/\d{4}$/.test(String(data.academicYear)) &&
      /^[A-Z]{3}$/.test(String(data.currency)) &&
      Number(data.amount) >= 0,
    )).toBe(true)

    const admissions = privateFixtures.filter(({ model }) => model === 'UniversityAdmissionRequirement')
    expect(admissions.map(({ data }) => data.scope).sort()).toEqual([
      'PROGRAM', 'STUDY_LEVEL', 'UNIVERSITY',
    ])
    expect(privateFixtures.filter(({ model }) => model === 'UniversityGalleryImage')
      .every(({ data }) => String(data.imageUrl).startsWith('https://example.invalid/'))).toBe(true)
    expect(privateFixtures.filter(({ model, data }) => model === 'FaqEntry' && data.scope === 'GLOBAL'))
      .toHaveLength(7)

    const applicationStates = privateFixtures
      .filter(({ model }) => model === 'StudentApplication')
      .map(({ data }) => data.status)
      .sort()
    expect(applicationStates).toEqual(['CLOSED', 'IN_REVIEW', 'NEW', 'RESOLVED'])

    const analyticsTypes = new Set(privateFixtures
      .filter(({ model }) => model === 'AnalyticsEvent')
      .map(({ data }) => data.type))
    expect(analyticsTypes).toEqual(new Set([
      'PAGE_VIEW', 'CTA_CLICK', 'ENGAGEMENT',
      'APPLICATION_SUBMITTED', 'INQUIRY_SUBMITTED',
    ]))
  })
})

describe('demo seed and cleanup safety planning', () => {
  it('plans all missing records without writing during preview', () => {
    const repository = new InMemoryDemoRepository()
    const plan = planDemoSeed(privateFixtures, inspections('MISSING'), 'NONE')
    expect(plan.create).toHaveLength(88)
    expect(plan.preserve).toHaveLength(0)
    expect(repository.creates).toBe(0)
  })

  it('is idempotent only for an exact committed manifest-owned batch', () => {
    const plan = planDemoSeed(privateFixtures, inspections('EXACT'), 'COMMITTED')
    expect(plan.create).toHaveLength(0)
    expect(plan.preserve).toHaveLength(88)
    expect(() => planDemoSeed(privateFixtures, inspections('EXACT'), 'NONE'))
      .toThrow(/without an active owning manifest/)
  })

  it('refuses collisions, drift, and partial planned batches', () => {
    const collision = inspections('MISSING')
    collision[0] = { key: privateFixtures[0]!.key, state: 'COLLISION' }
    expect(() => planDemoSeed(privateFixtures, collision, 'NONE')).toThrow(/ownership conflict/)

    const drift = inspections('EXACT')
    drift[1] = { key: privateFixtures[1]!.key, state: 'DRIFTED' }
    expect(() => planDemoSeed(privateFixtures, drift, 'COMMITTED')).toThrow(/ownership conflict/)

    const partial = inspections('MISSING')
    partial[0] = { key: privateFixtures[0]!.key, state: 'EXACT' }
    expect(() => planDemoSeed(privateFixtures, partial, 'PLANNED')).toThrow(/partially present/)
  })

  it('rolls back a simulated partial seed failure atomically', async () => {
    const repository = new InMemoryDemoRepository()
    repository.failOnCreate = 5
    const plan = planDemoSeed(privateFixtures, inspections('MISSING'), 'NONE')
    await expect(applySeedPlan(repository, plan)).rejects.toThrow('simulated transaction failure')
    expect(repository.records.size).toBe(0)
    expect(repository.permanentRecords).toEqual(new Set(['permanent-country', 'permanent-admin']))
  })

  it('requires exact ownership and no external dependencies before cleanup', () => {
    expect(() => planDemoCleanup(
      privateFixtures,
      inspections('EXACT'),
      'COMMITTED',
      ['Application.EmailNotification'],
    )).toThrow(/Non-demo records depend/)

    const drift = inspections('EXACT')
    drift[0] = { key: privateFixtures[0]!.key, state: 'DRIFTED' }
    expect(() => planDemoCleanup(privateFixtures, drift, 'COMMITTED', []))
      .toThrow(/ownership verification failed/)
  })

  it('cleans only manifest fixtures in reverse dependency order and preserves permanent records', async () => {
    const repository = new InMemoryDemoRepository()
    privateFixtures.forEach(({ key }) => repository.records.add(key))
    const plan = planDemoCleanup(privateFixtures, inspections('EXACT'), 'COMMITTED', [])
    expect(plan.remove[0]?.key).toBe(privateFixtures.at(-1)?.key)
    expect(plan.remove.at(-1)?.key).toBe(privateFixtures[0]?.key)
    await applyCleanupPlan(repository, plan)
    expect(repository.records.size).toBe(0)
    expect(repository.removes).toBe(88)
    expect(repository.permanentRecords).toEqual(new Set(['permanent-country', 'permanent-admin']))
  })
})
