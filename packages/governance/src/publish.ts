import {
  loadOfficeProcessorInventory,
  publishOfficeControl,
  publishOfficeStatement,
  synchronizeOfficeProcessorInventory,
} from './index.js'

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
const inventory = process.env.OFFICE_PROCESSOR_INVENTORY_FILE
  ? loadOfficeProcessorInventory(process.env.OFFICE_PROCESSOR_INVENTORY_FILE)
  : undefined
if (inventory && !process.env.OFFICE_GOVERNANCE_COMMAND) {
  await synchronizeOfficeProcessorInventory({
    ...config,
    endpoint: required('OFFICE_GOVERNANCE_CONTROL_ENDPOINT'),
  }, inventory)
}
const payload: unknown = JSON.parse(process.env.OFFICE_GOVERNANCE_PAYLOAD || '{}')
if (!payload || typeof payload !== 'object' || Array.isArray(payload))
  throw new Error('OFFICE_GOVERNANCE_PAYLOAD must be a JSON object')
const receipt = process.env.OFFICE_GOVERNANCE_COMMAND
  ? await publishOfficeControl(
      config,
      process.env.OFFICE_GOVERNANCE_COMMAND,
      payload as Record<string, unknown>,
    )
  : await publishOfficeStatement(config, fetch, inventory)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
