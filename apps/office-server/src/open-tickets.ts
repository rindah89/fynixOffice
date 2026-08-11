import { createHash, randomBytes } from 'node:crypto'
import type { SessionStore } from './store.js'

export type OpenKind = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md'
export type OpenSource = 'docflow' | 'finance' | 'generic'

export interface OpenTicketRecord {
  id: string
  kind: OpenKind
  source: OpenSource
  filename: string
  title?: string
  sourceId?: string
  /** Absolute URL the desktop/server may fetch (optional if content stored). */
  downloadUrl?: string
  /** Optional headers for downloadUrl (Authorization, etc.) — never returned to clients. */
  downloadHeaders?: Record<string, string>
  /** Inline payload (base64) for suite handoff when no durable URL exists. */
  contentBase64?: string
  contentType?: string
  createdAt: number
  expiresAt: number
  redeemedAt?: number
  createdBy?: string
}

export interface MintOpenTicketInput {
  kind: OpenKind
  source: OpenSource
  filename: string
  title?: string
  sourceId?: string
  downloadUrl?: string
  downloadHeaders?: Record<string, string>
  contentBase64?: string
  contentType?: string
  createdBy?: string
  /** TTL seconds (default 600). */
  ttlSeconds?: number
}

const KIND_SET = new Set<OpenKind>(['docx', 'xlsx', 'pptx', 'pdf', 'md'])
const SOURCE_SET = new Set<OpenSource>(['docflow', 'finance', 'generic'])
const MAX_INLINE_BYTES = 40 * 1024 * 1024 // 40 MiB

export function newTicketId(): string {
  return randomBytes(24).toString('base64url')
}

export function parseKind(value: unknown): OpenKind | null {
  const k = String(value || '').toLowerCase()
  return KIND_SET.has(k as OpenKind) ? (k as OpenKind) : null
}

export function parseSource(value: unknown): OpenSource | null {
  const s = String(value || '').toLowerCase()
  return SOURCE_SET.has(s as OpenSource) ? (s as OpenSource) : null
}

export function inferKindFromFilename(filename: string): OpenKind | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.csv')) return 'xlsx'
  if (lower.endsWith('.pptx')) return 'pptx'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md'
  return null
}

export async function mintOpenTicket(
  store: SessionStore,
  input: MintOpenTicketInput,
): Promise<OpenTicketRecord> {
  const kind = input.kind
  const source = input.source
  if (!KIND_SET.has(kind)) throw new Error('invalid kind')
  if (!SOURCE_SET.has(source)) throw new Error('invalid source')
  if (!input.filename?.trim()) throw new Error('filename required')
  if (!input.downloadUrl && !input.contentBase64) {
    throw new Error('downloadUrl or contentBase64 required')
  }
  if (input.contentBase64) {
    const bytes = Buffer.byteLength(input.contentBase64, 'base64')
    if (bytes > MAX_INLINE_BYTES) throw new Error('content too large')
  }

  const ttl = Math.min(Math.max(input.ttlSeconds ?? 600, 60), 3600)
  const now = Date.now()
  const id = newTicketId()
  const record: OpenTicketRecord = {
    id,
    kind,
    source,
    filename: input.filename.trim(),
    ...(input.title ? { title: input.title } : {}),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.downloadUrl ? { downloadUrl: input.downloadUrl } : {}),
    ...(input.downloadHeaders ? { downloadHeaders: input.downloadHeaders } : {}),
    ...(input.contentBase64 ? { contentBase64: input.contentBase64 } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    createdAt: now,
    expiresAt: now + ttl * 1000,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  }
  await store.set(`open:${id}`, record, ttl)
  return record
}

export async function loadOpenTicket(
  store: SessionStore,
  id: string,
): Promise<OpenTicketRecord | null> {
  if (!id) return null
  const record = await store.get<OpenTicketRecord>(`open:${id}`)
  if (!record) return null
  if (record.expiresAt <= Date.now()) {
    await store.delete(`open:${id}`)
    return null
  }
  return record
}

/** Public metadata only — no content, no download headers. */
export function publicTicketMeta(record: OpenTicketRecord) {
  return {
    id: record.id,
    kind: record.kind,
    source: record.source,
    filename: record.filename,
    title: record.title ?? null,
    sourceId: record.sourceId ?? null,
    expiresAt: record.expiresAt,
    hasInlineContent: Boolean(record.contentBase64),
    hasDownloadUrl: Boolean(record.downloadUrl),
  }
}

export async function markRedeemed(store: SessionStore, record: OpenTicketRecord): Promise<void> {
  const remainingMs = record.expiresAt - Date.now()
  if (remainingMs <= 0) {
    await store.delete(`open:${record.id}`)
    return
  }
  record.redeemedAt = Date.now()
  await store.set(`open:${record.id}`, record, Math.ceil(remainingMs / 1000))
}

export function contentFingerprint(contentBase64: string): string {
  return createHash('sha256').update(contentBase64).digest('hex').slice(0, 16)
}

export function protocolOpenUrl(ticketId: string): string {
  return `fynixoffice://open?ticket=${encodeURIComponent(ticketId)}`
}

export function webOpenPath(ticketId: string): string {
  return `/open?ticket=${encodeURIComponent(ticketId)}`
}
