import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  evaluateRecipientSafety,
  evaluateSchedulerWorkflow,
} from '../scripts/integration-readiness-core.js'

describe('live integration readiness safety', () => {
  it('keeps recipient verification unverified without an explicit ephemeral allowlist', () => {
    expect(evaluateRecipientSafety(
      undefined,
      ['admin@example.com'],
      ['student@example.com'],
    )).toMatchObject({
      status: 'UNVERIFIED',
      allowlistConfigured: false,
      unapprovedActiveAdminRecipientCount: 1,
      unapprovedActionableOutboxRecipientCount: 1,
    })
  })

  it('passes only when every active Admin and actionable notification is approved', () => {
    expect(evaluateRecipientSafety(
      'student@example.com, ADMIN@example.com',
      ['admin@example.com'],
      ['student@example.com'],
    )).toMatchObject({
      status: 'PASS',
      approvedRecipientCount: 2,
      unapprovedActiveAdminRecipientCount: 0,
      unapprovedActionableOutboxRecipientCount: 0,
    })
  })

  it('fails closed for malformed or incomplete recipient allowlists', () => {
    expect(evaluateRecipientSafety(
      'not-an-email',
      ['admin@example.com'],
      [],
    ).status).toBe('FAIL')
    expect(evaluateRecipientSafety(
      'student@example.com',
      ['admin@example.com'],
      ['student@example.com'],
    )).toMatchObject({
      status: 'FAIL',
      unapprovedActiveAdminRecipientCount: 1,
    })
  })

  it('confirms the scheduler remains manual, opt-in, secret-protected, and HTTPS-only', () => {
    const workflow = readFileSync('.github/workflows/email-notifications.yml', 'utf8')
    expect(evaluateSchedulerWorkflow(workflow)).toEqual({
      status: 'PASS',
      workflowDispatchEnabled: true,
      scheduledExecutionDisabled: true,
      explicitOptInRequired: true,
      cronSecretReadFromGitHubSecrets: true,
      authorizationHeaderNotLogged: true,
      productionHttpsEndpoint: true,
    })
  })
})
