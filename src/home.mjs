import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, validateDocument, validateLocalConfig } from './contracts.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertId, digest, readJson, writeJsonAtomic } from './lib/io.mjs'

const packageDocument = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
export const RUNTIME = `@hairness/cli@${packageDocument.version}`

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
  home.targets ??= []
  home.integrations ??= []
  home.config ??= {}
  unique(home.targets.map((entry) => entry.id), 'Target ids')
  unique(home.integrations.map((entry) => entry.id), 'Integration ids')
  return home
}

export async function assertRuntime(root) {
  const home = await loadHome(root)
  if (home.runtime !== RUNTIME) {
    throw new HairnessError('runtime_mismatch', `This Home requires ${home.runtime}; run npx --yes ${home.runtime} instead.`, { exitCode: 3 })
  }
  return home
}

export async function loadLocalConfig(root) {
  return validateLocalConfig(await readJson(join(root, '.overlay', 'config.json'), localConfigDocument()))
}

export function homeId(destination) {
  const name = basename(resolve(destination)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return assertId(name || `home-${digest(resolve(destination)).slice(7, 15)}`, 'Home id')
}

export function homeDocument(options = {}) {
  const targets = options.targets ?? []
  const integrations = options.integrations ?? []
  const config = options.config ?? {}
  return {
    $schema: API.home,
    name: assertId(options.name ?? homeId(options.destination ?? process.cwd()), 'Home name'),
    runtime: RUNTIME,
    providers: [...new Set(options.providers ?? ['codex', 'claude'])],
    ...(targets.length ? { targets } : {}),
    ...(integrations.length ? { integrations } : {}),
    ...(Object.keys(config).length ? { config } : {}),
  }
}

export async function saveHome(root, home) {
  const document = homeDocument({
    name: home.name,
    providers: home.providers,
    targets: home.targets,
    integrations: home.integrations,
    config: home.config,
  })
  document.runtime = home.runtime
  await writeJsonAtomic(join(root, 'hairness.json'), document, 0o644)
  return document
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
