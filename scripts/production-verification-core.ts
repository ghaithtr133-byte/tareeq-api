import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type VerificationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'UNVERIFIED'

export type VerificationCheck = {
  id: string
  category: string
  description: string
  environment: string
  status: VerificationStatus
  expected: string
  actual: string
  durationMs: number
  httpStatus?: number | undefined
  failureReason?: string | undefined
  nextAction?: string | undefined
}

export type ProductionVerificationReport = {
  schemaVersion: 1
  kind: 'readonly' | 'live'
  generatedAtUtc: string
  target: string
  dryRun: boolean
  safeguards: string[]
  summary: Record<VerificationStatus, number>
  checks: VerificationCheck[]
}

const statuses: VerificationStatus[] = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'UNVERIFIED']

export class VerificationReporter {
  readonly checks: VerificationCheck[] = []

  constructor(
    private readonly kind: ProductionVerificationReport['kind'],
    private readonly target: string,
    private readonly dryRun: boolean,
    private readonly safeguards: string[],
  ) {}

  add(check: Omit<VerificationCheck, 'durationMs'> & { durationMs?: number }) {
    this.checks.push({ durationMs: 0, ...check })
  }

  async measure(
    input: Omit<VerificationCheck, 'status' | 'actual' | 'durationMs'>,
    operation: () => Promise<{ status: VerificationStatus, actual: string, httpStatus?: number | undefined, failureReason?: string | undefined, nextAction?: string | undefined }>,
  ) {
    const started = performance.now()
    try {
      const result = await operation()
      this.add({ ...input, ...result, durationMs: Math.round(performance.now() - started) })
    } catch (error) {
      this.add({
        ...input,
        status: 'FAIL',
        actual: 'The verification operation did not complete.',
        durationMs: Math.round(performance.now() - started),
        failureReason: safeError(error),
        nextAction: 'Inspect the local runner diagnostics without disclosing credentials or response bodies.',
      })
    }
  }

  async write() {
    const summary = Object.fromEntries(statuses.map((status) => [
      status,
      this.checks.filter((check) => check.status === status).length,
    ])) as Record<VerificationStatus, number>
    const report: ProductionVerificationReport = {
      schemaVersion: 1,
      kind: this.kind,
      generatedAtUtc: new Date().toISOString(),
      target: this.target,
      dryRun: this.dryRun,
      safeguards: this.safeguards,
      summary,
      checks: this.checks,
    }
    const timestamp = report.generatedAtUtc.replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z')
    const directory = resolve('reports', 'production-verification')
    await mkdir(directory, { recursive: true })
    const stem = `${this.kind}-${timestamp}`
    const jsonPath = join(directory, `${stem}.json`)
    const markdownPath = join(directory, `${stem}.md`)
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await writeFile(markdownPath, toMarkdown(report), 'utf8')
    return { report, jsonPath, markdownPath }
  }
}

export const safeError = (error: unknown) =>
  error instanceof Error ? error.name : 'UnknownError'

export const outcomeExitCode = (checks: VerificationCheck[]) =>
  checks.some((check) => check.status === 'FAIL') ? 1 : 0

const cell = (value: string | undefined) => (value ?? '').replaceAll('|', '\\|').replaceAll(/[\r\n]+/g, ' ')

const toMarkdown = (report: ProductionVerificationReport) => [
  `# Production ${report.kind === 'readonly' ? 'read-only' : 'live integration dry-run'} verification`,
  '',
  `- Generated: ${report.generatedAtUtc}`,
  `- Target: ${report.target}`,
  `- Dry run: ${report.dryRun}`,
  `- Summary: ${statuses.map((status) => `${report.summary[status]} ${status}`).join(' / ')}`,
  '',
  '## Safeguards',
  '',
  ...report.safeguards.map((item) => `- ${item}`),
  '',
  '## Checks',
  '',
  '| Status | Category | Test | HTTP | Duration | Actual | Next action |',
  '| --- | --- | --- | ---: | ---: | --- | --- |',
  ...report.checks.map((check) => `| ${check.status} | ${cell(check.category)} | ${cell(check.id)} | ${check.httpStatus ?? ''} | ${check.durationMs} ms | ${cell(check.actual)} | ${cell(check.nextAction)} |`),
  '',
  '## Failures and blocks',
  '',
  ...report.checks
    .filter((check) => check.status !== 'PASS')
    .map((check) => `- **${check.id} — ${check.status}:** ${check.failureReason ?? check.actual}`),
  '',
].join('\n')
