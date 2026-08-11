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

describe('open tickets', () => {
  const issuer = 'https://auth.test/realms/fynix'
  const config: OfficeConfig = {
    baseUrl: 'http://office.test',
    issuer,
    clientId: 'fynix-office',
    clientSecret: 'secret',
    sessionTtlSeconds: 3600,
    desktopTxTtlSeconds: 600,
    port: 4321,
    openServiceKey: 'svc-secret',
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
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchImpl)

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
    sessionToken = done.body.sessionToken as string
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function app() {
    return createOfficeApp({
      config,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  }

  it('service key can mint a ticket; user can download content', async () => {
    const content = Buffer.from('PK\x03\x04fake-docx')
    const mint = await request(app())
      .post('/open/tickets')
      .set('X-Office-Service-Key', 'svc-secret')
      .send({
        source: 'docflow',
        kind: 'docx',
        filename: 'letter.docx',
        title: 'Letter',
        sourceId: 'doc-1',
        contentBase64: content.toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    expect(mint.status).toBe(201)
    expect(mint.body.protocolUrl).toMatch(/^fynixoffice:\/\/open\?ticket=/)
    expect(mint.body.webUrl).toContain('/open?ticket=')

    const ticket = mint.body.ticket as string
    const meta = await request(app())
      .get(`/open/tickets/${ticket}`)
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(meta.status).toBe(200)
    expect(meta.body.kind).toBe('docx')
    expect(meta.body.source).toBe('docflow')

    const file = await request(app())
      .get(`/open/tickets/${ticket}/content`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const data: Buffer[] = []
        res.on('data', (chunk) => data.push(chunk as Buffer))
        res.on('end', () => cb(null, Buffer.concat(data)))
      })
    expect(file.status).toBe(200)
    expect(Buffer.isBuffer(file.body) ? file.body.equals(content) : false).toBe(true)
    expect(file.headers['content-disposition']).toContain('letter.docx')
  })

  it('rejects mint without auth', async () => {
    const res = await request(app()).post('/open/tickets').send({
      kind: 'xlsx',
      filename: 'a.xlsx',
      contentBase64: Buffer.from('x').toString('base64'),
    })
    expect(res.status).toBe(401)
  })

  it('serves HTTPS landing page for a ticket', async () => {
    const mint = await request(app())
      .post('/open/tickets')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({
        source: 'finance',
        kind: 'xlsx',
        filename: 'report.xlsx',
        contentBase64: Buffer.from('sheet').toString('base64'),
      })
    const ticket = mint.body.ticket as string
    const landing = await request(app()).get(`/open?ticket=${ticket}`)
    expect(landing.status).toBe(200)
    expect(landing.text).toContain('fynixoffice://open')
    expect(landing.text).toContain(ticket)
  })
})
