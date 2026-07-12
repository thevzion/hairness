import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { HairnessError } from '../errors.mjs'
import { readJson, workspacePaths, writeJsonAtomic } from '../io.mjs'

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child)
  return Object.freeze(value)
}

function safeStatePath(root, extensionId, key = '.') {
  const base = resolve(workspacePaths(root).overlay, 'extensions-state', ...extensionId.split('/'))
  const target = resolve(base, key)
  const path = relative(base, target)
  if (path.startsWith('..') || path === '') {
    if (path === '') return { base, target }
    throw new HairnessError('extension_overlay_escape', `Extension state path escapes ${extensionId}.`, { exitCode: 2 })
  }
  return { base, target }
}

export function createExtensionRuntime({ root, extensionId, bindings }) {
  const overlay = {
    async read(key, fallback = null) {
      return readJson(safeStatePath(root, extensionId, key).target, fallback)
    },
    async write(key, value) {
      const { target } = safeStatePath(root, extensionId, key)
      await writeJsonAtomic(target, value)
      return value
    },
    async append(key, value) {
      const { target } = safeStatePath(root, extensionId, key)
      await mkdir(dirname(target), { recursive: true })
      await appendFile(target, `${JSON.stringify(value)}\n`, { mode: 0o600 })
      return value
    },
    async lines(key) {
      const { target } = safeStatePath(root, extensionId, key)
      try { return (await readFile(target, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)) }
      catch (error) { if (error.code === 'ENOENT') return []; throw error }
    },
    async remove(key) {
      const { target } = safeStatePath(root, extensionId, key)
      await rm(target, { recursive: true, force: true })
    },
    async list(key = '.') {
      const { target } = safeStatePath(root, extensionId, key)
      await mkdir(target, { recursive: true })
      return readdir(target)
    },
  }
  return freeze({ ...bindings, overlay })
}
