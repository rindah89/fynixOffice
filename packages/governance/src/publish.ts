import { publishOfficeControl, publishOfficeStatement } from './index.js'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const config = {
  endpoint: required('OFFICE_GOVERNANCE_ENDPOINT'),
  tenantId: required('OFFICE_GOVERNANCE_TENANT_ID'),
  webhookId: required('OFFICE_GOVERNANCE_WEBHOOK_ID'),
  secret: required('OFFICE_GOVERNANCE_SECRET'),
}
const receipt = process.env.OFFICE_GOVERNANCE_COMMAND
  ? await publishOfficeControl(config, process.env.OFFICE_GOVERNANCE_COMMAND, JSON.parse(process.env.OFFICE_GOVERNANCE_PAYLOAD || '{}'))
  : await publishOfficeStatement(config)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
