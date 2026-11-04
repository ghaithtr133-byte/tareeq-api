import { z } from 'zod'

export type ReadinessStatus = 'PASS' | 'FAIL' | 'UNVERIFIED'

export type RecipientSafety = {
  status: ReadinessStatus
  allowlistConfigured: boolean
  approvedRecipientCount: number
  activeAdminRecipientCount: number
  actionableOutboxRecipientCount: number
  unapprovedActiveAdminRecipientCount: number
  unapprovedActionableOutboxRecipientCount: number
}

const email = z.email()

const uniqueNormalized = (values: string[]) => [...new Set(
  values.map((value) => value.trim().toLowerCase()).filter(Boolean),
)]

export const evaluateRecipientSafety = (
  configuredRecipients: string | undefined,
  activeAdminRecipients: string[],
  actionableOutboxRecipients: string[],
): RecipientSafety => {
  const admins = uniqueNormalized(activeAdminRecipients)
  const actionable = uniqueNormalized(actionableOutboxRecipients)
  if (!configuredRecipients?.trim()) {
    return {
      status: 'UNVERIFIED',
      allowlistConfigured: false,
      approvedRecipientCount: 0,
      activeAdminRecipientCount: admins.length,
      actionableOutboxRecipientCount: actionable.length,
      unapprovedActiveAdminRecipientCount: admins.length,
      unapprovedActionableOutboxRecipientCount: actionable.length,
    }
  }

  const approved = uniqueNormalized(configuredRecipients.split(','))
  if (approved.length === 0 || approved.some((recipient) => !email.safeParse(recipient).success)) {
    return {
      status: 'FAIL',
      allowlistConfigured: true,
      approvedRecipientCount: approved.length,
      activeAdminRecipientCount: admins.length,
      actionableOutboxRecipientCount: actionable.length,
      unapprovedActiveAdminRecipientCount: admins.length,
      unapprovedActionableOutboxRecipientCount: actionable.length,
    }
  }

  const approvedSet = new Set(approved)
  const unapprovedAdmins = admins.filter((recipient) => !approvedSet.has(recipient))
  const unapprovedActionable = actionable.filter((recipient) => !approvedSet.has(recipient))
  return {
    status: unapprovedAdmins.length === 0 && unapprovedActionable.length === 0
      ? 'PASS'
      : 'FAIL',
    allowlistConfigured: true,
    approvedRecipientCount: approved.length,
    activeAdminRecipientCount: admins.length,
    actionableOutboxRecipientCount: actionable.length,
    unapprovedActiveAdminRecipientCount: unapprovedAdmins.length,
    unapprovedActionableOutboxRecipientCount: unapprovedActionable.length,
  }
}

export type SchedulerSafety = {
  status: 'PASS' | 'FAIL'
  workflowDispatchEnabled: boolean
  scheduledExecutionDisabled: boolean
  explicitOptInRequired: boolean
  cronSecretReadFromGitHubSecrets: boolean
  authorizationHeaderNotLogged: boolean
  productionHttpsEndpoint: boolean
}

export const evaluateSchedulerWorkflow = (workflow: string): SchedulerSafety => {
  const workflowDispatchEnabled = /^on:\r?\n {2}workflow_dispatch:\r?$/m.test(workflow)
  const scheduledExecutionDisabled = !/^ {2}schedule:/m.test(workflow) &&
    workflow.includes("#   - cron: '*/10 * * * *'")
  const explicitOptInRequired = workflow.includes(
    "if: ${{ vars.EMAIL_DISPATCH_ENABLED == 'true' }}",
  ) && workflow.includes(
    "if: ${{ vars.EMAIL_DISPATCH_ENABLED != 'true' }}",
  )
  const cronSecretReadFromGitHubSecrets = workflow.includes(
    'CRON_SECRET: ${{ secrets.CRON_SECRET }}',
  )
  const authorizationHeaderNotLogged = workflow.includes(
    '--header "Authorization: Bearer ${CRON_SECRET}"',
  ) && !workflow.includes('set -x')
  const productionHttpsEndpoint = workflow.includes(
    'https://api.tareeq-academy.com/internal/cron/email-notifications',
  ) && workflow.includes("--proto '=https'")
  const checks = [
    workflowDispatchEnabled,
    scheduledExecutionDisabled,
    explicitOptInRequired,
    cronSecretReadFromGitHubSecrets,
    authorizationHeaderNotLogged,
    productionHttpsEndpoint,
  ]
  return {
    status: checks.every(Boolean) ? 'PASS' : 'FAIL',
    workflowDispatchEnabled,
    scheduledExecutionDisabled,
    explicitOptInRequired,
    cronSecretReadFromGitHubSecrets,
    authorizationHeaderNotLogged,
    productionHttpsEndpoint,
  }
}
