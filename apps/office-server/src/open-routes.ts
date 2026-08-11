import type { Express, Request, Response } from 'express'
import { hasOfficeAccess } from './authz.js'
import { refreshAndVerify } from './oidc.js'
import {
  inferKindFromFilename,
  loadOpenTicket,
  markRedeemed,
  mintOpenTicket,
  parseKind,
  parseSource,
  protocolOpenUrl,
  publicTicketMeta,
  webOpenPath,
  type OpenTicketRecord,
} from './open-tickets.js'
import type { SessionStore } from './store.js'
import type { OfficeConfig, OfficeSession } from './types.js'

export interface OpenRouteDeps {
  config: OfficeConfig
  store: SessionStore
  fetchImpl?: typeof fetch
  /** Shared secret for DocFlow/Finance backends to mint tickets. */
  serviceKey: string
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

function isServiceAuth(request: Request, serviceKey: string): boolean {
  if (!serviceKey) return false
  const token = bearerToken(request)
  if (token && token === serviceKey) return true
  const header = request.headers['x-office-service-key']
  return typeof header === 'string' && header === serviceKey
}

async function requireUserSession(
  request: Request,
  store: SessionStore,
  config: OfficeConfig,
  fetchImpl: typeof fetch,
): Promise<{ id: string; value: OfficeSession } | null> {
  const id = bearerToken(request)
  if (!id) return null
  // Service keys are not user sessions
  const value = await store.get<OfficeSession>(`session:${id}`)
  if (!value) return null
  if (value.identity.expiresAt <= Date.now() / 1000 + 30) {
    if (!value.keycloakRefreshToken) {
      await store.delete(`session:${id}`)
      return null
    }
    try {
      const refreshed = await refreshAndVerify(config, value.keycloakRefreshToken, fetchImpl)
      if (refreshed.identity.subject !== value.identity.subject) throw new Error('subject changed')
      value.identity = refreshed.identity
      value.keycloakRefreshToken = refreshed.refreshToken
      value.idToken = refreshed.idToken || value.idToken
      await store.set(`session:${id}`, value, config.sessionTtlSeconds)
    } catch {
      await store.delete(`session:${id}`)
      return null
    }
  }
  if (!hasOfficeAccess(value.identity.roles)) return null
  return { id, value }
}

async function resolveContent(
  record: OpenTicketRecord,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (record.contentBase64) {
    return {
      bytes: Buffer.from(record.contentBase64, 'base64'),
      contentType: record.contentType || 'application/octet-stream',
    }
  }
  if (!record.downloadUrl) throw new Error('ticket has no content')
  const resp = await fetchImpl(record.downloadUrl, {
    headers: { ...(record.downloadHeaders || {}), Accept: '*/*' },
  })
  if (!resp.ok) throw new Error(`upstream download failed (HTTP ${resp.status})`)
  const ab = await resp.arrayBuffer()
  return {
    bytes: Buffer.from(ab),
    contentType:
      record.contentType ||
      resp.headers.get('content-type') ||
      'application/octet-stream',
  }
}

function openLandingHtml(ticketId: string, meta: ReturnType<typeof publicTicketMeta> | null): string {
  const protocol = protocolOpenUrl(ticketId)
  const title = meta?.title || meta?.filename || 'fynixOffice'
  const kind = meta?.kind || 'file'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open in fynixOffice</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5;color:#1a1a1a}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#444;margin:.5rem 0}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:1.25rem;background:#fafafa}
a.btn,button.btn{display:inline-block;margin-top:.75rem;margin-right:.5rem;padding:.55rem 1rem;border-radius:8px;border:0;background:#0b5fff;color:#fff;text-decoration:none;font:inherit;cursor:pointer}
a.btn.secondary{background:#fff;color:#0b5fff;border:1px solid #0b5fff}
code{font-size:.85em;background:#eee;padding:.1rem .35rem;border-radius:4px}
.muted{font-size:.9rem;color:#666}
</style></head><body>
<div class="card">
<h1>Open in fynixOffice</h1>
<p><strong>${escapeHtml(title)}</strong></p>
<p class="muted">${escapeHtml(kind)} · from ${escapeHtml(meta?.source || 'suite')}</p>
<p>If fynixOffice is installed, it should open automatically. If not, install the desktop app and try again.</p>
<p>
  <a class="btn" id="launch" href="${escapeAttr(protocol)}">Open desktop app</a>
  <a class="btn secondary" href="/">fynixOffice home</a>
</p>
<p class="muted">Protocol: <code>${escapeHtml(protocol)}</code></p>
</div>
<script>
(function(){
  var href=${JSON.stringify(protocol)};
  try { window.location.href = href; } catch (e) {}
  setTimeout(function(){ var a=document.getElementById('launch'); if(a) a.focus(); }, 400);
})();
</script>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
function escapeAttr(s: string): string {
  return escapeHtml(s)
}

export function registerOpenRoutes(app: Express, deps: OpenRouteDeps): void {
  const { config, store, fetchImpl = fetch, serviceKey } = deps

  /**
   * Mint an open ticket.
   * Auth: suite user session (Bearer session id) OR service key (DocFlow/Finance backends).
   */
  app.post('/open/tickets', async (req, res) => {
    const service = isServiceAuth(req, serviceKey)
    const session = service ? null : await requireUserSession(req, store, config, fetchImpl)
    if (!service && !session) {
      res.status(401).json({ error: 'suite session or service key required' })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const filename = String(body.filename || '').trim()
    const kind =
      parseKind(body.kind) || (filename ? inferKindFromFilename(filename) : null)
    const source = parseSource(body.source) || 'generic'
    if (!kind || !filename) {
      res.status(400).json({ error: 'kind and filename required' })
      return
    }

    try {
      const record = await mintOpenTicket(store, {
        kind,
        source,
        filename,
        title: typeof body.title === 'string' ? body.title : undefined,
        sourceId: typeof body.sourceId === 'string' ? body.sourceId : undefined,
        downloadUrl: typeof body.downloadUrl === 'string' ? body.downloadUrl : undefined,
        downloadHeaders:
          body.downloadHeaders && typeof body.downloadHeaders === 'object'
            ? (body.downloadHeaders as Record<string, string>)
            : undefined,
        contentBase64:
          typeof body.contentBase64 === 'string' ? body.contentBase64 : undefined,
        contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
        createdBy: session?.value.identity.subject || (service ? 'service' : undefined),
        ttlSeconds: typeof body.ttlSeconds === 'number' ? body.ttlSeconds : undefined,
      })
      const base = config.baseUrl.replace(/\/$/, '')
      res.status(201).json({
        ticket: record.id,
        kind: record.kind,
        source: record.source,
        filename: record.filename,
        expiresAt: record.expiresAt,
        protocolUrl: protocolOpenUrl(record.id),
        webUrl: `${base}${webOpenPath(record.id)}`,
      })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  /** Browser landing: auto-launch fynixoffice://open?ticket=… */
  app.get('/open', async (req, res) => {
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : ''
    if (!ticket) {
      res.status(400).type('html').send('<p>Missing ticket.</p>')
      return
    }
    const record = await loadOpenTicket(store, ticket)
    res
      .status(record ? 200 : 410)
      .type('html')
      .send(openLandingHtml(ticket, record ? publicTicketMeta(record) : null))
  })

  /** Desktop redeems ticket metadata (requires suite user session). */
  app.get('/open/tickets/:id', async (req, res) => {
    const session = await requireUserSession(req, store, config, fetchImpl)
    if (!session) {
      res.status(401).json({ error: 'suite session required' })
      return
    }
    const record = await loadOpenTicket(store, req.params.id)
    if (!record) {
      res.status(410).json({ error: 'ticket expired or unknown' })
      return
    }
    res.json({
      ...publicTicketMeta(record),
      contentUrl: `/open/tickets/${encodeURIComponent(record.id)}/content`,
    })
  })

  /** Desktop downloads file bytes (requires suite user session). */
  app.get('/open/tickets/:id/content', async (req, res) => {
    const session = await requireUserSession(req, store, config, fetchImpl)
    if (!session) {
      res.status(401).json({ error: 'suite session required' })
      return
    }
    const record = await loadOpenTicket(store, req.params.id)
    if (!record) {
      res.status(410).json({ error: 'ticket expired or unknown' })
      return
    }
    try {
      const { bytes, contentType } = await resolveContent(record, fetchImpl)
      await markRedeemed(store, record)
      res.setHeader('Content-Type', contentType)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${record.filename.replace(/"/g, '')}"`,
      )
      res.setHeader('X-Office-Kind', record.kind)
      res.setHeader('X-Office-Source', record.source)
      res.send(bytes)
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'download failed',
      })
    }
  })
}
