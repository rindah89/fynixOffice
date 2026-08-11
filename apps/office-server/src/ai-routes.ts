import type { AgentMessage, AgentToolDef } from '@fynixoffice/agent-core'
import {
  AiTimeoutError,
  streamForProvider,
  type AiProviderConfig,
  type AiProviderId,
} from '@fynixoffice/ai-provider'
import type { Express, Request, Response } from 'express'
import type { OfficeLlmConfig } from './ai-config.js'
import { hasOfficeAccess } from './authz.js'
import { refreshAndVerify } from './oidc.js'
import type { SessionStore } from './store.js'
import type { OfficeConfig, OfficeSession } from './types.js'

export interface AiRouteDeps {
  config: OfficeConfig
  store: SessionStore
  llm: OfficeLlmConfig
  fetchImpl?: typeof fetch
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

async function requireSession(
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

function asMessages(raw: unknown): AgentMessage[] {
  if (!Array.isArray(raw)) return []
  return raw as AgentMessage[]
}

function asTools(raw: unknown): AgentToolDef[] {
  if (!Array.isArray(raw)) return []
  return raw as AgentToolDef[]
}

/**
 * NDJSON stream of AI chunks (same shape as desktop IPC AiStreamChunk).
 * No billing / credits codes — suite AI is entitlement-based.
 */
export function registerAiRoutes(app: Express, deps: AiRouteDeps): void {
  const { config, store, llm, fetchImpl = fetch } = deps

  app.get('/ai/status', async (req, res) => {
    const session = await requireSession(req, store, config, fetchImpl)
    if (!session) {
      res.status(401).json({ authenticated: false, aiEnabled: llm.enabled })
      return
    }
    res.json({
      authenticated: true,
      aiEnabled: llm.enabled,
      provider: llm.provider,
      model: llm.config.model,
      email: session.value.identity.email,
    })
  })

  app.post('/ai/stream', async (req, res) => {
    const session = await requireSession(req, store, config, fetchImpl)
    if (!session) {
      res.status(401).json({ error: 'Suite session required', errorCode: 'unauthorized' })
      return
    }
    if (!llm.enabled) {
      res.status(503).json({
        error: 'AI is not configured on the Office server (OFFICE_LLM_API_KEY)',
        errorCode: 'ai_disabled',
      })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const requestId = typeof body.requestId === 'string' ? body.requestId : 'req'
    const system = typeof body.system === 'string' ? body.system : ''
    const messages = asMessages(body.messages)
    const tools = asTools(body.tools)
    const maxTokens = typeof body.maxTokens === 'number' && body.maxTokens > 0 ? body.maxTokens : 8192
    const modelOverride = typeof body.model === 'string' && body.model ? body.model : llm.config.model

    const provider: AiProviderId = llm.provider
    const providerConfig: AiProviderConfig = {
      ...llm.config,
      model: modelOverride,
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
      ;(res as Response & { flushHeaders: () => void }).flushHeaders()
    }

    const controller = new AbortController()
    req.on('close', () => controller.abort())

    const write = (chunk: Record<string, unknown>) => {
      if (res.writableEnded) return
      res.write(`${JSON.stringify({ requestId, ...chunk })}\n`)
    }

    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      write({ type: 'ping' })
    }

    try {
      let stopReason: string | undefined
      await streamForProvider(provider, providerConfig, system, messages, tools, maxTokens, {
        signal: controller.signal,
        onDelta: (text) => write({ type: 'delta', text }),
        onToolCall: (toolCall) => write({ type: 'tool-call', toolCall }),
        onActivity: ping,
        onStopReason: (reason) => {
          stopReason = reason
        },
      })
      write({ type: 'done', ...(stopReason ? { stopReason } : {}) })
    } catch (err) {
      if (controller.signal.aborted) {
        write({ type: 'done' })
      } else {
        write({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof AiTimeoutError ? { errorCode: 'timeout' } : {}),
        })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })
}
