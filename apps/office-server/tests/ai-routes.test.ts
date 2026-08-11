import { generateKeyPairSync } from 'node:crypto'
import { SignJWT, exportJWK } from 'jose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfficeApp } from '../src/app.js'
import { MemorySessionStore } from '../src/store.js'
import type { OfficeConfig } from '../src/types.js'
import type { OfficeLlmConfig } from '../src/ai-config.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

async function mintTokens(opts: {
  clientId: string
  issuer: string
  email: string
  roles: string[]
  nonce?: string
}) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 600
  const access = await new SignJWT({
    azp: opts.clientId,
    email: opts.email,
    realm_access: { roles: opts.roles },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(opts.issuer)
    .setSubject('user-sub')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  const id = await new SignJWT({ email: opts.email, nonce: opts.nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(opts.issuer)
    .setAudience(opts.clientId)
    .setSubject('user-sub')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return { access_token: access, id_token: id, refresh_token: 'refresh-1' }
}

describe('office-server AI routes', () => {
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
  let sessionToken = ''

  beforeEach(async () => {
    store = new MemorySessionStore()
    jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
    fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/protocol/openid-connect/certs')) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
      }
      if (url.includes('/protocol/openid-connect/token')) {
        const pending = (fetchImpl as { __tokens?: Awaited<ReturnType<typeof mintTokens>> }).__tokens
        if (!pending) return new Response('no tokens', { status: 500 })
        return new Response(JSON.stringify(pending), { status: 200 })
      }
      if (url.includes('/protocol/openid-connect/logout')) {
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchImpl)

    // complete a login to get a session token
    const start = await request(app(false)).post('/auth/desktop/start')
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
    await request(app(false)).get(`/auth/desktop/callback?code=abc&state=${state}`)
    const done = await request(app(false)).get(`/auth/desktop/poll?token=${pollToken}`)
    sessionToken = done.body.sessionToken as string
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function app(aiEnabled: boolean) {
    const llm: OfficeLlmConfig = {
      provider: 'anthropic',
      enabled: aiEnabled,
      config: { apiKey: aiEnabled ? 'sk-test' : '', model: 'claude-sonnet-4-6' },
    }
    return createOfficeApp({
      config,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      llm,
    })
  }

  it('rejects AI stream without a suite session', async () => {
    const res = await request(app(true)).post('/ai/stream').send({
      requestId: 'r1',
      system: 'sys',
      messages: [],
    })
    expect(res.status).toBe(401)
  })

  it('returns 503 when LLM is not configured', async () => {
    const res = await request(app(false))
      .post('/ai/stream')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ requestId: 'r1', system: 'sys', messages: [] })
    expect(res.status).toBe(503)
    expect(res.body.errorCode).toBe('ai_disabled')
  })

  it('reports ai status for authenticated sessions', async () => {
    const res = await request(app(true))
      .get('/ai/status')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      authenticated: true,
      aiEnabled: true,
      provider: 'anthropic',
      email: 'office@campass.cm',
    })
  })
})
