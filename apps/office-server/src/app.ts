import express, { type Request, type Response } from 'express'
import { loadLlmConfig, type OfficeLlmConfig } from './ai-config.js'
import { registerAiRoutes } from './ai-routes.js'
import { hasOfficeAccess, publicSessionFromIdentity } from './authz.js'
import { registerOpenRoutes } from './open-routes.js'
import {
  authorizationUrl,
  createDesktopTransaction,
  exchangeAndVerify,
  opaqueId,
  refreshAndVerify,
  revokeRefreshToken,
} from './oidc.js'
import type { SessionStore } from './store.js'
import type { DesktopAuthTransaction, OfficeConfig, OfficeSession } from './types.js'

export interface OfficeAppDeps {
  config: OfficeConfig
  store: SessionStore
  fetchImpl?: typeof fetch
  llm?: OfficeLlmConfig
}

const HTML_SUCCESS = `<!doctype html><html><head><meta charset="utf-8"><title>fynixOffice</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
h1{font-size:1.25rem}p{color:#444}</style></head>
<body><h1>Signed in to fynixOffice</h1>
<p>You can close this window and return to the desktop app.</p></body></html>`

const HTML_DENIED = `<!doctype html><html><head><meta charset="utf-8"><title>fynixOffice</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
h1{font-size:1.25rem}p{color:#444}</style></head>
<body><h1>Access not assigned</h1>
<p>Your Fynix account is valid, but it does not include fynixOffice.
Ask your administrator to grant the <code>fynix-office-access</code> role.</p></body></html>`

const HTML_ERROR = `<!doctype html><html><head><meta charset="utf-8"><title>fynixOffice</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
h1{font-size:1.25rem}p{color:#444}</style></head>
<body><h1>Sign-in could not be completed</h1>
<p>Close this window and try again from the desktop app.</p></body></html>`

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

async function sessionFor(
  request: Request,
  store: SessionStore,
  config: OfficeConfig,
  fetchImpl: typeof fetch,
): Promise<{ id: string; value: OfficeSession } | null> {
  const id = bearerToken(request)
  if (!id) return null
  const value = await store.get<OfficeSession>(`session:${id}`)
  if (!value) return null
  if (value.identity.expiresAt <= Date.now() / 1000 + 30) {
    if (!value.keycloakRefreshToken) {
      await store.delete(`session:${id}`)
      return null
    }
    try {
      const refreshed = await refreshAndVerify(config, value.keycloakRefreshToken, fetchImpl)
      if (refreshed.identity.subject !== value.identity.subject) {
        throw new Error('OIDC subject changed during refresh')
      }
      value.identity = refreshed.identity
      value.keycloakRefreshToken = refreshed.refreshToken
      value.idToken = refreshed.idToken || value.idToken
      await store.set(`session:${id}`, value, config.sessionTtlSeconds)
    } catch {
      await store.delete(`session:${id}`)
      return null
    }
  }
  return { id, value }
}

export function createOfficeApp({ config, store, fetchImpl = fetch, llm }: OfficeAppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '4mb' }))

  const llmConfig = llm ?? loadLlmConfig()

  app.get('/healthz', (_req, res) =>
    res.json({ status: 'ok', service: 'fynixoffice', aiEnabled: llmConfig.enabled }),
  )

  /** Minimal landing for HQ suite launcher when no desktop deep-link is available. */
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>fynixOffice</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f4;padding:.1rem .35rem;border-radius:4px}</style></head>
<body><h1>fynixOffice</h1>
<p>Fynix suite document editor. Sign in from the <strong>desktop app</strong>
(Account → Sign in to Fynix). Suite access requires the
<code>fynix-office-access</code> role.</p></body></html>`)
  })

  /**
   * Desktop starts login: creates a PKCE transaction + poll token.
   * Browser never receives the poll token; only the desktop does.
   */
  app.post('/auth/desktop/start', async (_req, res, next) => {
    try {
      const parts = createDesktopTransaction()
      const tx: DesktopAuthTransaction = { ...parts, status: 'pending' }
      await store.set(`dtx:${tx.state}`, tx, config.desktopTxTtlSeconds)
      await store.set(`poll:${tx.pollToken}`, { state: tx.state }, config.desktopTxTtlSeconds)
      res.json({
        authorizationUrl: authorizationUrl(config, tx),
        pollToken: tx.pollToken,
        expiresIn: config.desktopTxTtlSeconds,
      })
    } catch (error) {
      next(error)
    }
  })

  /** Keycloak redirect target after user approves. Completes the desktop transaction. */
  app.get('/auth/desktop/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const tx = state ? await store.get<DesktopAuthTransaction>(`dtx:${state}`) : null
    if (!tx || !code || tx.status !== 'pending') {
      res.status(401).type('html').send(HTML_ERROR)
      return
    }
    try {
      const verified = await exchangeAndVerify(config, code, tx, fetchImpl)
      if (!hasOfficeAccess(verified.identity.roles)) {
        tx.status = 'denied'
        tx.denyReason = 'no_entitlement'
        await store.set(`dtx:${state}`, tx, config.desktopTxTtlSeconds)
        res.status(403).type('html').send(HTML_DENIED)
        return
      }
      const sessionId = opaqueId()
      const session: OfficeSession = {
        identity: verified.identity,
        keycloakRefreshToken: verified.refreshToken,
        idToken: verified.idToken,
      }
      await store.set(`session:${sessionId}`, session, config.sessionTtlSeconds)
      tx.status = 'complete'
      tx.sessionId = sessionId
      await store.set(`dtx:${state}`, tx, config.desktopTxTtlSeconds)
      res.type('html').send(HTML_SUCCESS)
    } catch (error) {
      tx.status = 'error'
      tx.errorMessage = error instanceof Error ? error.message : String(error)
      await store.set(`dtx:${state}`, tx, config.desktopTxTtlSeconds)
      res.status(401).type('html').send(HTML_ERROR)
    }
  })

  /**
   * Desktop polls until the browser callback finishes.
   * On success, returns the opaque session token once (tx is then marked consumed).
   */
  app.get('/auth/desktop/poll', async (req, res) => {
    const pollToken = typeof req.query.token === 'string' ? req.query.token : ''
    if (!pollToken) {
      res.status(400).json({ error: 'token required' })
      return
    }
    const poll = await store.get<{ state: string }>(`poll:${pollToken}`)
    if (!poll) {
      res.status(410).json({ status: 'expired' })
      return
    }
    const tx = await store.get<DesktopAuthTransaction>(`dtx:${poll.state}`)
    if (!tx) {
      res.status(410).json({ status: 'expired' })
      return
    }
    if (tx.status === 'pending') {
      res.status(202).json({ status: 'pending' })
      return
    }
    if (tx.status === 'denied') {
      await store.delete(`poll:${pollToken}`)
      res.status(403).json({
        status: 'denied',
        reason: tx.denyReason ?? 'no_entitlement',
      })
      return
    }
    if (tx.status === 'error' || !tx.sessionId) {
      await store.delete(`poll:${pollToken}`)
      res.status(401).json({ status: 'error', message: tx.errorMessage ?? 'sign-in failed' })
      return
    }
    const session = await store.get<OfficeSession>(`session:${tx.sessionId}`)
    if (!session) {
      await store.delete(`poll:${pollToken}`)
      res.status(410).json({ status: 'expired' })
      return
    }
    // One-shot: drop poll mapping so the token cannot be replayed for a second handoff.
    await store.delete(`poll:${pollToken}`)
    res.json({
      status: 'complete',
      sessionToken: tx.sessionId,
      email: session.identity.email,
      subject: session.identity.subject,
    })
  })

  app.get('/auth/session', async (req, res) => {
    const session = await sessionFor(req, store, config, fetchImpl)
    if (!session) {
      res.status(401).json({ authenticated: false })
      return
    }
    res.json(publicSessionFromIdentity(session.value.identity))
  })

  app.post('/auth/logout', async (req, res) => {
    const session = await sessionFor(req, store, config, fetchImpl)
    if (session) {
      await store.delete(`session:${session.id}`)
      if (session.value.keycloakRefreshToken) {
        await revokeRefreshToken(config, session.value.keycloakRefreshToken, fetchImpl)
      }
    }
    res.status(204).end()
  })

  registerAiRoutes(app, { config, store, llm: llmConfig, fetchImpl })
  registerOpenRoutes(app, {
    config,
    store,
    fetchImpl,
    serviceKey: config.openServiceKey,
  })

  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    console.error(error)
    res.status(500).json({ error: 'Office request could not be completed' })
  })

  return app
}
