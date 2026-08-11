import { generateKeyPairSync } from 'node:crypto'
import { SignJWT, exportJWK } from 'jose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfficeApp } from '../src/app.js'
import { MemorySessionStore } from '../src/store.js'
import type { OfficeConfig } from '../src/types.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

async function mintTokens(opts: {
  clientId: string
  issuer: string
  email: string
  roles: string[]
  nonce?: string
  expSeconds?: number
}) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (opts.expSeconds ?? 600)
  const access = await new SignJWT({
    azp: opts.clientId,
    email: opts.email,
    preferred_username: opts.email,
    realm_access: { roles: opts.roles },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(opts.issuer)
    .setSubject('user-sub')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  const id = await new SignJWT({
    email: opts.email,
    preferred_username: opts.email,
    nonce: opts.nonce,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(opts.issuer)
    .setAudience(opts.clientId)
    .setSubject('user-sub')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return { access_token: access, id_token: id, refresh_token: 'refresh-1', exp }
}

describe('office-server desktop auth', () => {
  const issuer = 'https://auth.test/realms/fynix'
  const config: OfficeConfig = {
    baseUrl: 'http://office.test',
    issuer,
    clientId: 'fynix-office',
    clientSecret: 'secret',
    sessionTtlSeconds: 3600,
    desktopTxTtlSeconds: 600,
    port: 4321,
    openServiceKey: 'test-service-key',
  }

  let store: MemorySessionStore
  let fetchImpl: ReturnType<typeof vi.fn>
  let jwk: Record<string, unknown>

  beforeEach(async () => {
    store = new MemorySessionStore()
    jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
    fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/protocol/openid-connect/certs')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/protocol/openid-connect/token') && init?.method === 'POST') {
        const pending = (fetchImpl as { __tokens?: Awaited<ReturnType<typeof mintTokens>> }).__tokens
        if (!pending) return new Response('no tokens', { status: 500 })
        return new Response(JSON.stringify(pending), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/protocol/openid-connect/logout')) {
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })
    // jose JWKS client uses global fetch; route it through the same mock as OIDC token calls
    vi.stubGlobal('fetch', fetchImpl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function app() {
    return createOfficeApp({ config, store, fetchImpl: fetchImpl as unknown as typeof fetch })
  }

  it('starts a desktop login and returns authorization URL + poll token', async () => {
    const res = await request(app()).post('/auth/desktop/start')
    expect(res.status).toBe(200)
    expect(res.body.pollToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(res.body.authorizationUrl).toContain(issuer)
    expect(res.body.authorizationUrl).toContain('code_challenge')
    expect(res.body.authorizationUrl).toContain(encodeURIComponent(`${config.baseUrl}/auth/desktop/callback`))
    expect(res.body.expiresIn).toBe(600)
  })

  it('polls pending until callback completes, then hands out a session once', async () => {
    const start = await request(app()).post('/auth/desktop/start')
    const pollToken = start.body.pollToken as string
    const authUrl = new URL(start.body.authorizationUrl as string)
    const state = authUrl.searchParams.get('state')!
    const nonce = authUrl.searchParams.get('nonce')!

    const pending = await request(app()).get(`/auth/desktop/poll?token=${pollToken}`)
    expect(pending.status).toBe(202)
    expect(pending.body.status).toBe('pending')

    const tokens = await mintTokens({
      clientId: config.clientId,
      issuer,
      email: 'office@campass.cm',
      roles: ['fynix-office-access'],
      nonce,
    })
    ;(fetchImpl as { __tokens?: typeof tokens }).__tokens = tokens

    const cb = await request(app()).get(`/auth/desktop/callback?code=abc&state=${state}`)
    expect(cb.status).toBe(200)
    expect(cb.text).toContain('Signed in to fynixOffice')

    const done = await request(app()).get(`/auth/desktop/poll?token=${pollToken}`)
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('complete')
    expect(done.body.email).toBe('office@campass.cm')
    expect(done.body.sessionToken).toBeTruthy()

    const replay = await request(app()).get(`/auth/desktop/poll?token=${pollToken}`)
    expect(replay.status).toBe(410)

    const session = await request(app())
      .get('/auth/session')
      .set('Authorization', `Bearer ${done.body.sessionToken}`)
    expect(session.status).toBe(200)
    expect(session.body).toMatchObject({
      authenticated: true,
      email: 'office@campass.cm',
      hasOfficeAccess: true,
    })
  })

  it('denies users without fynix-office-access', async () => {
    const start = await request(app()).post('/auth/desktop/start')
    const pollToken = start.body.pollToken as string
    const authUrl = new URL(start.body.authorizationUrl as string)
    const state = authUrl.searchParams.get('state')!
    const nonce = authUrl.searchParams.get('nonce')!

    const tokens = await mintTokens({
      clientId: config.clientId,
      issuer,
      email: 'nope@campass.cm',
      roles: ['fynix-ppm-access'],
      nonce,
    })
    ;(fetchImpl as { __tokens?: typeof tokens }).__tokens = tokens

    const cb = await request(app()).get(`/auth/desktop/callback?code=abc&state=${state}`)
    expect(cb.status).toBe(403)
    expect(cb.text).toContain('fynix-office-access')

    const poll = await request(app()).get(`/auth/desktop/poll?token=${pollToken}`)
    expect(poll.status).toBe(403)
    expect(poll.body.status).toBe('denied')
  })

  it('rejects invalid callback state', async () => {
    const res = await request(app()).get('/auth/desktop/callback?code=x&state=missing')
    expect(res.status).toBe(401)
  })

  it('logs out and invalidates the session', async () => {
    const start = await request(app()).post('/auth/desktop/start')
    const pollToken = start.body.pollToken as string
    const authUrl = new URL(start.body.authorizationUrl as string)
    const state = authUrl.searchParams.get('state')!
    const nonce = authUrl.searchParams.get('nonce')!
    const tokens = await mintTokens({
      clientId: config.clientId,
      issuer,
      email: 'office@campass.cm',
      roles: ['fynix-office-access'],
      nonce,
    })
    ;(fetchImpl as { __tokens?: typeof tokens }).__tokens = tokens
    await request(app()).get(`/auth/desktop/callback?code=abc&state=${state}`)
    const done = await request(app()).get(`/auth/desktop/poll?token=${pollToken}`)
    const token = done.body.sessionToken as string

    const logout = await request(app()).post('/auth/logout').set('Authorization', `Bearer ${token}`)
    expect(logout.status).toBe(204)

    const session = await request(app()).get('/auth/session').set('Authorization', `Bearer ${token}`)
    expect(session.status).toBe(401)
  })

  it('returns unauthenticated without a bearer token', async () => {
    const res = await request(app()).get('/auth/session')
    expect(res.status).toBe(401)
    expect(res.body.authenticated).toBe(false)
  })
})

