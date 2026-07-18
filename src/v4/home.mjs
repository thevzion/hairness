import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { API, validateDocument, validateLocalConfig } from './contracts.mjs'
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
  const home = await validateDocument(await readJson(join(root, 'hairness.json')), 'Home')
  assertUnique(home.spec.targets, 'Target')
  assertUnique(home.spec.integrations, 'Integration')
  const active = new Set(home.spec.extensions)
  const stale = Object.keys(home.spec.config).filter((id) => !active.has(id))
  if (stale.length) throw new HairnessError('config_owner_inactive', `Config belongs to inactive extensions: ${stale.join(', ')}.`)
  return home
}

export async function loadHomeLock(root) {
  root ??= await findHome()
  return validateDocument(await readJson(join(root, 'hairness.lock.json')), 'HomeLock')
}

export async function loadLocalConfig(root) {
  return validateLocalConfig(await readJson(join(root, '.overlay', 'config.json')))
}

export function homeId(destination) {
  const name = basename(resolve(destination)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return assertId(name || `home-${digest(resolve(destination)).slice(7, 15)}`, 'Home id')
}

export function homeDocument(id, providers = ['codex', 'claude']) {
  return {
    apiVersion: API.home,
    kind: 'Home',
    metadata: { id: assertId(id, 'Home id') },
    spec: { providers: [...new Set(providers)], extensions: [], targets: [], integrations: [], config: {} },
  }
}

export function homeLockDocument(id, kernel) {
  return {
    apiVersion: API.homeLock,
    kind: 'HomeLock',
    metadata: { id },
    kernel,
    extensions: [],
  }
}

export function localConfigDocument(preferences = {}) {
  return {
    version: 1,
    preferences: Object.fromEntries(Object.entries(preferences).filter(([, value]) => typeof value === 'string' && value.trim())),
    integrationBindings: {},
  }
}

function assertUnique(values, label) {
  const ids = values.map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) throw new HairnessError('document_invalid', `${label} ids must be unique.`)
}
