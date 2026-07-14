import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { API, validateDocument } from '../contracts/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertId, digest, readJson } from '../lib/io.mjs'

export async function findHome(start = process.env.HAIRNESS_HOME_PATH ?? process.cwd()) {
  let current = resolve(start)
  while (true) {
    try {
      await readFile(join(current, 'hairness.json'))
      return current
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) throw new HairnessError('home_not_found', 'No hairness.json found from the current directory.')
    current = parent
  }
}

export async function loadHome(root) {
  root ??= await findHome()
  const home = await readJson(join(root, 'hairness.json'))
  await validateDocument(home, 'Home')
  return home
}

export async function loadHomeLock(root) {
  root ??= await findHome()
  const lock = await readJson(join(root, 'hairness.lock.json'))
  return validateDocument(lock, 'HomeLock')
}

export function homeId(destination) {
  const name = basename(resolve(destination)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return assertId(name || `home-${digest(resolve(destination)).slice(7, 15)}`, 'Home id')
}

export function homeDocument(options) {
  const extensions = [...new Set(options.extensions)]
  const targets = (options.targets ?? []).map(({ id, kind = 'git', summary, requirement = 'recommended', remotes = [] }) => ({
    id: assertId(id, 'Target id'),
    kind,
    summary: summary ?? id,
    requirement,
    remotes: [...new Set(remotes)],
  }))
  return {
    apiVersion: API.home,
    kind: 'Home',
    metadata: { id: assertId(options.id, 'Home id') },
    spec: {
      providers: [...new Set(options.providers)],
      extensions,
      targets,
      config: structuredClone(options.config ?? {}),
      overlay: { git: Boolean(options.overlayGit), snapshot: options.snapshot ?? 'boundary' },
    },
  }
}

export function homeLockDocument(options) {
  return {
    apiVersion: API.home,
    kind: 'HomeLock',
    metadata: { id: options.id },
    distribution: options.distribution,
    extensions: options.extensions,
  }
}
