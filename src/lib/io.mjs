import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { HairnessError } from './errors.mjs'

export function now() {
  return new Date().toISOString()
}

export function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : stableJson(value))
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback
    if (error instanceof SyntaxError) throw new HairnessError('invalid_json', `Invalid JSON at ${path}.`, { cause: error })
    throw error
  }
}

export async function writeJsonAtomic(path, value, mode = 0o600) {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, mode)
}

export async function writeFileAtomic(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, value, { mode })
  await rename(temporary, path)
}

export async function writeJsonExclusive(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true })
  let handle
  try {
    handle = await open(path, 'wx', mode)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
  } catch (error) {
    if (error.code === 'EEXIST') throw new HairnessError('record_exists', `Immutable record already exists: ${path}.`)
    throw error
  } finally {
    await handle?.close()
  }
}

export async function replaceDirectory(staging, destination) {
  if (await exists(destination)) throw new HairnessError('destination_exists', `Destination already exists: ${destination}`)
  await mkdir(dirname(destination), { recursive: true })
  await rename(staging, destination)
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true })
}

export function assertId(value, label = 'id') {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(String(value ?? '')) || String(value).includes('..')) {
    throw new HairnessError('invalid_id', `Invalid ${label}: ${value}`)
  }
  return value
}

export function assertInside(root, candidate, label = 'path') {
  const base = resolve(root)
  const target = resolve(candidate)
  const rel = relative(base, target)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new HairnessError('path_escape', `${label} escapes ${base}.`)
  return target
}

export async function treeDigest(root, options = {}) {
  const base = await realpath(root)
  const excluded = new Set(options.exclude ?? ['.git', 'node_modules'])
  const entries = []

  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name)) continue
      const path = resolve(directory, entry.name)
      const rel = relative(base, path).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        const target = await realpath(path)
        assertInside(base, target, `symlink ${rel}`)
        throw new HairnessError('symlink_forbidden', `Symbolic links are not installable extension source: ${rel}.`)
      }
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) entries.push([rel, digest(await readFile(path))])
    }
  }

  await visit(base)
  return digest(entries)
}

export async function copyTree(source, destination) {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (path) => !relative(source, path).split(sep).some((part) => part === '.git' || part === 'node_modules'),
  })
}
