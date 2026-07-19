import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { API, validateDocument, validateLocalConfig } from './contracts.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertId, digest, readJson } from './lib/io.mjs'

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
  const home = await validateDocument(await readJson(join(root, 'hairness.json')), 'home')
  unique(home.spec.extensions.map((entry) => entry.package), 'Extension packages')
  unique(home.spec.catalogs.map((entry) => entry.id), 'Catalog ids')
  unique(home.spec.targets.map((entry) => entry.id), 'Target ids')
  unique(home.spec.integrations.map((entry) => entry.id), 'Integration ids')
  const active = new Set(home.spec.extensions.map((entry) => entry.package))
  const stale = Object.keys(home.spec.config).filter((name) => !active.has(name))
  if (stale.length) throw new HairnessError('config_owner_inactive', `Config belongs to inactive extensions: ${stale.join(', ')}.`)
  return home
}

export async function loadLocalConfig(root) {
  return validateLocalConfig(await readJson(join(root, '.overlay', 'config.json')))
}

export function homeId(destination) {
  const name = basename(resolve(destination)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return assertId(name || `home-${digest(resolve(destination)).slice(7, 15)}`, 'Home id')
}

export function homeDocument(id, starter, providers, extensions, catalogs = [], config = {}, targets = [], integrations = []) {
  return {
    apiVersion: API.home,
    kind: 'Home',
    metadata: { id: assertId(id, 'Home id') },
    spec: {
      starter,
      providers: [...new Set(providers)],
      extensions,
      catalogs,
      targets,
      integrations,
      config,
    },
  }
}

export function localConfigDocument(preferences = {}) {
  return {
    version: 1,
    preferences: Object.fromEntries(Object.entries(preferences).filter(([, value]) => typeof value === 'string' && value.trim())),
    integrationBindings: {},
  }
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new HairnessError('document_invalid', `${label} must be unique.`)
}
