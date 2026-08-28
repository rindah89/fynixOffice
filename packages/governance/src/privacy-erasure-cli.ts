import { eraseOfficeSuitePrivacyData, loadActiveOfficePrivacyHolds } from './privacy-erasure.js'
import { publishOfficeControl } from './index.js'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const subject = required('OFFICE_PRIVACY_SUBJECT')
const identityEvidence = required('OFFICE_PRIVACY_IDENTITY_EVIDENCE_REF')
if (!/^(urn:fynix:|evidence:\/\/)[A-Za-z0-9._:/-]+$/.test(identityEvidence))
  throw new Error('identity verification reference must be controlled evidence')
const surfaces: unknown = JSON.parse(required('OFFICE_USER_DATA_DIRS'))
if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces))
  throw new Error('OFFICE_USER_DATA_DIRS must be a JSON object')
const config = {
  endpoint: required('OFFICE_GOVERNANCE_CONTROL_ENDPOINT'),
  tenantId: required('OFFICE_GOVERNANCE_TENANT_ID'),
  webhookId: required('OFFICE_GOVERNANCE_WEBHOOK_ID'),
  secret: required('OFFICE_GOVERNANCE_SECRET'),
}
const opened = await publishOfficeControl(config, 'privacy_request.open', {
  subject_ref: subject,
  right: 'erasure',
  lawful_basis: required('OFFICE_PRIVACY_LAWFUL_BASIS'),
})
if (!opened.resource_id) throw new Error('CyberAudit did not return a privacy request id')
const receipt = eraseOfficeSuitePrivacyData(
  surfaces as Record<string, string>,
  subject,
  opened.resource_id,
  loadActiveOfficePrivacyHolds(process.env.OFFICE_PRIVACY_HOLD_FILE),
)
await publishOfficeControl(config, 'privacy_request.close', {
  privacy_request_id: opened.resource_id,
  evidence_ref: receipt.evidence_ref,
  evidence_sha256: receipt.evidence_sha256,
})
process.stdout.write(`privacy_request_id=${opened.resource_id} sha256=${receipt.evidence_sha256}\n`)
