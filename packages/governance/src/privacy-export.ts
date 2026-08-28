import { buildOfficeSuitePrivacyExport, writePrivateOfficeExport } from './privacy.js'
import { publishOfficeControl } from './index.js'

const required = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const config = {
  endpoint: required('OFFICE_GOVERNANCE_ENDPOINT'),
  tenantId: required('OFFICE_GOVERNANCE_TENANT_ID'),
  webhookId: required('OFFICE_GOVERNANCE_WEBHOOK_ID'),
  secret: required('OFFICE_GOVERNANCE_SECRET'),
}
const subject = required('OFFICE_PRIVACY_SUBJECT')
const identityEvidence = required('OFFICE_PRIVACY_IDENTITY_EVIDENCE_REF')
if (!identityEvidence.startsWith('urn:fynix:') && !identityEvidence.startsWith('evidence://'))
  throw new Error('identity evidence must be a controlled reference')
const opened = await publishOfficeControl(config, 'privacy_request.open', {
  subject_ref: subject,
  right: 'access',
  lawful_basis: 'data_subject_request',
})
if (typeof opened.resource_id !== 'number')
  throw new Error('CyberAudit did not return a privacy request id')
let userDataDirs: unknown
try {
  userDataDirs = JSON.parse(required('OFFICE_USER_DATA_DIRS'))
} catch {
  throw new Error(
    'OFFICE_USER_DATA_DIRS must be a JSON object of application names to data directories',
  )
}
if (!userDataDirs || Array.isArray(userDataDirs) || typeof userDataDirs !== 'object')
  throw new Error(
    'OFFICE_USER_DATA_DIRS must be a JSON object of application names to data directories',
  )
const document = buildOfficeSuitePrivacyExport(
  Object.fromEntries(
    Object.entries(userDataDirs).map(([name, path]) => {
      if (typeof path !== 'string' || !path.trim())
        throw new Error(`invalid user data directory for ${name}`)
      return [name, path]
    }),
  ),
  subject,
)
document.identity_verification_ref = identityEvidence
const output = required('OFFICE_PRIVACY_OUTPUT')
const digest = writePrivateOfficeExport(output, document)
await publishOfficeControl(config, 'privacy_request.close', {
  privacy_request_id: opened.resource_id,
  evidence_ref: `urn:fynix:office:privacy-access:${subject.toLowerCase()}`,
  evidence_sha256: digest,
})
process.stdout.write(`privacy_export=${output} sha256=${digest}\n`)
