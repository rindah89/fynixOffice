import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  eraseOfficeSuitePrivacyData,
  loadActiveOfficePrivacyHolds,
} from '../src/privacy-erasure.js'

const subject = '10000000-0000-4000-8000-000000000001'

describe('Office privacy erasure', () => {
  it('removes every declared metadata surface and writes a digest receipt', () => {
    const docs = mkdtempSync(join(tmpdir(), 'office-erasure-docs-'))
    const slides = mkdtempSync(join(tmpdir(), 'office-erasure-slides-'))
    writeFileSync(join(docs, 'recent.json'), '[{"path":"document.docx"}]')
    mkdirSync(join(docs, 'projects', 'default', 'chats'), { recursive: true })
    writeFileSync(join(docs, 'projects', 'default', 'chats', 'chat.jsonl'), '{"text":"prompt"}\n')
    writeFileSync(join(slides, 'slides-recent.json'), '[{"title":"Board"}]')

    const receipt = eraseOfficeSuitePrivacyData(
      { docs, slides }, subject, 42, new Set(), new Date('2026-08-28T12:00:00Z'),
    )

    expect(existsSync(join(docs, 'recent.json'))).toBe(false)
    expect(existsSync(join(docs, 'projects', 'default', 'chats', 'chat.jsonl'))).toBe(false)
    expect(existsSync(join(slides, 'slides-recent.json'))).toBe(false)
    expect(receipt.affected_files).toEqual([
      'docs/projects/default/chats/chat.jsonl', 'docs/recent.json', 'slides/slides-recent.json',
    ])
    expect(receipt.evidence_sha256).toMatch(/^[a-f0-9]{64}$/)
    const receiptPath = join(docs, '.privacy-erasure-receipt-42.json')
    expect(statSync(receiptPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(receiptPath, 'utf8')).toContain(receipt.evidence_sha256)
  })

  it('blocks before mutation when the subject has an active legal hold', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-erasure-hold-'))
    writeFileSync(join(root, 'recent.json'), '[]')
    expect(() => eraseOfficeSuitePrivacyData({ docs: root }, subject, 7, new Set([subject])))
      .toThrow(/active legal hold/)
    expect(existsSync(join(root, 'recent.json'))).toBe(true)
  })

  it('validates the deployment-owned hold file', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-erasure-holds-'))
    const path = join(root, 'holds.json')
    writeFileSync(path, JSON.stringify([subject]))
    expect(loadActiveOfficePrivacyHolds(path).has(subject)).toBe(true)
    writeFileSync(path, '["person@example.com"]')
    expect(() => loadActiveOfficePrivacyHolds(path)).toThrow(/canonical UUID/)
  })
})
