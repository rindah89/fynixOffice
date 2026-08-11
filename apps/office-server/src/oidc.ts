import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { DesktopAuthTransaction, OfficeConfig, VerifiedIdentity } from './types.js'

const urlSafe = (input: Buffer) => input.toString('base64url')

export function createDesktopTransaction(): Omit<DesktopAuthTransaction, 'status'> {
  return {
    state: urlSafe(randomBytes(24)),
    nonce: urlSafe(randomBytes(24)),
    verifier: urlSafe(randomBytes(48)),
    pollToken: urlSafe(randomBytes(32)),
  }
}

export function desktopCallbackUrl(config: OfficeConfig): string {
  return `${config.baseUrl}/auth/desktop/callback`
}

export function authorizationUrl(config: OfficeConfig, tx: Pick<DesktopAuthTransaction, 'state' | 'nonce' | 'verifier'>): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: desktopCallbackUrl(config),
    response_type: 'code',
    scope: 'openid profile email',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: createHash('sha256').update(tx.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  })
  return `${config.issuer}/protocol/openid-connect/auth?${params}`
}

export async function exchangeAndVerify(
  config: OfficeConfig,
  code: string,
  tx: Pick<DesktopAuthTransaction, 'verifier' | 'nonce'>,
  fetchImpl: typeof fetch,
): Promise<{ identity: VerifiedIdentity; refreshToken?: string; idToken?: string }> {
  const response = await fetchImpl(`${config.issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: desktopCallbackUrl(config),
      code_verifier: tx.verifier,
    }),
  })
  if (!response.ok) throw new Error('OIDC token exchange failed')
  const tokens = (await response.json()) as {
    access_token: string
    refresh_token?: string
    id_token?: string
  }
  const identity = await verifyTokenPair(config, tokens, tx.nonce)
  return { identity, refreshToken: tokens.refresh_token, idToken: tokens.id_token }
}

async function verifyTokenPair(
  config: OfficeConfig,
  tokens: { access_token: string; id_token?: string },
  expectedNonce?: string,
): Promise<VerifiedIdentity> {
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/protocol/openid-connect/certs`))
  const { payload: access } = await jwtVerify(tokens.access_token, jwks, { issuer: config.issuer })
  if (access.azp !== config.clientId) throw new Error('OIDC access token was issued to another client')
  const { payload: identityClaims } = tokens.id_token
    ? await jwtVerify(tokens.id_token, jwks, { issuer: config.issuer, audience: config.clientId })
    : { payload: access }
  if (expectedNonce && identityClaims.nonce !== expectedNonce) throw new Error('OIDC nonce mismatch')
  const realm = access.realm_access as { roles?: unknown } | undefined
  const identity: VerifiedIdentity = {
    subject: String(identityClaims.sub || ''),
    email: String(
      identityClaims.email ||
        identityClaims.preferred_username ||
        access.email ||
        access.preferred_username ||
        '',
    ),
    expiresAt: Number(access.exp || 0),
    roles: Array.isArray(realm?.roles) ? realm.roles.map(String) : [],
  }
  if (!identity.subject || !identity.email || !identity.expiresAt) {
    throw new Error('OIDC identity is incomplete')
  }
  return identity
}

export async function refreshAndVerify(
  config: OfficeConfig,
  refreshToken: string,
  fetchImpl: typeof fetch,
): Promise<{ identity: VerifiedIdentity; refreshToken: string; idToken?: string }> {
  const response = await fetchImpl(`${config.issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  })
  if (!response.ok) throw new Error('OIDC session refresh failed')
  const tokens = (await response.json()) as {
    access_token: string
    refresh_token?: string
    id_token?: string
  }
  const identity = await verifyTokenPair(config, tokens)
  return {
    identity,
    refreshToken: tokens.refresh_token || refreshToken,
    idToken: tokens.id_token,
  }
}

export async function revokeRefreshToken(
  config: OfficeConfig,
  refreshToken: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  await fetchImpl(`${config.issuer}/protocol/openid-connect/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  }).catch(() => undefined)
}

export function opaqueId(): string {
  return randomBytes(32).toString('base64url')
}
