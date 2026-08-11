/**
 * Desktop suite auth client for fynixOffice.
 *
 * Talks to apps/office-server (Keycloak RP + opaque sessions). The desktop never
 * holds OIDC client secrets or LLM vendor keys — only an opaque session token
 * under ~/.fynixoffice/session.json.
 *
 * Progress events mirror the previous Genspark device-code shape so shell IPC
 * can stay stable: phase 'url' | 'success' | 'error'.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface SuiteLoginProgress {
  phase: 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  /** 'network' | 'expired' | 'denied' | raw error text */
  error?: string
}

export interface SuiteAccountStatus {
  loggedIn: boolean
  email?: string
  subject?: string
}

interface StoredSession {
  sessionToken: string
  email?: string
  subject?: string
  serverUrl: string
}

const DEFAULT_SERVER_URL = 'http://localhost:4321'
/** Override with OFFICE_AUTH_POLL_MS in tests to avoid multi-second sleeps. */
function pollMs(): number {
  return Number(process.env.OFFICE_AUTH_POLL_MS || 2000)
}

export function officeServerUrl(): string {
  return (process.env.OFFICE_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/$/, '')
}

/** Override dir via FYNIXOFFICE_AUTH_DIR (test isolation; shared with legacy auth dir). */
export function suiteSessionPath(): string {
  return join(process.env.FYNIXOFFICE_AUTH_DIR || join(homedir(), '.fynixoffice'), 'session.json')
}

let cached: StoredSession | null | undefined

function readSessionFile(): StoredSession | null {
  try {
    const raw = JSON.parse(readFileSync(suiteSessionPath(), 'utf-8')) as Record<string, unknown>
    const sessionToken = typeof raw.session_token === 'string' ? raw.session_token : ''
    if (!sessionToken) return null
    return {
      sessionToken,
      email: typeof raw.email === 'string' ? raw.email : undefined,
      subject: typeof raw.subject === 'string' ? raw.subject : undefined,
      serverUrl: typeof raw.server_url === 'string' ? raw.server_url : officeServerUrl(),
    }
  } catch {
    return null
  }
}

export function loadSuiteSession(): StoredSession | null {
  if (cached !== undefined) return cached
  cached = readSessionFile()
  return cached
}

export function suiteSessionToken(): string {
  return loadSuiteSession()?.sessionToken ?? ''
}

function saveSession(session: StoredSession): void {
  const path = suiteSessionPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        session_token: session.sessionToken,
        email: session.email,
        subject: session.subject,
        server_url: session.serverUrl,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  try {
    // re-assert mode on platforms that ignore writeFileSync mode when the file exists
    chmodSync(path, 0o600)
  } catch {
    /* ignore */
  }
  cached = session
}

function clearSession(): void {
  cached = null
  try {
    if (existsSync(suiteSessionPath())) unlinkSync(suiteSessionPath())
  } catch {
    /* ignore */
  }
}

export function resetSuiteAuthCache(): void {
  cached = undefined
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

let activeLogin: { cancel: () => void } | null = null

/**
 * Starts suite desktop login against the Office server.
 * Caller opens `url` in the system browser. Returns whether the flow was started.
 */
export function startSuiteLogin(onEvent?: (progress: SuiteLoginProgress) => void): boolean {
  activeLogin?.cancel()
  const emit = onEvent ?? (() => {})
  const controller = new AbortController()
  let done = false
  const self = {
    cancel: () => {
      done = true
      controller.abort()
    },
  }
  activeLogin = self
  const finish = (progress: SuiteLoginProgress) => {
    if (done) return
    done = true
    if (activeLogin === self) activeLogin = null
    emit(progress)
  }

  void (async () => {
    const base = officeServerUrl()
    let startResp: Response
    try {
      startResp = await fetch(`${base}/auth/desktop/start`, {
        method: 'POST',
        signal: controller.signal,
      })
    } catch {
      finish({ phase: 'error', error: 'network' })
      return
    }
    if (!startResp.ok) {
      finish({ phase: 'error', error: 'network' })
      return
    }
    const start = (await startResp.json()) as {
      authorizationUrl?: string
      pollToken?: string
      expiresIn?: number
    }
    const url = start.authorizationUrl ?? ''
    const pollToken = start.pollToken ?? ''
    if (!url || !pollToken) {
      finish({ phase: 'error', error: 'network' })
      return
    }
    const expiresInSec = Number(start.expiresIn) > 0 ? Number(start.expiresIn) : 600
    emit({ phase: 'url', url, expiresInSec })

    const deadline = Date.now() + expiresInSec * 1000
    while (Date.now() < deadline) {
      await sleep(pollMs(), controller.signal)
      let pollResp: Response
      try {
        pollResp = await fetch(`${base}/auth/desktop/poll?token=${encodeURIComponent(pollToken)}`, {
          signal: controller.signal,
        })
      } catch {
        finish({ phase: 'error', error: 'network' })
        return
      }
      if (pollResp.status === 202) continue
      if (pollResp.status === 410) {
        finish({ phase: 'error', error: 'expired' })
        return
      }
      if (pollResp.status === 403) {
        finish({ phase: 'error', error: 'denied' })
        return
      }
      if (!pollResp.ok) {
        finish({ phase: 'error', error: 'failed' })
        return
      }
      const body = (await pollResp.json()) as {
        status?: string
        sessionToken?: string
        email?: string
        subject?: string
      }
      if (body.status === 'complete' && body.sessionToken) {
        saveSession({
          sessionToken: body.sessionToken,
          email: body.email,
          subject: body.subject,
          serverUrl: base,
        })
        finish({ phase: 'success' })
        return
      }
      finish({ phase: 'error', error: 'failed' })
      return
    }
    finish({ phase: 'error', error: 'expired' })
  })().catch((e: unknown) => {
    if (controller.signal.aborted) return
    finish({
      phase: 'error',
      error: String((e as Error)?.message ?? e),
    })
  })

  return true
}

export function suiteLoginInFlight(): boolean {
  return activeLogin !== null
}

export function ensureSuiteLogin(openUrl: (url: string) => void): void {
  if (suiteLoginInFlight()) return
  startSuiteLogin((progress) => {
    if (progress.url) openUrl(progress.url)
  })
}

/** Probe the Office server for the current session. No credit/billing fields. */
export async function suiteAccountStatus(): Promise<SuiteAccountStatus> {
  const session = loadSuiteSession()
  if (!session) return { loggedIn: false }
  try {
    const resp = await fetch(`${session.serverUrl || officeServerUrl()}/auth/session`, {
      headers: { Authorization: `Bearer ${session.sessionToken}`, Accept: 'application/json' },
    })
    if (resp.status === 401) {
      clearSession()
      return { loggedIn: false }
    }
    if (!resp.ok) {
      // keep local token on transient errors; surface last known email
      return { loggedIn: true, email: session.email, subject: session.subject }
    }
    const body = (await resp.json()) as {
      authenticated?: boolean
      email?: string
      subject?: string
    }
    if (!body.authenticated) {
      clearSession()
      return { loggedIn: false }
    }
    if (body.email && body.email !== session.email) {
      saveSession({ ...session, email: body.email, subject: body.subject })
    }
    return {
      loggedIn: true,
      email: body.email ?? session.email,
      subject: body.subject ?? session.subject,
    }
  } catch {
    return { loggedIn: true, email: session.email, subject: session.subject }
  }
}

export async function suiteLogout(): Promise<void> {
  const session = loadSuiteSession()
  if (session) {
    try {
      await fetch(`${session.serverUrl || officeServerUrl()}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      })
    } catch {
      /* best-effort server logout */
    }
  }
  clearSession()
}

/** Authenticated fetch against the Office server (AI BFF, etc.). */
export async function suiteApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = loadSuiteSession()
  if (!session) throw new Error('Not signed in to Fynix')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.sessionToken}`)
  const url = path.startsWith('http') ? path : `${session.serverUrl || officeServerUrl()}${path}`
  return fetch(url, { ...init, headers })
}

/** One NDJSON AI chunk from the Office server (matches desktop AiStreamChunk). */
export interface SuiteAiChunk {
  requestId: string
  type: 'delta' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
  error?: string
  errorCode?: 'timeout' | 'unauthorized' | 'ai_disabled'
  stopReason?: string
}

export interface SuiteAiStreamRequest {
  requestId: string
  system: string
  messages: unknown[]
  tools?: unknown[]
  maxTokens?: number
  model?: string
}

/**
 * Stream an AI turn through the Office server BFF.
 * Emits the same chunk types as local streamForProvider IPC.
 */
export async function suiteStreamAi(
  body: SuiteAiStreamRequest,
  onChunk: (chunk: SuiteAiChunk) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await suiteApiFetch('/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
    signal,
  })
  if (resp.status === 401) {
    onChunk({
      requestId: body.requestId,
      type: 'error',
      error: 'Suite session expired — sign in to Fynix again',
      errorCode: 'unauthorized',
    })
    return
  }
  if (resp.status === 503) {
    let message = 'AI is not configured on the Office server'
    try {
      const j = (await resp.json()) as { error?: string }
      if (j.error) message = j.error
    } catch {
      /* ignore */
    }
    onChunk({
      requestId: body.requestId,
      type: 'error',
      error: message,
      errorCode: 'ai_disabled',
    })
    return
  }
  if (!resp.ok || !resp.body) {
    onChunk({
      requestId: body.requestId,
      type: 'error',
      error: `Office AI request failed (HTTP ${resp.status})`,
    })
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        onChunk(JSON.parse(trimmed) as SuiteAiChunk)
      } catch {
        /* skip malformed line */
      }
    }
  }
  if (buffer.trim()) {
    try {
      onChunk(JSON.parse(buffer.trim()) as SuiteAiChunk)
    } catch {
      /* ignore */
    }
  }
}

/** True when a suite session token is stored locally (not necessarily validated). */
export function hasSuiteSession(): boolean {
  return Boolean(suiteSessionToken())
}

export type SuiteOpenKind = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md'

export interface SuiteOpenTicketMeta {
  id: string
  kind: SuiteOpenKind
  source: string
  filename: string
  title?: string | null
  sourceId?: string | null
  contentUrl: string
}

/** Parse fynixoffice://open?ticket=… or https://host/open?ticket=… */
export function parseOpenTicketFromUrl(url: string): string | null {
  try {
    const trimmed = url.trim()
    if (trimmed.startsWith('fynixoffice:')) {
      const u = new URL(trimmed.replace(/^fynixoffice:/i, 'https://open.local'))
      const ticket = u.searchParams.get('ticket')
      return ticket || null
    }
    const u = new URL(trimmed)
    if (u.pathname === '/open' || u.pathname.endsWith('/open')) {
      return u.searchParams.get('ticket')
    }
  } catch {
    /* ignore */
  }
  // bare ticket id
  if (/^[A-Za-z0-9_-]{16,}$/.test(url.trim())) return url.trim()
  return null
}

export async function redeemOpenTicket(ticketId: string): Promise<SuiteOpenTicketMeta> {
  const resp = await suiteApiFetch(`/open/tickets/${encodeURIComponent(ticketId)}`)
  if (resp.status === 401) throw new Error('Sign in to Fynix to open this file')
  if (resp.status === 410) throw new Error('This open link has expired')
  if (!resp.ok) throw new Error(`Could not open file (HTTP ${resp.status})`)
  return (await resp.json()) as SuiteOpenTicketMeta
}

/** Download ticket content to a Buffer (requires suite session). */
export async function downloadOpenTicketContent(ticketId: string): Promise<{
  bytes: Buffer
  filename: string
  kind: SuiteOpenKind
  source: string
}> {
  const meta = await redeemOpenTicket(ticketId)
  const resp = await suiteApiFetch(`/open/tickets/${encodeURIComponent(ticketId)}/content`)
  if (!resp.ok) throw new Error(`Could not download file (HTTP ${resp.status})`)
  const ab = await resp.arrayBuffer()
  return {
    bytes: Buffer.from(ab),
    filename: meta.filename,
    kind: meta.kind,
    source: meta.source,
  }
}
