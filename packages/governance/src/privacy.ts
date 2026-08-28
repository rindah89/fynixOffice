import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  constants,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const ROOT_FILES = new Set([
  'app-settings.json',
  'cloud-projects.json',
  'recent.json',
  'slides-recent.json',
  'starred.json',
  'ai-settings.json',
])
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_EXPORT_BYTES = 64 * 1024 * 1024

export type OfficePrivacyExport = {
  schema: 'fynix.office.privacy-access-export/v1'
  subject_ref: string
  generated_at: string
  surface_manifest: string[]
  records: Record<string, unknown>
  exclusions: string[]
  identity_verification_ref?: string
}

function safeJson(path: string): unknown {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES)
    throw new Error(`unsafe or oversized privacy surface: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /(?:api[-_]?key|secret|token|password|credential)/i.test(key)
        ? '[excluded-secret]'
        : redactSecrets(item),
    ]),
  )
}

function projectFiles(root: string): string[] {
  const base = join(root, 'projects')
  if (!existsSync(base)) return []
  const found: string[] = []
  const visit = (directory: string) => {
    const metadata = lstatSync(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error('projects privacy surface must be a real directory')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`symlink is not allowed in privacy surface: ${path}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')))
        found.push(path)
    }
  }
  visit(base)
  return found.sort()
}

export function discoverOfficePrivacyFiles(userDataDir: string): { root: string; files: string[] } {
  const root = resolve(userDataDir)
  const metadata = lstatSync(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('user data path must be a real directory')
  return {
    root,
    files: [
      ...[...ROOT_FILES].map((name) => join(root, name)).filter(existsSync),
      ...projectFiles(root),
    ].sort(),
  }
}

function assertInside(root: string, path: string): string {
  const name = relative(root, path)
  if (!name || name.startsWith(`..${sep}`) || name === '..')
    throw new Error('privacy path escaped user data')
  return name.split(sep).join('/')
}

export function buildOfficePrivacyExport(
  userDataDir: string,
  subjectRef: string,
  now = new Date(),
): OfficePrivacyExport {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subjectRef)
  )
    throw new Error('privacy subject must be a canonical UUID')
  const { root, files } = discoverOfficePrivacyFiles(userDataDir)
  const records: Record<string, unknown> = {}
  let bytes = 0
  for (const file of files.sort()) {
    bytes += lstatSync(file).size
    if (bytes > MAX_EXPORT_BYTES) throw new Error('privacy export exceeds the bounded size limit')
    const name = assertInside(root, file)
    if (file.endsWith('.jsonl')) {
      records[name] = readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => redactSecrets(JSON.parse(line) as unknown))
    } else records[name] = redactSecrets(safeJson(file))
  }
  return {
    schema: 'fynix.office.privacy-access-export/v1',
    subject_ref: subjectRef.toLowerCase(),
    generated_at: now.toISOString(),
    surface_manifest: Object.keys(records).sort(),
    records,
    exclusions: ['api keys', 'passwords', 'tokens', 'credentials', 'document file contents'],
  }
}

export function buildOfficeSuitePrivacyExport(
  userDataDirs: Record<string, string>,
  subjectRef: string,
  now = new Date(),
): OfficePrivacyExport {
  const entries = Object.entries(userDataDirs)
  if (entries.length === 0) throw new Error('at least one Office user data surface is required')
  const records: Record<string, unknown> = {}
  const exclusions = new Set<string>()
  for (const [surface, directory] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(surface))
      throw new Error(`invalid Office privacy surface name: ${surface}`)
    const document = buildOfficePrivacyExport(directory, subjectRef, now)
    for (const [name, value] of Object.entries(document.records)) {
      records[`${surface}/${name}`] = value
    }
    document.exclusions.forEach((value) => exclusions.add(value))
  }
  return {
    schema: 'fynix.office.privacy-access-export/v1',
    subject_ref: subjectRef.toLowerCase(),
    generated_at: now.toISOString(),
    surface_manifest: Object.keys(records).sort(),
    records,
    exclusions: [...exclusions].sort(),
  }
}

export function writePrivateOfficeExport(path: string, document: OfficePrivacyExport): string {
  const encoded = `${JSON.stringify(document, null, 2)}\n`
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
      throw new Error('privacy export must be an owner-only regular file')
    writeFileSync(descriptor, encoded, 'utf8')
  } finally {
    closeSync(descriptor)
  }
  return createHash('sha256').update(encoded).digest('hex')
}
