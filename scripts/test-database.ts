import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import {
  databaseIntegrationFlags,
  getDisposableTestDatabaseTarget,
  TEST_DATABASE_MODE,
  verifyDisposableTestDatabase,
} from '../src/database/test-safety.js'

const command = process.argv[2]
if (command !== 'preflight' && command !== 'migrate' && command !== 'integration') {
  throw new Error('Usage: tsx scripts/test-database.ts <preflight|migrate|integration>')
}

const target = await verifyDisposableTestDatabase()

if (command === 'preflight') {
  console.log(`Disposable PostgreSQL target verified: ${target.identity}`)
  process.exit(0)
}

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: target.url,
  DIRECT_DATABASE_URL: target.url,
  TAREEQ_TEST_DATABASE_MODE: TEST_DATABASE_MODE,
}

const run = (file: string, args: string[]) => new Promise<void>((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', rejectRun)
  child.once('exit', (code) => code === 0
    ? resolveRun()
    : rejectRun(new Error(`Disposable test-database command exited with code ${code ?? 'unknown'}.`)))
})

if (command === 'migrate') {
  await run(resolve('node_modules/prisma/build/index.js'), ['migrate', 'deploy'])
} else {
  for (const flag of databaseIntegrationFlags) environment[flag] = '1'
  await run(resolve('node_modules/vitest/vitest.mjs'), [
    'run',
    '--no-file-parallelism',
    '--maxWorkers', '1',
    '--testTimeout', '30000',
    '--hookTimeout', '30000',
    'test/auth.postgres.integration.test.ts',
    'test/auth-recovery.postgres.integration.test.ts',
    'test/content.postgres.integration.test.ts',
    'test/deletion.postgres.integration.test.ts',
    'test/email-notifications.postgres.integration.test.ts',
    'test/submissions.postgres.integration.test.ts',
    'test/university-directory.postgres.integration.test.ts',
  ])
}

// Keep the pure configuration guard reachable from this entrypoint in tests and
// prevent accidental removal of the explicit TEST_DATABASE_URL requirement.
getDisposableTestDatabaseTarget(environment)
