import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

export const officeClassifications = [
  'public', 'internal', 'confidential', 'restricted',
] as const
export type OfficeClassification = typeof officeClassifications[number]
export type OfficeFileAction = 'classify' | 'read' | 'write' | 'export' | 'denied'

export type ClassificationRecord = {
  path_ref: string
  label: OfficeClassification
  owner_ref: string
  content_sha256: string
  classified_at: string
  updated_at: string
}

export type OfficeAuditEvent = {
  schema: 'fynix.office.local-audit/v1'
  event_id: string
  occurred_at: string
  subject_ref: string
  path_ref: string
  action: OfficeFileAction
  outcome: 'succeeded' | 'denied' | 'failed'
  classification: OfficeClassification
  evidence_ref: string | null
  previous_sha256: string
  event_sha256: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const evidence = /^(urn:fynix:|evidence:\/\/)[A-Za-z0-9._:/-]+$/
const zeroDigest = '0'.repeat(64)

export class OfficeLocalGovernance {
  private readonly manifestPath: string
  private readonly auditPath: string

  constructor(private readonly stateRoot: string) {
    this.manifestPath = resolve(stateRoot, 'classification-manifest.json')
    this.auditPath = resolve(stateRoot, 'local-governance-audit.jsonl')
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
    chmodSync(stateRoot, 0o700)
  }

  classify(filePath: string, label: OfficeClassification, ownerRef: string): ClassificationRecord {
    this.assertFile(filePath)
    if (!officeClassifications.includes(label)) throw new Error('invalid Office classification')
    if (!uuid.test(ownerRef)) throw new Error('classification owner must be a canonical UUID')
    const pathRef = opaquePath(filePath)
    const now = new Date().toISOString()
    const record = this.withLock(() => {
      const records = this.records()
      const prior = records[pathRef]
      const next: ClassificationRecord = {
        path_ref: pathRef,
        label,
        owner_ref: ownerRef.toLowerCase(),
        content_sha256: fileDigest(filePath),
        classified_at: prior?.classified_at ?? now,
        updated_at: now,
      }
      records[pathRef] = next
      this.writeManifest(records)
      return next
    })
    this.audit(ownerRef, filePath, 'classify', 'succeeded', label, null)
    return record
  }

  authorize(
    filePath: string,
    subjectRef: string,
    action: Exclude<OfficeFileAction, 'classify' | 'denied'>,
    exportApprovalRef?: string,
  ): ClassificationRecord {
    if (!uuid.test(subjectRef)) throw new Error('Office audit subject must be a canonical UUID')
    this.assertFile(filePath)
    const record = this.withLock(() => this.records()[opaquePath(filePath)])
    if (!record) {
      this.audit(subjectRef, filePath, 'denied', 'denied', 'restricted', null)
      throw new Error('Office file has no enforced classification')
    }
    if (action === 'export' && record.label === 'restricted' &&
      (!exportApprovalRef || !evidence.test(exportApprovalRef))) {
      this.audit(subjectRef, filePath, 'denied', 'denied', record.label, null)
      throw new Error('restricted export requires a controlled approval reference')
    }
    if (action === 'read' && record.content_sha256 !== fileDigest(filePath)) {
      this.audit(subjectRef, filePath, 'denied', 'denied', record.label, null)
      throw new Error('classified file content changed outside the governed save path')
    }
    if (action === 'write') {
      record.content_sha256 = fileDigest(filePath)
      record.updated_at = new Date().toISOString()
      this.withLock(() => {
        const records = this.records()
        records[record.path_ref] = record
        this.writeManifest(records)
      })
    }
    this.audit(subjectRef, filePath, action, 'succeeded', record.label, exportApprovalRef ?? null)
    return record
  }

  verifyAuditChain(): { events: number; terminal_sha256: string } {
    return this.withLock(() => this.verifyAuditChainUnlocked())
  }

  private verifyAuditChainUnlocked(): { events: number; terminal_sha256: string } {
    if (!existsSync(this.auditPath)) return { events: 0, terminal_sha256: zeroDigest }
    const lines = readFileSync(this.auditPath, 'utf8').split('\n').filter(Boolean)
    let previous = zeroDigest
    for (const line of lines) {
      const event = JSON.parse(line) as OfficeAuditEvent
      const { event_sha256, ...material } = event
      if (event.previous_sha256 !== previous || digestJson(material) !== event_sha256)
        throw new Error('Office local governance audit chain is invalid')
      previous = event_sha256
    }
    return { events: lines.length, terminal_sha256: previous }
  }

  private records(): Record<string, ClassificationRecord> {
    if (!existsSync(this.manifestPath)) return {}
    const value: unknown = JSON.parse(readFileSync(this.manifestPath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Office classification manifest is invalid')
    return value as Record<string, ClassificationRecord>
  }

  private writeManifest(records: Record<string, ClassificationRecord>): void {
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(records, null, 2), { mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.manifestPath)
    chmodSync(this.manifestPath, 0o600)
  }

  private audit(
    subjectRef: string,
    filePath: string,
    action: OfficeFileAction,
    outcome: OfficeAuditEvent['outcome'],
    classification: OfficeClassification,
    evidenceRef: string | null,
  ): void {
    this.withLock(() => {
      const terminal = this.verifyAuditChainUnlocked().terminal_sha256
      const material = {
        schema: 'fynix.office.local-audit/v1' as const,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        subject_ref: subjectRef.toLowerCase(),
        path_ref: opaquePath(filePath),
        action,
        outcome,
        classification,
        evidence_ref: evidenceRef,
        previous_sha256: terminal,
      }
      const event: OfficeAuditEvent = { ...material, event_sha256: digestJson(material) }
      const descriptor = openSync(this.auditPath, 'a', 0o600)
      try {
        chmodSync(this.auditPath, 0o600)
        writeSync(descriptor, `${JSON.stringify(event)}\n`)
      } finally {
        closeSync(descriptor)
      }
    })
  }

  private assertFile(filePath: string): void {
    const stat = statSync(filePath, { throwIfNoEntry: false })
    if (!stat?.isFile()) throw new Error('Office governed path must be a regular file')
  }

  private withLock<T>(operation: () => T): T {
    const lockPath = resolve(this.stateRoot, '.governance-lock')
    const deadline = Date.now() + 5_000
    while (true) {
      try {
        mkdirSync(lockPath, { mode: 0o700 })
        break
      } catch {
        const lock = statSync(lockPath, { throwIfNoEntry: false })
        if (lock && Date.now() - lock.mtimeMs > 30_000) {
          rmSync(lockPath, { recursive: true, force: true })
          continue
        }
        if (Date.now() >= deadline) throw new Error('Office governance state is locked')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      }
    }
    try {
      return operation()
    } finally {
      rmSync(lockPath, { recursive: true, force: true })
    }
  }
}

export function opaquePath(filePath: string): string {
  return createHash('sha256').update(resolve(filePath)).digest('hex')
}

function fileDigest(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
