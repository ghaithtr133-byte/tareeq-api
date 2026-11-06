import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repositoryPath = fileURLToPath(new URL('../src/analytics/prisma-repository.ts', import.meta.url))

describe('PostgreSQL analytics summary SQL', () => {
  it('derives parameterized submission and event buckets before grouping them', async () => {
    const source = await readFile(repositoryPath, 'utf8')

    expect(source).toContain('WITH "trendEvents" AS')
    expect(source).toContain('WITH "submissionEvents" AS')
    expect(source).toContain('CAST(${granularity} AS text)')
    expect(source).toContain('GROUP BY "periodStart"')
    expect(source).not.toMatch(/GROUP BY\s+date_trunc\(/)
  })
})
