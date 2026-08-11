/**
 * Suite open-ticket handoff: redeem fynixoffice://open?ticket=… from DocFlow/Finance,
 * download bytes via the Office server, write a temp file, return the path for the shell router.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadOpenTicketContent,
  hasSuiteSession,
  parseOpenTicketFromUrl,
} from '@fynixoffice/suite-auth'

export function extractSuiteOpenUrl(argv: string[]): string | null {
  return (
    argv.find(
      (arg) =>
        arg.startsWith('fynixoffice://') ||
        arg.startsWith('fynixoffice:') ||
        /[?&]ticket=/.test(arg),
    ) ?? null
  )
}

export async function materializeSuiteOpen(
  urlOrTicket: string,
): Promise<{ path: string; kind: string; source: string } | { error: string }> {
  const ticketId = parseOpenTicketFromUrl(urlOrTicket)
  if (!ticketId) return { error: 'Invalid open link' }
  if (!hasSuiteSession()) {
    return { error: 'Sign in to Fynix (Account menu) before opening suite files' }
  }
  try {
    const { bytes, filename, kind, source } = await downloadOpenTicketContent(ticketId)
    const dir = join(tmpdir(), 'fynixoffice-suite-open')
    mkdirSync(dir, { recursive: true })
    // keep original extension for the shell router
    const safe = filename.replace(/[^\w.\- ()[\]]+/g, '_') || `open.${kind}`
    const path = join(dir, `${Date.now()}-${safe}`)
    writeFileSync(path, bytes)
    return { path, kind, source }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
