import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OfficeLocalGovernance } from '../src/local-controls.js'

const owner = '11111111-1111-4111-8111-111111111111'

describe('Office local governance controls', () => {
  it('requires classification, detects out-of-band changes, and binds audit events', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-governance-'))
    const file = join(root, 'board.docx')
    writeFileSync(file, 'version-one', { mode: 0o600 })
    const controls = new OfficeLocalGovernance(join(root, 'state'))

    expect(() => controls.authorize(file, owner, 'read')).toThrow(/no enforced classification/)
    expect(controls.classify(file, 'confidential', owner)).toMatchObject({ label: 'confidential' })
    expect(controls.authorize(file, owner, 'read')).toMatchObject({ label: 'confidential' })
    writeFileSync(file, 'changed outside governance')
    expect(() => controls.authorize(file, owner, 'read')).toThrow(/changed outside/)
    expect(controls.authorize(file, owner, 'write').content_sha256).toHaveLength(64)
    expect(controls.verifyAuditChain()).toMatchObject({ events: 5 })
  })

  it('requires controlled approval for restricted exports and detects audit tampering', () => {
    const root = mkdtempSync(join(tmpdir(), 'office-governance-'))
    const file = join(root, 'restricted.xlsx')
    writeFileSync(file, 'sensitive', { mode: 0o600 })
    const state = join(root, 'state')
    const controls = new OfficeLocalGovernance(state)
    controls.classify(file, 'restricted', owner)

    expect(() => controls.authorize(file, owner, 'export')).toThrow(/approval/)
    expect(controls.authorize(file, owner, 'export', 'evidence://office/export/approved'))
      .toMatchObject({ label: 'restricted' })
    const log = join(state, 'local-governance-audit.jsonl')
    chmodSync(log, 0o600)
    writeFileSync(log, readFileSync(log, 'utf8').replace('restricted', 'public'))
    expect(() => controls.verifyAuditChain()).toThrow(/chain is invalid/)
  })
})
