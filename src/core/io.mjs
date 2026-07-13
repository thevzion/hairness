import { appendFile, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { HairnessError } from './errors.mjs'

export const SCHEMA_VERSION = 2
export const PROTOCOL_VERSION = '0.2'

export async function findWorkspaceRoot(start = process.env.HAIRNESS_ROOT ?? process.cwd()) {
  let current = resolve(start)
  while (true) {
    try {
      await readFile(join(current, 'hairness.json'))
      return current
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new HairnessError('workspace_not_found', 'No hairness.json found from the current directory.', {
        exitCode: 2,
        routes: ['hairness onboarding next'],
      })
    }
    current = parent
  }
}

export function workspacePaths(root) {
  const overlay = join(root, '.overlay')
  return {
    root,
    overlay,
    config: join(overlay, 'config.json'),
    runs: join(overlay, 'runs'),
    invocations: join(overlay, 'invocations'),
    plans: join(overlay, 'runs', '.plans'),
    artifacts: join(overlay, 'artifacts'),
    staging: join(overlay, 'artifacts', '.staging'),
    scratch: join(overlay, 'scratch'),
    extensions: join(overlay, 'extensions'),
    build: join(overlay, 'build'),
  }
}

export function userPaths() {
  const root = resolve(process.env.HAIRNESS_HOME ?? join(homedir(), '.hairness'))
  return {
    root,
    trust: join(root, 'trust.json'),
    hosts: join(root, 'hosts.json'),
    preferences: join(root, 'preferences.json'),
    creates: join(root, 'creates'),
    locks: join(root, 'locks'),
  }
}

export async function ensureOverlay(root) {
  const paths = workspacePaths(root)
  await Promise.all([
    paths.runs,
    paths.invocations,
    paths.plans,
    paths.staging,
    paths.scratch,
    paths.extensions,
    paths.build,
  ].map((path) => mkdir(path, { recursive: true })))
  return paths
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback
    if (error instanceof SyntaxError) {
      throw new HairnessError('invalid_json', `Invalid JSON at ${path}.`, { exitCode: 2, cause: error })
    }
    throw error
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export async function appendJsonLine(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

export async function createJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
  } finally {
    await handle.close()
  }
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true })
}

export async function canonicalPath(path) {
  return realpath(resolve(path))
}

export async function canonicalTarget(target) {
  const value = String(target ?? '')
  if (!value) throw new HairnessError('target_invalid', 'Target must not be empty.', { exitCode: 2 })
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    let url
    try { url = new URL(value) }
    catch (error) { throw new HairnessError('target_invalid', `Invalid target URI: ${value}`, { exitCode: 2, cause: error }) }
    if (url.username || url.password) throw new HairnessError('target_credentials_forbidden', 'Target URIs must not contain credentials.', { exitCode: 2 })
    if (url.search) throw new HairnessError('target_query_forbidden', 'Target URIs must not contain query parameters.', { exitCode: 2 })
    if (url.hash) throw new HairnessError('target_fragment_forbidden', 'Target URIs must not contain fragments.', { exitCode: 2 })
    return url.href
  }
  try { return await canonicalPath(value) }
  catch (error) { if (error.code === 'ENOENT') return resolve(value); throw error }
}

export function assertSafeId(value, label = 'id') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new HairnessError('invalid_id', `Invalid ${label}: ${value}`, { exitCode: 2 })
  }
  return value
}

export function now() {
  return new Date().toISOString()
}
