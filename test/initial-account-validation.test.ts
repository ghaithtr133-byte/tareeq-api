import { describe, expect, it } from 'vitest'

import {
  initialAccountPasswordSchema,
  initialAccountsSchema,
} from '../scripts/initial-account-validation.js'

describe('initial Admin account validation', () => {
  it('accepts 9-128 characters with English lowercase and uppercase letters', () => {
    expect(initialAccountPasswordSchema.parse('Abcdefghi')).toBe('Abcdefghi')
    expect(initialAccountPasswordSchema.parse('Abcdefgh!')).toBe('Abcdefgh!')
    expect(
      initialAccountPasswordSchema.parse(`A${'a'.repeat(127)}`),
    ).toHaveLength(128)
  })

  it('does not require a number or special character', () => {
    expect(initialAccountPasswordSchema.safeParse('Onlyletters').success).toBe(true)
  })

  it.each([
    [
      'Abcdefgh',
      'Initial account password must contain at least 9 characters.',
    ],
    [
      `A${'a'.repeat(128)}`,
      'Initial account password must contain at most 128 characters.',
    ],
    [
      'ABCDEFGHI',
      'Initial account password must contain a lowercase English letter.',
    ],
    [
      'abcdefghi',
      'Initial account password must contain an uppercase English letter.',
    ],
  ])('rejects invalid password policy input without exposing it', (password, message) => {
    const result = initialAccountPasswordSchema.safeParse(password)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(message)
    }
  })

  it('applies the provisioning-only password policy to both roles', () => {
    const result = initialAccountsSchema.safeParse({
      INITIAL_ADMIN_NAME: 'Admin',
      INITIAL_ADMIN_EMAIL: 'admin@example.com',
      INITIAL_ADMIN_PASSWORD: 'Abcdefghi',
      INITIAL_SUPER_ADMIN_NAME: 'Super Admin',
      INITIAL_SUPER_ADMIN_EMAIL: 'super-admin@example.com',
      INITIAL_SUPER_ADMIN_PASSWORD: 'Zyxwvutsr',
    })
    expect(result.success).toBe(true)
  })
})
