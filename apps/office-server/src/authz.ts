import type { VerifiedIdentity } from './types.js'

/** Keycloak realm role that grants fynixOffice product access (HQ launcher uses the same name). */
export const OFFICE_ACCESS_ROLE = 'fynix-office-access'

export function hasOfficeAccess(roles: readonly string[]): boolean {
  const set = new Set(roles.map((r) => r.toLowerCase()))
  return set.has(OFFICE_ACCESS_ROLE)
}

export function publicSessionFromIdentity(identity: VerifiedIdentity) {
  return {
    authenticated: true as const,
    email: identity.email,
    subject: identity.subject,
    roles: identity.roles,
    hasOfficeAccess: hasOfficeAccess(identity.roles),
  }
}
