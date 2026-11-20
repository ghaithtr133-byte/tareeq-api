import { describe, expect, it, vi } from 'vitest'

import { acquireTransactionAdvisoryLock } from '../src/database/advisory-lock.js'

describe('PostgreSQL advisory locks', () => {
  it('uses executeRaw so PostgreSQL void results are not deserialized', async () => {
    const executeRaw = vi.fn(async () => 1)

    await acquireTransactionAdvisoryLock(
      { $executeRaw: executeRaw } as never,
      9_000_040,
    )

    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(executeRaw).toHaveBeenCalledWith(expect.anything())
  })
})
