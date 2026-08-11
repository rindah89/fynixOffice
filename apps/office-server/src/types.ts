/** Suite product identity after Keycloak verification (tokens stay server-side). */
export interface VerifiedIdentity {
  subject: string
  email: string
  /** access-token exp (unix seconds) */
  expiresAt: number
  roles: string[]
}

/** Opaque session value stored under session:{id}. */
export interface OfficeSession {
  identity: VerifiedIdentity
  keycloakRefreshToken?: string
  idToken?: string
}

/** PKCE + desktop poll transaction. */
export interface DesktopAuthTransaction {
  state: string
  nonce: string
  verifier: string
  pollToken: string
  /** Set when callback succeeds; opaque session id handed to the desktop once. */
  sessionId?: string
  /** Denial reason when IdP succeeded but entitlement failed. */
  denyReason?: 'no_entitlement' | 'identity_incomplete'
  status: 'pending' | 'complete' | 'denied' | 'error'
  errorMessage?: string
}

export interface OfficeConfig {
  baseUrl: string
  issuer: string
  clientId: string
  clientSecret: string
  sessionTtlSeconds: number
  desktopTxTtlSeconds: number
  port: number
  /** Shared secret for suite products to mint open tickets. */
  openServiceKey: string
}
