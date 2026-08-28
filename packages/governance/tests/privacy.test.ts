import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildOfficePrivacyExport,
  buildOfficeSuitePrivacyExport,
  writePrivateOfficeExport,
} from '../src/privacy.js'

describe('Office privacy access export', () => {
  it('exports every declared local surface and redacts nested credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-privacy-'))
    writeFileSync(join(root, 'app-settings.json'), JSON.stringify({ theme: 'dark' }))
    writeFileSync(
      join(root, 'ai-settings.json'),
      JSON.stringify({ providers: { openai: { apiKey: 'never-export', model: 'gpt' } } }),
    )
    mkdirSync(join(root, 'projects', 'default', 'chats'), { recursive: true })
    writeFileSync(
      join(root, 'projects', 'index.json'),
      JSON.stringify({ projects: [], fileMap: {} }),
    )
    writeFileSync(
      join(root, 'projects', 'default', 'chats', 'chat.jsonl'),
      `${JSON.stringify({ seq: 1, role: 'user', text: 'my prompt', token: 'hidden' })}\n`,
    )

    const document = buildOfficePrivacyExport(
      root,
      '10000000-0000-4000-8000-000000000001',
      new Date('2026-08-28T12:00:00Z'),
    )

    expect(document.surface_manifest).toEqual([
      'ai-settings.json',
      'app-settings.json',
      'projects/default/chats/chat.jsonl',
      'projects/index.json',
    ])
    expect(JSON.stringify(document)).toContain('my prompt')
    expect(JSON.stringify(document)).not.toContain('never-export')
    expect(JSON.stringify(document)).not.toContain('hidden')
    expect(JSON.stringify(document)).toContain('[excluded-secret]')
  })

  it('creates an owner-only export and never overwrites it', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-privacy-'))
    const document = buildOfficePrivacyExport(root, '10000000-0000-4000-8000-000000000001')
    const output = join(root, 'export.json')
    const digest = writePrivateOfficeExport(output, document)
    expect(digest).toHaveLength(64)
    expect(statSync(output).mode & 0o777).toBe(0o600)
    expect(() => writePrivateOfficeExport(output, document)).toThrow()
    expect(readFileSync(output, 'utf8')).toContain('fynix.office.privacy-access-export/v1')
    chmodSync(output, 0o600)
  })

  it('combines separately stored Office application surfaces without collisions', () => {
    const docs = mkdtempSync(join(tmpdir(), 'office-docs-'))
    const slides = mkdtempSync(join(tmpdir(), 'office-slides-'))
    writeFileSync(
      join(docs, 'recent.json'),
      JSON.stringify([{ path: '/controlled/document.docx' }]),
    )
    writeFileSync(join(slides, 'slides-recent.json'), JSON.stringify([{ title: 'Board pack' }]))

    const document = buildOfficeSuitePrivacyExport(
      { slides, docs },
      '10000000-0000-4000-8000-000000000001',
    )

    expect(document.surface_manifest).toEqual(['docs/recent.json', 'slides/slides-recent.json'])
  })

  it('rejects an invalid privacy subject', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-privacy-'))
    writeFileSync(join(root, 'recent.json'), JSON.stringify([]))
    expect(() => buildOfficePrivacyExport(root, 'not-a-uuid')).toThrow(/canonical UUID/)
  })
})
