import { publishOfficeStatement } from './index.js'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const receipt = await publishOfficeStatement({
  endpoint: required('OFFICE_GOVERNANCE_ENDPOINT'),
  tenantId: required('OFFICE_GOVERNANCE_TENANT_ID'),
  webhookId: required('OFFICE_GOVERNANCE_WEBHOOK_ID'),
  secret: required('OFFICE_GOVERNANCE_SECRET'),
})
process.stdout.write(`${JSON.stringify(receipt)}\n`)
