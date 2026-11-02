import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../.github/workflows/email-notifications.yml', import.meta.url),
  'utf8',
)

describe('disabled email notification scheduler workflow', () => {
  it('has only a manual active trigger and keeps the intended schedule commented', () => {
    expect(workflow).toMatch(/^on:\r?\n {2}workflow_dispatch:\r?$/m)
    expect(workflow).toContain("#   - cron: '*/10 * * * *'")
    expect(workflow).not.toMatch(/^ {2}schedule:/m)
  })

  it('requires an exact opt-in variable before the dispatch job can run', () => {
    expect(workflow).toContain("if: ${{ vars.EMAIL_DISPATCH_ENABLED == 'true' }}")
    expect(workflow).toContain("if: ${{ vars.EMAIL_DISPATCH_ENABLED != 'true' }}")
  })

  it('uses the GitHub secret without hardcoding or logging authorization data', () => {
    expect(workflow).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}')
    expect(workflow).toContain('if [[ -z "${CRON_SECRET:-}" ]]')
    expect(workflow).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/)
    expect(workflow).not.toContain('set -x')
  })

  it('uses HTTPS, minimal permissions, concurrency, timeouts, and explicit HTTP failure handling', () => {
    expect(workflow).toContain('permissions: {}')
    expect(workflow).not.toContain('uses:')
    expect(workflow).toContain('group: email-notification-dispatch')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('https://api.tareeq-academy.com/internal/cron/email-notifications')
    expect(workflow).toContain("--proto '=https'")
    expect(workflow).toContain('--connect-timeout 10')
    expect(workflow).toContain('--max-time 45')
    expect(workflow).toContain('timeout-minutes: 2')
    expect(workflow).toContain('if [[ ! "${http_status}" =~ ^2[0-9][0-9]$ ]]')
  })
})
