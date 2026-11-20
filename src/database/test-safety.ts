import { Client } from 'pg'

export const TEST_DATABASE_APPROVAL = 'TAREEQ_DISPOSABLE_POSTGRES_INTEGRATION'
export const TEST_DATABASE_MARKER_PURPOSE = 'TAREEQ_DISPOSABLE_INTEGRATION_TEST_ONLY'
export const TEST_DATABASE_MODE = '1'

export const databaseIntegrationFlags = [
  'RUN_DATABASE_INTEGRATION',
  'RUN_CONTENT_DATABASE_INTEGRATION',
  'RUN_EMAIL_DATABASE_INTEGRATION',
  'RUN_SUBMISSION_DATABASE_INTEGRATION',
  'RUN_UNIVERSITY_DIRECTORY_DATABASE_INTEGRATION',
] as const

export class TestDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestDatabaseSafetyError'
  }
}

export type DisposableTestDatabaseTarget = {
  url: string
  identity: string
  database: string
}

type Environment = NodeJS.ProcessEnv

const productionLikeTarget = /(prod(?:uction)?|main|shared|backup|release)/i

const fail = (message: string): never => {
  throw new TestDatabaseSafetyError(message)
}

const targetFromUrl = (value: string, variableName: string): DisposableTestDatabaseTarget => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fail(`${variableName} must be a valid PostgreSQL connection URL.`)
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return fail(`${variableName} must use the postgresql:// or postgres:// scheme.`)
  }
  const database = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '')
  if (!url.hostname || !database) {
    return fail(`${variableName} must include a host and database name.`)
  }
  const identity = `${url.hostname.toLowerCase()}:${url.port || '5432'}/${database}`
  if (productionLikeTarget.test(identity)) {
    return fail(`${variableName} appears to identify a production, main, shared, backup, or release target.`)
  }
  return { url: value, identity, database }
}

export const isTestDatabaseMode = (environment: Environment = process.env) =>
  environment.TAREEQ_TEST_DATABASE_MODE === TEST_DATABASE_MODE

export const hasEnabledDatabaseIntegrationSuite = (environment: Environment = process.env) =>
  databaseIntegrationFlags.some((name) => environment[name] === '1')

/**
 * Performs only configuration validation. The database-resident marker is
 * checked by verifyDisposableTestDatabase before the wrapper runs migrations
 * or a suite creates any fixture.
 */
export const getDisposableTestDatabaseTarget = (
  environment: Environment = process.env,
): DisposableTestDatabaseTarget => {
  if (!isTestDatabaseMode(environment)) {
    return fail('TAREEQ_TEST_DATABASE_MODE=1 is required for database integration work.')
  }
  if (environment.TAREEQ_TEST_DATABASE_APPROVAL !== TEST_DATABASE_APPROVAL) {
    return fail('TAREEQ_TEST_DATABASE_APPROVAL does not contain the required disposable-target approval value.')
  }
  const rawUrl = environment.TEST_DATABASE_URL
  if (!rawUrl) return fail('TEST_DATABASE_URL is required; DATABASE_URL and DIRECT_DATABASE_URL are never test fallbacks.')

  const target = targetFromUrl(rawUrl, 'TEST_DATABASE_URL')
  if (environment.TEST_DATABASE_TARGET_ID !== target.identity) {
    return fail('TEST_DATABASE_TARGET_ID must exactly match the sanitized TEST_DATABASE_URL target identity.')
  }

  for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const) {
    const configured = environment[name]
    if (!configured) continue
    const configuredTarget = targetFromUrl(configured, name)
    if (configuredTarget.identity !== target.identity) {
      return fail(`${name} does not resolve to TEST_DATABASE_TARGET_ID; refusing a mismatched target.`)
    }
  }
  return target
}

/**
 * Verifies a marker installed manually in an otherwise disposable database.
 * The query is read-only and runs before migrations, fixtures, or cleanup.
 */
export const verifyDisposableTestDatabase = async (
  environment: Environment = process.env,
) => {
  const target = getDisposableTestDatabaseTarget(environment)
  const client = new Client({ connectionString: target.url })
  try {
    await client.connect()
    const currentDatabase = await client.query<{ database: string }>(
      'SELECT current_database() AS database',
    )
    if (currentDatabase.rows[0]?.database !== target.database) {
      return fail('Connected database name does not match TEST_DATABASE_URL; refusing the target.')
    }
    const marker = await client.query<{ target_identity: string; purpose: string }>(
      'SELECT target_identity, purpose FROM tareeq_test_guard.target_marker WHERE singleton = TRUE',
    )
    if (
      marker.rows.length !== 1 ||
      marker.rows[0]?.target_identity !== target.identity ||
      marker.rows[0]?.purpose !== TEST_DATABASE_MARKER_PURPOSE
    ) {
      return fail('The database-resident disposable-target marker is missing, ambiguous, or does not match TEST_DATABASE_TARGET_ID.')
    }
    return target
  } finally {
    await client.end().catch(() => undefined)
  }
}
