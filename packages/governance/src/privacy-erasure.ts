import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { discoverOfficePrivacyFiles } from './privacy.js'

export type OfficeErasureReceipt = {
  schema: 'fynix.office.privacy-erasure/v1'
  privacy_request_id: number
  subject_ref: string
  completed_at: string
  affected_files: string[]
  retained_exceptions: string[]
  evidence_ref: string
  evidence_sha256: string
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function loadActiveOfficePrivacyHolds(path: string | undefined): Set<string> {
  if (!path) return new Set()
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string' || !canonicalUuid.test(value)))
    throw new Error('Office privacy hold file must be an array of canonical UUIDs')
  return new Set(raw.map((value) => String(value).toLowerCase()))
}

export function eraseOfficeSuitePrivacyData(
  userDataDirs: Record<string, string>,
  subjectRef: string,
  privacyRequestId: number,
  activeHolds: Set<string>,
  now = new Date(),
): OfficeErasureReceipt {
  const subject = subjectRef.toLowerCase()
  if (!canonicalUuid.test(subject)) throw new Error('privacy subject must be a canonical UUID')
  if (!Number.isSafeInteger(privacyRequestId) || privacyRequestId < 1)
    throw new Error('privacy request id must be a positive integer')
  if (activeHolds.has(subject)) throw new Error('Office privacy erasure is blocked by an active legal hold')
  const surfaces = Object.entries(userDataDirs).sort(([left], [right]) => left.localeCompare(right))
  if (surfaces.length === 0) throw new Error('at least one Office user data surface is required')

  const plans = surfaces.map(([surface, directory]) => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(surface))
      throw new Error(`invalid Office privacy surface name: ${surface}`)
    const discovered = discoverOfficePrivacyFiles(directory)
    const staging = join(discovered.root, `.privacy-erasure-${privacyRequestId}-${randomUUID()}`)
    if (existsSync(staging)) throw new Error('privacy erasure staging path already exists')
    const receiptPath = join(discovered.root, `.privacy-erasure-receipt-${privacyRequestId}.json`)
    if (existsSync(receiptPath)) throw new Error('privacy erasure receipt already exists')
    return { surface, ...discovered, staging, receiptPath }
  })

  const moved: Array<{ from: string; to: string }> = []
  try {
    for (const plan of plans) {
      mkdirSync(plan.staging, { mode: 0o700 })
      for (const file of plan.files) {
        const metadata = lstatSync(file)
        if (!metadata.isFile() || metadata.isSymbolicLink())
          throw new Error(`unsafe privacy erasure surface: ${file}`)
        const name = relative(plan.root, file)
        if (!name || name === '..' || name.startsWith(`..${sep}`))
          throw new Error('privacy erasure path escaped user data')
        const destination = join(plan.staging, name)
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
        renameSync(file, destination)
        moved.push({ from: file, to: destination })
      }
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      if (existsSync(item.to)) {
        mkdirSync(dirname(item.from), { recursive: true })
        renameSync(item.to, item.from)
      }
    }
    for (const plan of plans) if (existsSync(plan.staging)) rmSync(plan.staging, { recursive: true })
    throw error
  }

  const affectedFiles = plans.flatMap((plan) =>
    plan.files.map((file) => `${plan.surface}/${relative(plan.root, file).split(sep).join('/')}`),
  ).sort()
  const evidence = {
    schema: 'fynix.office.privacy-erasure/v1' as const,
    privacy_request_id: privacyRequestId,
    subject_ref: subject,
    completed_at: now.toISOString(),
    affected_files: affectedFiles,
    retained_exceptions: ['user document contents governed by owning workspace records policy'],
  }
  const evidenceSha256 = createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
  const evidenceRef = `urn:fynix:office:privacy-erasure:${privacyRequestId}`
  const receipt = { ...evidence, evidence_ref: evidenceRef, evidence_sha256: evidenceSha256 }
  const writtenReceipts: string[] = []
  try {
    for (const plan of plans) {
      writeFileSync(plan.receiptPath, `${JSON.stringify(receipt)}\n`, {
        encoding: 'utf8', mode: 0o600, flag: 'wx',
      })
      writtenReceipts.push(plan.receiptPath)
    }
  } catch (error) {
    for (const path of writtenReceipts) if (existsSync(path)) unlinkSync(path)
    for (const item of moved.reverse()) {
      if (existsSync(item.to)) {
        mkdirSync(dirname(item.from), { recursive: true })
        renameSync(item.to, item.from)
      }
    }
    for (const plan of plans) if (existsSync(plan.staging)) rmSync(plan.staging, { recursive: true })
    throw error
  }
  for (const plan of plans) rmSync(plan.staging, { recursive: true })
  return receipt
}
