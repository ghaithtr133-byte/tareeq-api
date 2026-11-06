import { readFile } from 'node:fs/promises'

import { getCloudinaryConfig, getEmailConfig } from '../src/config/env.js'
import { getPrisma } from '../src/database/client.js'
import { evaluateRecipientSafety, evaluateSchedulerWorkflow } from './integration-readiness-core.js'
import { VerificationReporter, outcomeExitCode } from './production-verification-core.js'

const args = new Set(process.argv.slice(2))
const baseUrl = (process.env.PRODUCTION_API_BASE_URL ?? 'https://api.tareeq-academy.com').replace(/\/$/, '')
const wantsCloudinary = args.has('--cloudinary')
const wantsResend = args.has('--resend')
const wantsBrowser = args.has('--browser')
const requestedExecution = args.has('--execute-live')
const confirmation = process.env.LIVE_INTEGRATION_CONFIRMATION === 'TAREEQ_LIVE_TEST_APPROVED'
const productionTarget = baseUrl === 'https://api.tareeq-academy.com'
const reporter = new VerificationReporter('live', baseUrl, !requestedExecution, [
  'Default mode is a non-mutating dry-run. This runner does not create submissions, upload media, dispatch mail, or use Admin credentials unless --execute-live and every independent environment gate are present.',
  'No generic force switch exists. Cloudinary and Resend need separate CLI selections and environment gates.',
  'A legitimate owner-established Admin cookie is required for an actual Admin route; the runner never automates login and never writes cookies or tokens to reports.',
])

const addGate = (id: string, selected: boolean, requirement: string, present: boolean, nextAction: string) => {
  reporter.add({
    id,
    category: 'Live safety gate',
    description: requirement,
    environment: 'production dry-run',
    status: !selected ? 'SKIPPED' : present ? 'PASS' : 'BLOCKED',
    expected: requirement,
    actual: !selected ? 'Scenario not selected.' : present ? 'Gate present.' : 'Gate missing.',
    nextAction: !selected || present ? undefined : nextAction,
  })
}

reporter.add({
  id: 'live.execution_mode',
  category: 'Live safety gate',
  description: 'Execution requires explicit, independent owner confirmation.',
  environment: 'production dry-run',
  status: requestedExecution && confirmation ? 'PASS' : 'BLOCKED',
  expected: '--execute-live plus LIVE_INTEGRATION_CONFIRMATION=TAREEQ_LIVE_TEST_APPROVED.',
  actual: requestedExecution ? 'Execution requested but confirmation is absent or invalid.' : 'Dry-run mode; no mutation can occur.',
  nextAction: requestedExecution && confirmation ? undefined : 'Obtain separate written authorization before setting the ephemeral confirmation only in the execution shell.',
})
addGate('live.production_target', wantsCloudinary || wantsResend || wantsBrowser, 'Target must be the verified production API origin.', productionTarget, 'Set only PRODUCTION_API_BASE_URL=https://api.tareeq-academy.com for an approved run.')
addGate('live.admin_context', wantsCloudinary || wantsBrowser, 'Owner-established Admin cookie must be supplied only to an authorized execution shell.', Boolean(process.env.LIVE_INTEGRATION_ADMIN_COOKIE?.trim()), 'The owner must establish a legitimate Admin session; do not automate credential submission.')
addGate('live.recipient_allowlist', wantsResend, 'Approved student and every active Admin/outbox recipient must be allowlisted.', Boolean(process.env.LIVE_INTEGRATION_APPROVED_RECIPIENTS?.trim()), 'Set an ephemeral comma-separated allowlist after separately approving every recipient.')
addGate('live.student_test_inbox', wantsResend, 'A controlled student test inbox must be explicitly supplied.', Boolean(process.env.LIVE_INTEGRATION_TEST_EMAIL?.trim()), 'Set LIVE_INTEGRATION_TEST_EMAIL only to an approved controlled inbox.')
addGate('live.cloudinary_opt_in', wantsCloudinary, 'Cloudinary mutation requires an independent opt-in.', process.env.LIVE_INTEGRATION_ENABLE_CLOUDINARY === 'true', 'Set LIVE_INTEGRATION_ENABLE_CLOUDINARY=true only after the disposable asset and manual cleanup owner are approved.')
addGate('live.resend_opt_in', wantsResend, 'Resend/submission mutation requires an independent opt-in.', process.env.LIVE_INTEGRATION_ENABLE_RESEND === 'true', 'Set LIVE_INTEGRATION_ENABLE_RESEND=true only after recipient and retention approval.')

// This is the same local/Neon read-only readiness evidence used by integrations:preflight.
// It deliberately does not instantiate a provider request or dispatch any queued notification.
const prisma = getPrisma()
const cloudinary = getCloudinaryConfig()
const email = getEmailConfig()
const workflow = await readFile('.github/workflows/email-notifications.yml', 'utf8')
const scheduler = evaluateSchedulerWorkflow(workflow)
reporter.add({
  id: 'readiness.cloudinary_configuration',
  category: 'Cloudinary readiness',
  description: 'Server-only Cloudinary configuration has the supported upload contract without a provider call.',
  environment: 'local configuration',
  status: cloudinary.status === 'CONFIGURED' ? 'PASS' : 'BLOCKED',
  expected: 'Configured server-side provider with 4,000,000-byte image and 4,100,000-byte multipart limits.',
  actual: `Configuration=${cloudinary.status}; provider calls=0; backend deletion API=false.`,
  nextAction: cloudinary.status === 'CONFIGURED' ? undefined : 'Configure the provider server-side before separately authorizing a disposable upload.',
})
reporter.add({
  id: 'readiness.scheduler_controls',
  category: 'Resend readiness',
  description: 'GitHub dispatcher workflow remains manual, opt-in, secret-protected, and HTTPS-only.',
  environment: 'repository workflow',
  status: scheduler.status,
  expected: 'Manual dispatch only with explicit variable gate and secret-protected HTTPS request.',
  actual: `manual=${scheduler.workflowDispatchEnabled}; scheduleDisabled=${scheduler.scheduledExecutionDisabled}; optIn=${scheduler.explicitOptInRequired}; secret=${scheduler.cronSecretReadFromGitHubSecrets}.`,
  nextAction: scheduler.status === 'PASS' ? undefined : 'Restore the reviewed scheduler safety controls before live email testing.',
})
try {
  const [activeAdmins, actionableNotifications, outboxGroups] = await Promise.all([
    prisma.adminUser.findMany({
      where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { email: true },
    }),
    prisma.emailNotification.findMany({
      where: { state: { in: ['PENDING', 'PROCESSING'] } },
      select: { recipient: true },
    }),
    prisma.emailNotification.groupBy({ by: ['state'], _count: { _all: true } }),
  ])
  const recipientSafety = evaluateRecipientSafety(
    process.env.LIVE_INTEGRATION_APPROVED_RECIPIENTS,
    activeAdmins.map(({ email: recipient }) => recipient),
    actionableNotifications.map(({ recipient }) => recipient),
  )
  reporter.add({
    id: 'readiness.resend_configuration_and_recipients',
    category: 'Resend readiness',
    description: 'Resend configuration, active recipient count, actionable outbox, and allowlist gate are assessed without dispatch.',
    environment: 'local configuration + Neon read-only',
    status: email.status === 'CONFIGURED' && recipientSafety.status === 'PASS' ? 'PASS' : recipientSafety.status === 'FAIL' || email.status !== 'CONFIGURED' ? 'BLOCKED' : 'UNVERIFIED',
    expected: 'Configured provider and every active/outbox recipient on an ephemeral approved allowlist.',
    actual: `Configuration=${email.status}; active Admin recipients=${activeAdmins.length}; actionable outbox recipients=${actionableNotifications.length}; outbox states=${JSON.stringify(Object.fromEntries(outboxGroups.map(({ state, _count }) => [state, _count._all])))}; allowlist=${recipientSafety.status}.`,
    nextAction: recipientSafety.status === 'PASS' ? undefined : 'After separate approval, set a shell-only allowlist containing the controlled student and every active/outbox recipient, then rerun.',
  })
} catch (error) {
  reporter.add({
    id: 'readiness.resend_recipient_safety',
    category: 'Resend readiness',
    description: 'Read-only active-recipient and actionable-outbox assessment completes.',
    environment: 'local configuration + Neon read-only',
    status: 'BLOCKED',
    expected: 'A read-only preflight result without provider calls.',
    actual: `Resend configuration=${email.status}; the database-backed recipient/outbox read could not complete.`,
    failureReason: error instanceof Error ? error.name : 'UnknownError',
    nextAction: 'Inspect local configuration and approved Neon connectivity without disclosing secrets.',
  })
} finally {
  await prisma.$disconnect()
}

for (const [id, description, selected] of [
  ['cloudinary.disposable_upload', 'One <100 KB JPEG/PNG/WebP upload to resource=articles; validate HTTP 201, HTTPS URL, metadata, and owner-only manual cleanup by exact public ID.', wantsCloudinary],
  ['resend.application_and_inquiry', 'One clearly labelled application and one inquiry; verify expected outbox intent, idempotency keys, controlled dispatch, provider acceptance, and recipient inbox delivery.', wantsResend],
  ['browser.authenticated_session', 'Owner interactive login, refresh persistence, authenticated GET coverage, logout, and invalidation.', wantsBrowser],
  ['postgres.disposable_branch', 'The 19 database-gated tests require a separately authorized disposable Neon branch, never main or backup.', true],
] as const) {
  reporter.add({
    id,
    category: 'Planned live scenario',
    description,
    environment: 'production dry-run',
    status: selected ? 'BLOCKED' : 'SKIPPED',
    expected: selected ? 'Separate owner authorization and every scenario gate.' : 'Scenario was not requested.',
    actual: selected ? 'Prepared only; no network request or mutation was executed.' : 'Not selected.',
    nextAction: selected ? 'Review the generated plan, authorize this scenario separately, then run from a controlled shell.' : undefined,
  })
}

const written = await reporter.write()
console.log(`Production live dry-run report: ${written.jsonPath}`)
console.log(`Production live dry-run summary: ${JSON.stringify(written.report.summary)}`)
// Dry-runs intentionally return success even when scenarios are blocked for missing live authorization.
process.exitCode = requestedExecution ? outcomeExitCode(written.report.checks) : 0
