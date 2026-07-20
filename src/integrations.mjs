import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadHome, loadLocalConfig } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertId, writeJsonAtomic } from './lib/io.mjs'

const exec = promisify(execFile)

export async function listIntegrations(root) {
  const home = await loadHome(root)
  const config = await loadLocalConfig(root)
  return home.integrations.map((integration) => ({
    ...integration,
    bindings: config.integrationBindings[integration.id] ?? {},
  }))
}

export async function addIntegration(root, id, accessors, summary) {
  const home = await loadHome(root)
  assertId(id, 'Integration id')
  if (home.integrations.some((entry) => entry.id === id)) throw new HairnessError('integration_exists', `Integration ${id} already exists.`)
  if (!accessors.length) throw new HairnessError('usage', 'At least one Integration accessor is required.')
  home.integrations.push({ id, ...(summary ? { summary } : {}), accessors })
  await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
  return { id, accessors, bindings: {} }
}

export async function bindIntegration(root, id, provider, descriptor) {
  const home = await loadHome(root)
  if (!home.providers.includes(provider)) throw new HairnessError('provider_inactive', `Provider ${provider} is not active.`)
  const integration = home.integrations.find((entry) => entry.id === id)
  if (!integration) throw new HairnessError('integration_missing', `Integration ${id} is not declared.`)
  const binding = parseBinding(descriptor)
  if (binding.kind !== 'none' && !integration.accessors.some((accessor) => sameAccessor(accessor, binding, provider))) {
    throw new HairnessError('integration_accessor_missing', `${descriptor} is not declared for ${id} on ${provider}.`)
  }
  const config = await loadLocalConfig(root)
  config.integrationBindings[id] ??= {}
  config.integrationBindings[id][provider] = binding
  await writeJsonAtomic(join(root, '.overlay', 'config.json'), config)
  return { id, provider, binding }
}

export async function unbindIntegration(root, id, provider) {
  const config = await loadLocalConfig(root)
  if (config.integrationBindings[id]) {
    delete config.integrationBindings[id][provider]
    if (!Object.keys(config.integrationBindings[id]).length) delete config.integrationBindings[id]
    await writeJsonAtomic(join(root, '.overlay', 'config.json'), config)
  }
  return { id, provider, status: 'unbound' }
}

export async function removeIntegration(root, id) {
  const home = await loadHome(root)
  if (!home.integrations.some((entry) => entry.id === id)) throw new HairnessError('integration_missing', `Integration ${id} is not declared.`)
  home.integrations = home.integrations.filter((entry) => entry.id !== id)
  await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
  const config = await loadLocalConfig(root)
  delete config.integrationBindings[id]
  await writeJsonAtomic(join(root, '.overlay', 'config.json'), config)
  return { id, status: 'removed' }
}

export async function doctorIntegrations(root) {
  const home = await loadHome(root)
  const integrations = await listIntegrations(root)
  const limits = []
  const checked = []
  for (const integration of integrations) {
    const bindings = {}
    for (const provider of home.providers) {
      const binding = integration.bindings[provider]
      if (!binding) {
        limits.push(`integration-unbound:${integration.id}:${provider}`)
        continue
      }
      if (binding.kind === 'none') {
        limits.push(`integration-unavailable:${integration.id}:${provider}`)
        bindings[provider] = { ...binding, available: false }
      } else if (binding.kind === 'cli') {
        const available = await exec('which', [binding.command]).then(() => true, () => false)
        if (!available) limits.push(`integration-cli-missing:${integration.id}:${binding.command}`)
        bindings[provider] = { ...binding, available }
      } else {
        bindings[provider] = { ...binding, available: null }
      }
    }
    checked.push({ ...integration, bindings })
  }
  return { status: limits.length ? 'partial' : 'ready', integrations: checked, limits }
}

export function parseAccessors(values = {}) {
  const accessors = []
  for (const command of split(values.cli)) accessors.push({ kind: 'cli', command })
  for (const item of split(values.provider)) {
    const separator = item.indexOf(':')
    if (separator < 1) throw new HairnessError('usage', `Provider accessor must be <provider>:<id>, received ${item}.`)
    accessors.push({ kind: 'provider', provider: item.slice(0, separator), id: item.slice(separator + 1) })
  }
  return accessors
}

function parseBinding(value) {
  if (value === 'none') return { kind: 'none' }
  const separator = String(value).indexOf(':')
  if (separator < 1) throw new HairnessError('usage', 'Accessor must be cli:<command>, provider:<id> or none.')
  const kind = value.slice(0, separator)
  const selected = value.slice(separator + 1)
  if (kind === 'cli') return { kind, command: selected }
  if (kind === 'provider') return { kind, id: selected }
  throw new HairnessError('usage', `Unknown accessor kind ${kind}.`)
}

function sameAccessor(accessor, binding, provider) {
  return accessor.kind === binding.kind
    && (binding.kind === 'cli' ? accessor.command === binding.command : accessor.provider === provider && accessor.id === binding.id)
}

function split(value) {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean)
}
