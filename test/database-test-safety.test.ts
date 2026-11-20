import { describe, expect, it } from 'vitest'

import {
  getDisposableTestDatabaseTarget,
  TEST_DATABASE_APPROVAL,
  TEST_DATABASE_MODE,
  TestDatabaseSafetyError,
} from '../src/database/test-safety.js'

const targetIdentity = 'ep-disposable-123.us-east-2.aws.neon.tech:5432/tareeq_integration'

const safeEnvironment = (): NodeJS.ProcessEnv => ({
  TAREEQ_TEST_DATABASE_MODE: TEST_DATABASE_MODE,
  TAREEQ_TEST_DATABASE_APPROVAL: TEST_DATABASE_APPROVAL,
  TEST_DATABASE_URL: 'postgresql://integration_user:placeholder@ep-disposable-123.us-east-2.aws.neon.tech:5432/tareeq_integration?sslmode=require',
  TEST_DATABASE_TARGET_ID: targetIdentity,
})

const expectSafetyFailure = (environment: NodeJS.ProcessEnv) => {
  expect(() => getDisposableTestDatabaseTarget(environment)).toThrow(TestDatabaseSafetyError)
}

describe('disposable PostgreSQL integration safety guard', () => {
  it('accepts only an explicit approved TEST_DATABASE_URL target', () => {
    expect(getDisposableTestDatabaseTarget(safeEnvironment())).toMatchObject({
      identity: targetIdentity,
      database: 'tareeq_integration',
    })
  })

  it('fails closed when required test-only configuration is missing', () => {
    expectSafetyFailure({})
    const withoutApproval = safeEnvironment()
    delete withoutApproval.TAREEQ_TEST_DATABASE_APPROVAL
    expectSafetyFailure(withoutApproval)
    const withoutUrl = safeEnvironment()
    delete withoutUrl.TEST_DATABASE_URL
    expectSafetyFailure(withoutUrl)
  })

  it('rejects malformed URLs and an identity that does not match the configured target', () => {
    const malformed = safeEnvironment()
    malformed.TEST_DATABASE_URL = 'not-a-postgresql-url'
    expectSafetyFailure(malformed)

    const mismatch = safeEnvironment()
    mismatch.TEST_DATABASE_TARGET_ID = 'ep-other.us-east-2.aws.neon.tech:5432/tareeq_integration'
    expectSafetyFailure(mismatch)
  })

  it('rejects production-looking, backup, shared, and main targets even when explicitly marked', () => {
    for (const database of ['tareeq_production', 'tareeq-main', 'shared_data', 'backup_before_release']) {
      const environment = safeEnvironment()
      environment.TEST_DATABASE_URL = `postgresql://integration_user:placeholder@ep-disposable-123.us-east-2.aws.neon.tech:5432/${database}`
      environment.TEST_DATABASE_TARGET_ID = `ep-disposable-123.us-east-2.aws.neon.tech:5432/${database}`
      expectSafetyFailure(environment)
    }
  })

  it('rejects production or direct connection variables that point to another target', () => {
    const databaseMismatch = safeEnvironment()
    databaseMismatch.DATABASE_URL = 'postgresql://prod_user:placeholder@ep-production-1.us-east-2.aws.neon.tech:5432/tareeq'
    expectSafetyFailure(databaseMismatch)

    const directMismatch = safeEnvironment()
    directMismatch.DIRECT_DATABASE_URL = 'postgresql://prod_user:placeholder@ep-production-1.us-east-2.aws.neon.tech:5432/tareeq'
    expectSafetyFailure(directMismatch)
  })
})
