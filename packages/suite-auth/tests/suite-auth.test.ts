import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadSuiteSession,
  parseOpenTicketFromUrl,
  resetSuiteAuthCache,
  startSuiteLogin,
  suiteAccountStatus,
  suiteLogout,
  suiteSessionPath,
  suiteSessionToken,
} from '../src/index.js'

describe('suite-auth', () => {
  let dir: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-auth-'))
    process.env.FYNIXOFFICE_AUTH_DIR = dir
    process.env.OFFICE_SERVER_URL = 'http://office.test'
    process.env.OFFICE_AUTH_POLL_MS = '20'
    resetSuiteAuthCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.FYNIXOFFICE_AUTH_DIR
    delete process.env.OFFICE_SERVER_URL
    delete process.env.OFFICE_AUTH_POLL_MS
    resetSuiteAuthCache()
    rmSync(dir, { recursive: true, force: true })
  })

  it('completes desktop poll login and persists session', async () => {
    let pollCalls = 0
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/desktop/start')) {
        return new Response(
          JSON.stringify({
            authorizationUrl: 'https://auth.test/login',
            pollToken: 'poll-1',
            expiresIn: 60,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/auth/desktop/poll')) {
        pollCalls++
        if (pollCalls === 1) {
          return new Response(JSON.stringify({ status: 'pending' }), { status: 202 })
        }
        return new Response(
          JSON.stringify({
            status: 'complete',
            sessionToken: 'sess-abc',
            email: 'user@campass.cm',
            subject: 'sub-1',
          }),
          { status: 200 },
        )
      }
      return new Response('nope', { status: 404 })
    })

    const events: Array<{ phase: string; url?: string }> = []
    startSuiteLogin((p) => events.push(p))

    await vi.waitFor(() => {
      expect(events.some((e) => e.phase === 'success')).toBe(true)
    })

    expect(events[0]).toMatchObject({ phase: 'url', url: 'https://auth.test/login' })
    expect(suiteSessionToken()).toBe('sess-abc')
    const saved = JSON.parse(readFileSync(suiteSessionPath(), 'utf-8'))
    expect(saved).toMatchObject({
      session_token: 'sess-abc',
      email: 'user@campass.cm',
    })
  })

  it('suiteAccountStatus probes the server and clears on 401', async () => {
    // seed local session
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'stale', email: 'old@x.com', server_url: 'http://office.test' }),
    )
    resetSuiteAuthCache()
    expect(loadSuiteSession()?.sessionToken).toBe('stale')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), { status: 401 }))
    const status = await suiteAccountStatus()
    expect(status.loggedIn).toBe(false)
    expect(suiteSessionToken()).toBe('')
  })

  it('parseOpenTicketFromUrl accepts protocol and web URLs', () => {
    expect(parseOpenTicketFromUrl('fynixoffice://open?ticket=abc123XYZ_-')).toBe('abc123XYZ_-')
    expect(parseOpenTicketFromUrl('https://office.example/open?ticket=tok99')).toBe('tok99')
    expect(parseOpenTicketFromUrl('not-a-ticket')).toBeNull()
  })

  it('suiteLogout calls server and removes local file', async () => {
    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'tok', email: 'a@b.c', server_url: 'http://office.test' }),
    )
    resetSuiteAuthCache()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await suiteLogout()
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://office.test/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
