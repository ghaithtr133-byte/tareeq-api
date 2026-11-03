import type { DemoFixture } from './demo-seed-fixtures.js'

export type FixtureState = 'MISSING' | 'EXACT' | 'DRIFTED' | 'COLLISION'

export type FixtureInspection = {
  key: string
  state: FixtureState
}

export type BatchStatus = 'NONE' | 'PLANNED' | 'FAILED' | 'COMMITTED' | 'CLEANED'

export type SeedPlan = {
  operation: 'SEED'
  create: DemoFixture[]
  preserve: DemoFixture[]
  counts: Record<string, { create: number; preserve: number }>
}

export type CleanupPlan = {
  operation: 'CLEANUP'
  remove: DemoFixture[]
  counts: Record<string, number>
}

export interface DemoSeedWriter {
  create(fixture: DemoFixture): Promise<void>
  remove(fixture: DemoFixture): Promise<void>
}

export interface DemoSeedRepository {
  inspect(fixtures: DemoFixture[]): Promise<FixtureInspection[]>
  externalDependencyBlockers(fixtures: DemoFixture[]): Promise<string[]>
  transaction<T>(operation: (writer: DemoSeedWriter) => Promise<T>): Promise<T>
}

const countSeedPlan = (create: DemoFixture[], preserve: DemoFixture[]) => {
  const counts: Record<string, { create: number; preserve: number }> = {}
  for (const fixture of [...create, ...preserve]) {
    counts[fixture.model] ??= { create: 0, preserve: 0 }
  }
  for (const fixture of create) counts[fixture.model]!.create += 1
  for (const fixture of preserve) counts[fixture.model]!.preserve += 1
  return counts
}

const assertCompleteInspection = (
  fixtures: DemoFixture[],
  inspections: FixtureInspection[],
) => {
  const byKey = new Map(inspections.map((inspection) => [inspection.key, inspection]))
  const missing = fixtures.filter(({ key }) => !byKey.has(key))
  if (missing.length > 0) {
    throw new Error('BLOCKED — Fixture inspection was incomplete; no writes were performed.')
  }
  return byKey
}

export const planDemoSeed = (
  fixtures: DemoFixture[],
  inspections: FixtureInspection[],
  batchStatus: BatchStatus,
): SeedPlan => {
  const byKey = assertCompleteInspection(fixtures, inspections)
  const drifted = fixtures.filter(({ key }) => byKey.get(key)?.state === 'DRIFTED')
  const collisions = fixtures.filter(({ key }) => byKey.get(key)?.state === 'COLLISION')
  if (drifted.length > 0 || collisions.length > 0) {
    throw new Error(
      `BLOCKED — Demo fixture ownership conflict (${drifted.length} drifted, ${collisions.length} collisions); no writes were performed.`,
    )
  }

  const exact = fixtures.filter(({ key }) => byKey.get(key)?.state === 'EXACT')
  const missing = fixtures.filter(({ key }) => byKey.get(key)?.state === 'MISSING')
  const ownsExisting = batchStatus === 'PLANNED' || batchStatus === 'FAILED' || batchStatus === 'COMMITTED'

  if (exact.length > 0 && !ownsExisting) {
    throw new Error(
      'BLOCKED — Stable demo fixture identifiers already exist without an active owning manifest.',
    )
  }
  if (batchStatus === 'COMMITTED' && missing.length > 0) {
    throw new Error(
      'BLOCKED — A committed demo batch is incomplete; preserve the manifest and investigate before retrying.',
    )
  }
  if (
    (batchStatus === 'PLANNED' || batchStatus === 'FAILED') &&
    exact.length > 0 &&
    missing.length > 0
  ) {
    throw new Error(
      'BLOCKED — A planned demo batch is partially present; automatic repair is intentionally refused.',
    )
  }

  const create = exact.length === fixtures.length ? [] : missing
  return {
    operation: 'SEED',
    create,
    preserve: exact,
    counts: countSeedPlan(create, exact),
  }
}

export const planDemoCleanup = (
  fixtures: DemoFixture[],
  inspections: FixtureInspection[],
  batchStatus: BatchStatus,
  blockers: string[],
): CleanupPlan => {
  if (batchStatus === 'CLEANED') {
    const byKey = assertCompleteInspection(fixtures, inspections)
    if (fixtures.some(({ key }) => byKey.get(key)?.state !== 'MISSING')) {
      throw new Error('BLOCKED — A cleaned batch still has fixture records; investigate manually.')
    }
    return { operation: 'CLEANUP', remove: [], counts: {} }
  }
  if (batchStatus !== 'COMMITTED') {
    throw new Error('BLOCKED — Cleanup requires a committed demo-seed manifest.')
  }
  if (blockers.length > 0) {
    throw new Error(
      `BLOCKED — Non-demo records depend on temporary fixtures (${blockers.join(', ')}).`,
    )
  }

  const byKey = assertCompleteInspection(fixtures, inspections)
  const unsafe = fixtures.filter(({ key }) => byKey.get(key)?.state !== 'EXACT')
  if (unsafe.length > 0) {
    throw new Error(
      'BLOCKED — Cleanup ownership verification failed because a fixture is missing, changed, or colliding.',
    )
  }

  const remove = [...fixtures].reverse()
  const counts: Record<string, number> = {}
  for (const fixture of remove) counts[fixture.model] = (counts[fixture.model] ?? 0) + 1
  return { operation: 'CLEANUP', remove, counts }
}

export const applySeedPlan = async (
  repository: DemoSeedRepository,
  plan: SeedPlan,
) => repository.transaction(async (writer) => {
  for (const fixture of plan.create) await writer.create(fixture)
})

export const applyCleanupPlan = async (
  repository: DemoSeedRepository,
  plan: CleanupPlan,
) => repository.transaction(async (writer) => {
  for (const fixture of plan.remove) await writer.remove(fixture)
})
