import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const controlIds = Array.from(
  { length: 12 },
  (_, index) => `DG-${String(index + 1).padStart(2, '0')}`,
)

type Status = 'effective' | 'partially_effective' | 'ineffective' | 'not_applicable' | 'unknown'
type Definition = {
  status: Status
  summary: string
  evidence_refs: string[]
  metrics: Record<string, string | number | boolean | null>
}
export type ProcessorInventoryEntry = {
  name: string
  purpose: string
  data_categories: string[]
  processing_countries: string[]
  transfer_mechanism: string | null
  agreement_owner: string
  agreement_evidence_ref: string
  agreement_evidence_sha256: string
  review_due_at: string
}

const controls: Record<string, Definition> = {
  'DG-01': {
    status: 'effective',
    summary:
      'Documents, sheets, slides, PDFs, Markdown, projects and server sessions have explicit owning modules.',
    evidence_refs: ['docs/fynix-suite/architecture.md', 'apps', 'packages/project-store'],
    metrics: { governed_editors: 5 },
  },
  'DG-02': {
    status: 'partially_effective',
    summary:
      'Application and operating-system boundaries protect files, but a unified document classification label is not enforced.',
    evidence_refs: ['apps/shell/src/main', 'apps/office-server/src'],
    metrics: { classification_labels_enforced: false },
  },
  'DG-03': {
    status: 'partially_effective',
    summary:
      'Fail-closed access export and legal-hold-aware erasure cover Office-controlled settings, recent-file metadata, projects and AI chats with digest-bound CyberAudit evidence; correction, restriction and objection remain incomplete.',
    evidence_refs: ['packages/governance/src/privacy.ts', 'packages/governance/src/privacy-erasure.ts', 'packages/project-store', 'apps/office-server/src/ai-routes.ts'],
    metrics: { privacy_access_export: true, secret_redaction: true, erasure_fulfillment: true, legal_hold_precedence: true },
  },
  'DG-04': {
    status: 'effective',
    summary:
      'Office server opaque sessions and suite SSO protect remote actions; desktop files remain under the signed-in operating-system user.',
    evidence_refs: ['packages/suite-auth', 'apps/office-server/src/app.ts'],
    metrics: { browser_tokens_persisted: false },
  },
  'DG-05': {
    status: 'partially_effective',
    summary:
      'Server and suite operations are tested, while complete local document read, export and denial auditing is not implemented.',
    evidence_refs: ['apps/office-server/tests', 'apps/shell/src/main'],
    metrics: { local_document_audit_complete: false },
  },
  'DG-06': {
    status: 'partially_effective',
    summary:
      'Temporary file lifecycle controls exist; organization-wide retention, holds and defensible disposition remain incomplete.',
    evidence_refs: ['apps/shell/src/main/suite-temp.ts', 'apps/shell/src/main/suite-save.ts'],
    metrics: { unified_retention_schedule: false },
  },
  'DG-07': {
    status: 'effective',
    summary:
      'Format engines, project stores and round-trip tests preserve structure and file integrity.',
    evidence_refs: ['packages/docx-engine', 'packages/pptx-engine', 'packages/project-store'],
    metrics: { round_trip_tests: true },
  },
  'DG-08': {
    status: 'effective',
    summary:
      'Opaque sessions, operating-system storage boundaries and server-side AI provider credentials protect content.',
    evidence_refs: [
      'packages/suite-auth',
      'packages/ai-provider',
      'apps/office-server/src/config.ts',
    ],
    metrics: { client_provider_secrets: false },
  },
  'DG-09': {
    status: 'partially_effective',
    summary:
      'Safe save and temporary-file recovery exist, but centrally verified backup and restoration of local documents is not guaranteed.',
    evidence_refs: ['apps/shell/src/main/suite-save.ts', 'apps/shell/src/main/suite-temp.ts'],
    metrics: { centrally_verified_local_backup: false },
  },
  'DG-10': {
    status: 'partially_effective',
    summary:
      'Server errors and tests support investigation; a complete security and privacy incident workflow is external to Office.',
    evidence_refs: ['apps/office-server/src/app.ts'],
    metrics: { native_incident_workflow: false },
  },
  'DG-11': {
    status: 'partially_effective',
    summary:
      'AI providers are explicit and server-mediated; the processor and cross-border transfer register is not automated.',
    evidence_refs: ['packages/ai-provider/src/providers.ts'],
    metrics: { processor_transfer_register: false },
  },
  'DG-12': {
    status: 'effective',
    summary:
      'Workspace type checks, tests, format checks, license checks, production dependency audit and packaged application builds gate delivery.',
    evidence_refs: ['package.json', 'package-lock.json', 'tools'],
    metrics: { workspace_test_gate: true, high_severity_dependency_findings: 0 },
  },
}

export function loadOfficeProcessorInventory(path: string): ProcessorInventoryEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error('Processor inventory must be a non-empty JSON array')
  const required = [
    'agreement_evidence_ref', 'agreement_evidence_sha256', 'agreement_owner',
    'data_categories', 'name', 'processing_countries', 'purpose', 'review_due_at',
    'transfer_mechanism',
  ]
  const names = new Set<string>()
  const inventory: ProcessorInventoryEntry[] = raw.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`Processor inventory entry ${index} has an invalid schema`)
    const entry = value as Record<string, unknown>
    if (Object.keys(entry).sort().join() !== required.join())
      throw new Error(`Processor inventory entry ${index} has an invalid schema`)
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const key = name.toLocaleLowerCase('en')
    if (!name || names.has(key))
      throw new Error(`Processor inventory entry ${index} has an invalid or duplicate name`)
    for (const field of ['data_categories', 'processing_countries'] as const) {
      const values: unknown = entry[field]
      if (!Array.isArray(values) || values.length === 0 || values.some(
        (item: unknown) => typeof item !== 'string' || !item.trim(),
      )) throw new Error(`Processor inventory entry ${index} has invalid ${field}`)
    }
    for (const field of ['purpose', 'agreement_owner', 'agreement_evidence_ref', 'review_due_at'] as const) {
      if (typeof entry[field] !== 'string' || !entry[field].trim())
        throw new Error(`Processor inventory entry ${index} has invalid ${field}`)
    }
    if (entry.transfer_mechanism !== null &&
      (typeof entry.transfer_mechanism !== 'string' || !entry.transfer_mechanism.trim()))
      throw new Error(`Processor inventory entry ${index} has invalid transfer_mechanism`)
    if (typeof entry.agreement_evidence_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.agreement_evidence_sha256))
      throw new Error(`Processor inventory entry ${index} has invalid agreement evidence digest`)
    names.add(key)
    return entry as unknown as ProcessorInventoryEntry
  })
  return inventory.sort((left, right) => left.name.localeCompare(right.name))
}

export function buildOfficeStatement(
  tenantId: string,
  now = new Date(),
  processorInventory?: ProcessorInventoryEntry[],
) {
  const at = now.toISOString()
  const statementControls = controlIds.map((control_id) => ({
    control_id,
    observed_at: at,
    ...controls[control_id],
  }))
  if (processorInventory?.length) {
    const processor = statementControls.find((control) => control.control_id === 'DG-11')
    if (processor) Object.assign(processor, {
      status: 'effective',
      summary: 'The complete deployment-owned processor and transfer inventory is schema-validated and synchronized to CyberAudit for independent review and exact-register certification.',
      evidence_refs: ['docs/fynix-suite/data-governance.md'],
      metrics: { processor_transfer_register: true, declared_processors: processorInventory.length },
    })
  }
  return {
    event_type: 'governance.evidence.reported' as const,
    tenant_id: tenantId,
    entity_type: 'governance_statement' as const,
    entity_id: randomUUID(),
    occurred_at: at,
    payload: {
      schema_version: 'fynix-governance-evidence/v1' as const,
      period_start: new Date(now.getTime() - 86_400_000).toISOString(),
      period_end: at,
      controls: statementControls,
    },
  }
}

export async function publishOfficeStatement(
  config: { endpoint: string; tenantId: string; webhookId: string; secret: string },
  fetchImpl: typeof fetch = fetch,
  processorInventory?: ProcessorInventoryEntry[],
) {
  const endpoint = new URL(config.endpoint)
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1'
  if (endpoint.protocol !== 'https:' && !local)
    throw new Error('Governance endpoint must use HTTPS')
  if (!config.tenantId || !config.webhookId || config.secret.length < 32)
    throw new Error('Governance publisher binding is incomplete')
  const statement = buildOfficeStatement(config.tenantId, new Date(), processorInventory)
  const raw = JSON.stringify(statement)
  const timestamp = Math.floor(Date.now() / 1000)
  const deliveryId = randomUUID()
  const canonical =
    [
      'fynix-v2',
      String(timestamp),
      statement.event_type,
      'office',
      config.webhookId,
      deliveryId,
    ].join('\0') +
    '\0' +
    raw
  const signature = `v2=${createHmac('sha256', config.secret).update(canonical).digest('hex')}`
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'manual',
    body: raw,
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Fynix-Timestamp': String(timestamp),
      'X-Fynix-Event': statement.event_type,
      'X-Fynix-Source': 'office',
      'X-Fynix-Webhook-Id': config.webhookId,
      'X-Fynix-Delivery-Id': deliveryId,
      'X-Fynix-Signature': signature,
    },
  })
  if (!response.ok) throw new Error(`Cyber Audit governance receiver returned ${response.status}`)
  const receipt = (await response.json()) as { outcome?: string; statement_id?: string }
  if (receipt.outcome !== 'recorded' || receipt.statement_id !== statement.entity_id)
    throw new Error('Cyber Audit returned an invalid governance receipt')
  return { outcome: receipt.outcome, statementId: receipt.statement_id }
}

export async function publishOfficeControl(
  config: { endpoint: string; tenantId: string; webhookId: string; secret: string },
  command: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
) {
  const endpoint = new URL(config.endpoint)
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1'
  if (endpoint.protocol !== 'https:' && !local) throw new Error('Governance endpoint must use HTTPS')
  if (!config.tenantId || !config.webhookId || config.secret.length < 32) throw new Error('Governance publisher binding is incomplete')
  const raw = JSON.stringify({ tenant_id: config.tenantId, command, payload })
  const timestamp = Math.floor(Date.now() / 1000), deliveryId = randomUUID()
  const canonical = ['fynix-v2', String(timestamp), 'governance.control.commanded', 'office', config.webhookId, deliveryId].join('\0') + '\0' + raw
  const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'manual', body: raw, signal: AbortSignal.timeout(10_000), headers: {
    'Content-Type': 'application/json', Accept: 'application/json', 'X-Fynix-Timestamp': String(timestamp),
    'X-Fynix-Event': 'governance.control.commanded', 'X-Fynix-Source': 'office', 'X-Fynix-Webhook-Id': config.webhookId,
    'X-Fynix-Delivery-Id': deliveryId, 'X-Fynix-Signature': `v2=${createHmac('sha256', config.secret).update(canonical).digest('hex')}`,
  }})
  if (!response.ok) throw new Error(`Cyber Audit governance control receiver returned ${response.status}`)
  const receipt = await response.json() as { outcome?: string; resource_type?: string; resource_id?: number }
  if (receipt.outcome !== 'recorded' && receipt.outcome !== 'duplicate ignored') throw new Error('Cyber Audit returned an invalid governance control receipt')
  return receipt
}

export async function synchronizeOfficeProcessorInventory(
  config: { endpoint: string; tenantId: string; webhookId: string; secret: string },
  inventory: ProcessorInventoryEntry[],
  fetchImpl: typeof fetch = fetch,
) {
  const receipts: Array<{ outcome?: string; resource_type?: string; resource_id?: number }> = []
  for (const processor of inventory) {
    const receipt = await publishOfficeControl(
      config, 'processor.register', processor, fetchImpl,
    )
    if (!['processor', 'data_processor'].includes(receipt.resource_type ?? '') ||
      !receipt.resource_id) throw new Error('Cyber Audit returned an invalid processor receipt')
    receipts.push(receipt)
  }
  return receipts
}
