import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  VerificationReporter,
  outcomeExitCode,
  safeError,
} from './production-verification-core.js'

type AcceptanceCheck = { id: string, category: string, status: 'PASS' | 'FAIL' | 'BLOCKED', expected: string, actual: string }
type AcceptanceReport = { summary: { passed: number, failed: number, blocked: number }, checks: AcceptanceCheck[] }

const baseUrl = (process.env.PRODUCTION_API_BASE_URL ?? 'https://api.tareeq-academy.com').replace(/\/$/, '')
const publicOrigin = process.env.PRODUCTION_PUBLIC_ORIGIN ?? 'https://tareeq-academy.com'
const adminOrigin = process.env.PRODUCTION_ADMIN_ORIGIN ?? 'https://admin.tareeq-academy.com'
const reporter = new VerificationReporter('readonly', baseUrl, true, [
  'Only GET, OPTIONS, and safe unauthenticated boundary requests are made to production.',
  'No provider API call, database mutation, login, session creation, seed, cleanup, migration, or deployment is performed.',
  'Reports omit response bodies, credentials, cookies, recipient addresses, tokens, and connection strings.',
])

const run = (command: string, args: string[], environment = process.env, timeoutMs = 180_000) => new Promise<{ code: number, output: string, timedOut: boolean }>((resolveRun) => {
  const child = spawn(command, args, { cwd: process.cwd(), env: environment, shell: false, windowsHide: true })
  let output = ''
  let settled = false
  const finish = (result: { code: number, output: string, timedOut: boolean }) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveRun(result)
  }
  const timer = setTimeout(() => {
    child.kill()
    finish({ code: 124, output, timedOut: true })
  }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.on('error', (error) => finish({ code: 1, output: safeError(error), timedOut: false }))
  child.on('close', (code) => finish({ code: code ?? 1, output, timedOut: false }))
})

const request = async (url: string, options: RequestInit = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const started = performance.now()
  try {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: controller.signal })
    return { response, durationMs: Math.round(performance.now() - started) }
  } finally {
    clearTimeout(timer)
  }
}

const addAvailabilityCheck = async (id: string, category: string, url: string, expectedStatuses: number[]) => {
  await reporter.measure({
    id,
    category,
    description: `${url} is reachable over HTTPS.`,
    environment: 'production',
    expected: `HTTP ${expectedStatuses.join(' or ')} with a bounded response.`,
  }, async () => {
    const { response, durationMs } = await request(url)
    const ok = expectedStatuses.includes(response.status)
    return {
      status: ok ? 'PASS' : 'FAIL',
      actual: `HTTP ${response.status}; ${durationMs} ms.`,
      httpStatus: response.status,
      failureReason: ok ? undefined : 'Unexpected HTTP response.',
      nextAction: ok ? undefined : 'Check the deployed route and DNS/TLS configuration.',
    }
  })
}

const acceptanceOutputDirectory = resolve('reports', 'production-verification', `acceptance-${Date.now()}`)
await mkdir(acceptanceOutputDirectory, { recursive: true })

await Promise.all([
  addAvailabilityCheck('infrastructure.backend_https', 'Infrastructure', `${baseUrl}/`, [200]),
  addAvailabilityCheck('infrastructure.public_website_redirect', 'Infrastructure', publicOrigin, [200, 301, 302, 307, 308]),
  addAvailabilityCheck('infrastructure.admin_dashboard_redirect', 'Infrastructure', adminOrigin, [200, 301, 302, 307, 308]),
])

await reporter.measure({
  id: 'infrastructure.tls_and_request_id',
  category: 'Infrastructure',
  description: 'The production health route is HTTPS, healthy, and carries a request ID.',
  environment: 'production',
  expected: 'HTTP 200, HTTPS target, and X-Request-Id.',
}, async () => {
  const { response, durationMs } = await request(`${baseUrl}/api/v1/health`, { headers: { 'X-Request-Id': 'production-readonly-health' } })
  const ok = response.status === 200 && Boolean(response.headers.get('x-request-id')) && baseUrl.startsWith('https://')
  return { status: ok ? 'PASS' : 'FAIL', actual: `HTTP ${response.status}; request ID=${Boolean(response.headers.get('x-request-id'))}; ${durationMs} ms.`, httpStatus: response.status, failureReason: ok ? undefined : 'Health/TLS/request-ID expectation was not met.', nextAction: ok ? undefined : 'Inspect the deployed health and response middleware.' }
})

await reporter.measure({
  id: 'openapi.release_contract',
  category: 'API Contract',
  description: 'Production OpenAPI is 3.1 and has the same 128 method/path operations as local generated artifacts.',
  environment: 'production',
  expected: 'OpenAPI 3.1.0 and exactly 128 operations.',
}, async () => {
  const { response, durationMs } = await request(`${baseUrl}/openapi.json`)
  const document = await response.json() as { openapi?: string, paths?: Record<string, Record<string, unknown>> }
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])
  const operationCount = Object.values(document.paths ?? {}).flatMap((item) => Object.keys(item).filter((method) => methods.has(method))).length
  const internalDocumented = Object.keys(document.paths ?? {}).some((path) => path.includes('/internal/cron/'))
  const ok = response.status === 200 && document.openapi === '3.1.0' && operationCount === 128 && !internalDocumented
  return { status: ok ? 'PASS' : 'FAIL', actual: `HTTP ${response.status}; OpenAPI=${document.openapi ?? 'missing'}; operations=${operationCount}; internal dispatcher documented=${internalDocumented}; ${durationMs} ms.`, httpStatus: response.status, failureReason: ok ? undefined : 'Deployed OpenAPI contract differs from the expected public contract.', nextAction: ok ? undefined : 'Compare generated local OpenAPI and deployed release artifacts.' }
})

const verifier = await run('pwsh', ['-NoProfile', '-File', 'scripts/verify-backend.ps1', '-BaseUrl', baseUrl, '-PublicOrigin', publicOrigin, '-AdminOrigin', adminOrigin, '-OutputDirectory', acceptanceOutputDirectory, '-TimeoutSeconds', '5'])
const acceptancePath = join(acceptanceOutputDirectory, 'backend-acceptance.json')
if (verifier.code !== 0 || !existsSync(acceptancePath)) {
  reporter.add({ id: 'acceptance.runner', category: 'API Contract', description: 'Existing read-only acceptance verifier completes.', environment: 'production', status: verifier.timedOut ? 'BLOCKED' : 'FAIL', expected: 'A sanitized acceptance report is produced.', actual: verifier.timedOut ? 'The verifier exceeded the 180-second orchestration budget and was stopped before it could finish.' : 'The verifier did not produce a report.', failureReason: verifier.timedOut ? 'Bounded production-verification timeout.' : 'Acceptance verifier process failed.', nextAction: 'Run `pwsh -File scripts/verify-backend.ps1` directly from an approved operator environment to obtain the complete detailed report.' })
} else {
  const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8')) as AcceptanceReport
  for (const check of acceptance.checks) {
    reporter.add({ id: `acceptance.${check.id}`, category: check.category, description: 'Existing production acceptance check.', environment: 'production', status: check.status, expected: check.expected, actual: check.actual, nextAction: check.status === 'BLOCKED' ? 'Provide separately authorized, legitimate authenticated browser/session evidence.' : undefined })
  }
}

const commands: Array<{ id: string, category: string, args: string[], expected: string }> = [
  { id: 'database.migration_status', category: 'Neon Read-only', args: ['run', 'prisma:migrate:status'], expected: '12 applied migrations and no pending, failed, or unknown migrations.' },
  { id: 'database.demo_seed_preflight', category: 'Neon Read-only', args: ['run', 'seed:demo:preflight'], expected: 'Committed 88-record private demo batch remains safe and complete.' },
  { id: 'providers.integration_preflight', category: 'Provider Readiness', args: ['run', 'integrations:preflight'], expected: 'Local configuration and scheduler structure pass without provider calls or writes.' },
]
for (const command of commands) {
  const result = await run('npm.cmd', command.args)
  const noTestData = command.id === 'providers.integration_preflight' && result.output.includes('"status": "UNVERIFIED"')
  reporter.add({
    id: command.id,
    category: command.category,
    description: 'Existing read-only repository utility.',
    environment: 'local configuration + Neon main',
    status: result.code === 0 ? 'PASS' : noTestData ? 'UNVERIFIED' : 'FAIL',
    expected: command.expected,
    actual: result.code === 0 ? 'Completed without logging sensitive values.' : noTestData ? 'Recipient allowlist is intentionally absent; no live delivery is authorized.' : 'Read-only utility returned a nonzero status.',
    failureReason: result.code === 0 || noTestData ? undefined : 'Repository read-only utility failed.',
    nextAction: noTestData ? 'Set only an ephemeral approved-recipient allowlist after separate live-test authorization.' : result.code === 0 ? undefined : 'Inspect the local sanitized utility output before proceeding.',
  })
}

const written = await reporter.write()
console.log(`Production read-only report: ${written.jsonPath}`)
console.log(`Production read-only summary: ${JSON.stringify(written.report.summary)}`)
process.exitCode = outcomeExitCode(written.report.checks)
