import { describe, expect, it } from 'vitest'
import { hasOfficeAccess, publicSessionFromIdentity } from '../src/authz.js'

describe('office access roles', () => {
  it('requires fynix-office-access (case-insensitive)', () => {
    expect(hasOfficeAccess(['Manager'])).toBe(false)
    expect(hasOfficeAccess(['fynix-office-access'])).toBe(true)
    expect(hasOfficeAccess(['Fynix-Office-Access', 'CFO'])).toBe(true)
  })

  it('exposes public session without tokens', () => {
    expect(
      publicSessionFromIdentity({
        subject: 'sub-1',
        email: 'user@campass.cm',
        expiresAt: 99,
        roles: ['fynix-office-access', 'Analyst'],
      }),
    ).toEqual({
      authenticated: true,
      email: 'user@campass.cm',
      subject: 'sub-1',
      roles: ['fynix-office-access', 'Analyst'],
      hasOfficeAccess: true,
    })
  })
})
