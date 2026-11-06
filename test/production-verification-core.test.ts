import { describe, expect, it } from 'vitest'

import { outcomeExitCode } from '../scripts/production-verification-core.js'

describe('production verification reporting safeguards', () => {
  it('does not treat blocks or skipped scenarios as failures', () => {
    expect(outcomeExitCode([
      { id: 'blocked', category: 'test', description: 'test', environment: 'test', status: 'BLOCKED', expected: 'x', actual: 'x', durationMs: 0 },
      { id: 'skipped', category: 'test', description: 'test', environment: 'test', status: 'SKIPPED', expected: 'x', actual: 'x', durationMs: 0 },
    ])).toBe(0)
  })

  it('returns nonzero only for a real failed verification', () => {
    expect(outcomeExitCode([
      { id: 'failed', category: 'test', description: 'test', environment: 'test', status: 'FAIL', expected: 'x', actual: 'x', durationMs: 0 },
    ])).toBe(1)
  })
})
