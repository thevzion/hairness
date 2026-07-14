import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { loadHome } from '../home/index.mjs'
import { readJson, writeJsonAtomic } from '../lib/io.mjs'

export function userRoot() {
  return resolve(process.env.HAIRNESS_STATE_HOME ?? join(homedir(), '.hairness'))
}

export function userPaths() {
  const root = userRoot()
  return {
    root,
    preferences: join(root, 'preferences'),
    trust: join(root, 'trust'),
    archives: join(root, 'archives'),
    runtime: join(root, 'runtime'),
  }
}

export function runtimePaths(id) {
  const root = join(userPaths().runtime, id)
  return {
    root,
    build: join(root, 'build.json'),
    providers: join(root, 'providers'),
    targets: join(root, 'targets'),
    targetBindings: join(root, 'targets', 'bindings.json'),
    checkouts: join(root, 'checkouts'),
    checkpoints: join(root, 'checkpoints'),
    locks: join(root, 'locks'),
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
    logs: join(root, 'logs'),
  }
}

export async function ensureRuntime(home) {
  const document = typeof home === 'string' ? await loadHome(home) : home
  const paths = runtimePaths(document.metadata.id)
  await Promise.all(['providers', 'targets', 'checkouts', 'checkpoints', 'locks', 'cache', 'tmp', 'logs'].map((key) => mkdir(paths[key], { recursive: true })))
  return paths
}

export async function targetBindings(home) {
  const document = typeof home === 'string' ? await loadHome(home) : home
  const paths = await ensureRuntime(document)
  return readJson(paths.targetBindings, { home: document.metadata.id, targets: {} })
}

export async function bindTarget(home, id, path) {
  const document = typeof home === 'string' ? await loadHome(home) : home
  const bindings = await targetBindings(document)
  bindings.targets[id] = { path: resolve(path), boundAt: new Date().toISOString() }
  await writeJsonAtomic(runtimePaths(document.metadata.id).targetBindings, bindings)
  return bindings.targets[id]
}

