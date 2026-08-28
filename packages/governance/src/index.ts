import { createHmac, randomUUID } from 'node:crypto'

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
      'AI requests are bounded and provider-aware; a complete privacy rights and processing-purpose register is not automated.',
    evidence_refs: ['packages/ai-provider', 'apps/office-server/src/ai-routes.ts'],
    metrics: { privacy_register: false },
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

export function buildOfficeStatement(tenantId: string, now = new Date()) {
  const at = now.toISOString()
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
      controls: controlIds.map((control_id) => ({
        control_id,
        observed_at: at,
        ...controls[control_id],
      })),
    },
  }
}

export async function publishOfficeStatement(
  config: { endpoint: string; tenantId: string; webhookId: string; secret: string },
  fetchImpl: typeof fetch = fetch,
) {
  const endpoint = new URL(config.endpoint)
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1'
  if (endpoint.protocol !== 'https:' && !local)
    throw new Error('Governance endpoint must use HTTPS')
  if (!config.tenantId || !config.webhookId || config.secret.length < 32)
    throw new Error('Governance publisher binding is incomplete')
  const statement = buildOfficeStatement(config.tenantId)
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
