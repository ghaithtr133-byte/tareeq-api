import { readFile } from 'node:fs/promises'

import { getCloudinaryConfig, getEmailConfig } from '../src/config/env.js'
import { getPrisma } from '../src/database/client.js'
import {
  evaluateRecipientSafety,
  evaluateSchedulerWorkflow,
} from './integration-readiness-core.js'

const command = process.argv[2]
if (command !== 'preflight') {
  console.error(
    'BLOCKED — Use only `preflight`. This tool never uploads an asset, sends an email, dispatches the outbox, or changes database records.',
  )
  process.exitCode = 1
} else {
  const prisma = getPrisma()
  try {
    const cloudinary = getCloudinaryConfig()
    const email = getEmailConfig()
    const workflow = await readFile('.github/workflows/email-notifications.yml', 'utf8')
    const scheduler = evaluateSchedulerWorkflow(workflow)
    const [activeAdmins, actionableNotifications, outboxGroups] = await Promise.all([
      prisma.adminUser.findMany({
        where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { email: true },
      }),
      prisma.emailNotification.findMany({
        where: { state: { in: ['PENDING', 'PROCESSING'] } },
        select: { recipient: true },
      }),
      prisma.emailNotification.groupBy({
        by: ['state'],
        _count: { _all: true },
      }),
    ])
    const recipientSafety = evaluateRecipientSafety(
      process.env.LIVE_INTEGRATION_APPROVED_RECIPIENTS,
      activeAdmins.map(({ email: recipient }) => recipient),
      actionableNotifications.map(({ recipient }) => recipient),
    )
    const cloudinaryStatus = cloudinary.status === 'CONFIGURED' ? 'PASS' : 'FAIL'
    const resendConfigurationStatus = email.status === 'CONFIGURED' ? 'PASS' : 'FAIL'
    const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim())
    const resendStatus = resendConfigurationStatus === 'PASS' &&
      cronSecretConfigured && scheduler.status === 'PASS'
      ? 'PASS'
      : 'FAIL'

    console.log(JSON.stringify({
      mode: 'READ_ONLY_PREFLIGHT',
      providerCallsMade: false,
      databaseWritesMade: false,
      cloudinary: {
        status: cloudinaryStatus,
        configurationStatus: cloudinary.status,
        folderConfigured: cloudinary.folder.length > 0,
        supportedFormats: ['jpg', 'png', 'webp'],
        maximumImageBytes: 4_000_000,
        maximumMultipartBytes: 4_100_000,
        backendAssetDeletionSupported: false,
      },
      resend: {
        status: resendStatus,
        configurationStatus: email.status,
        cronSecretConfigured,
        activeAdminRecipientCount: activeAdmins.length,
        outboxByState: Object.fromEntries(
          outboxGroups.map(({ state, _count }) => [state, _count._all]),
        ),
        recipientSafety,
      },
      scheduler,
      liveVerification: {
        status: recipientSafety.status === 'PASS' ? 'READY' : 'UNVERIFIED',
        reason: recipientSafety.status === 'PASS'
          ? 'Every active Admin and currently actionable outbox recipient is in the ephemeral approved-recipient allowlist.'
          : 'Set LIVE_INTEGRATION_APPROVED_RECIPIENTS in the current shell to the explicitly approved test recipient plus every active Admin recipient, then rerun preflight.',
      },
    }, null, 2))

    if (
      cloudinaryStatus === 'FAIL' ||
      resendStatus === 'FAIL' ||
      recipientSafety.status === 'FAIL'
    ) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(
      `Integration readiness preflight failed safely (${error instanceof Error ? error.name : 'UnknownError'}). No provider call or database write was attempted.`,
    )
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}
