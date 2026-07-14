import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { now, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { ensureRuntime, runtimePaths } from '../runtime/index.mjs'

export function sourceDefinitions(home) {
  return home.spec.config['hairness/sources']?.sources ?? []
}

export async function sourceBindings(home) {
  const runtime = runtimePaths(home.metadata.id)
  return readJson(runtime.sourceBindings, { home: home.metadata.id, sources: {} })
}

export async function detectSources(root) {
  const home = await loadHome(root)
  const values = []
  for (const source of sourceDefinitions(home)) {
    const candidates = []
    for (const accessor of source.accessors) {
      if (accessor.kind === 'cli') {
        const path = await findExecutable(accessor.command)
        candidates.push({ ...accessor, available: Boolean(path), path })
      } else candidates.push({ ...accessor, available: null, limit: 'provider-confirmation-required' })
    }
    values.push({ ...source, candidates })
  }
  return values
}

export async function saveSourceBindings(root, selections) {
  const home = await loadHome(root)
  const document = await validateSourceBindings(root, selections, home)
  const runtime = await ensureRuntime(home)
  await writeJsonAtomic(runtime.sourceBindings, document)
  return document
}

export async function validateSourceBindings(root, selections, home = null) {
  home ??= await loadHome(root)
  const definitions = new Map(sourceDefinitions(home).map((source) => [source.id, source]))
  const document = { home: home.metadata.id, sources: {} }
  for (const selection of selections ?? []) {
    if (document.sources[selection.id]) throw new HairnessError('source_selection_duplicate', `Source ${selection.id} is selected more than once.`)
    const definition = definitions.get(selection.id)
    if (!definition) throw new HairnessError('source_missing', `Unknown Source ${selection.id}.`)
    if (!['cli', 'provider', 'none'].includes(selection.kind)) throw new HairnessError('source_accessor_invalid', `Unsupported Source accessor ${selection.kind}.`)
    if (selection.kind === 'cli') {
      const allowed = definition.accessors.some((item) => item.kind === 'cli' && item.command === selection.command)
      if (!allowed) throw new HairnessError('source_accessor_invalid', `${selection.command} is not declared for ${selection.id}.`)
      const path = await findExecutable(selection.command)
      if (!path) throw new HairnessError('source_accessor_unavailable', `${selection.command} is not available on PATH.`)
      document.sources[selection.id] = { kind: 'cli', command: selection.command, ...(selection.version ? { version: selection.version } : {}), validatedAt: now() }
    } else if (selection.kind === 'provider') {
      const allowed = definition.accessors.some((item) => item.kind === 'provider' && item.provider === selection.provider && item.id === selection.providerId)
      if (!allowed) throw new HairnessError('source_accessor_invalid', `${selection.provider}:${selection.providerId} is not declared for ${selection.id}.`)
      document.sources[selection.id] = { kind: 'provider', provider: selection.provider, id: selection.providerId, validatedAt: now() }
    } else document.sources[selection.id] = { kind: 'none', validatedAt: now() }
  }
  return document
}

export async function doctorSources(root) {
  const home = await loadHome(root)
  const bindings = await sourceBindings(home)
  const sources = []
  const limits = []
  for (const definition of sourceDefinitions(home)) {
    const binding = bindings.sources[definition.id] ?? null
    let health = binding ? 'configured' : 'unbound'
    if (binding?.kind === 'cli' && !await findExecutable(binding.command)) health = 'unavailable'
    if (binding?.kind === 'none') health = 'none'
    let proof = null
    if (binding && !['unavailable', 'none'].includes(health) && definition.healthAdapter) {
      try {
        const observed = await import('../operations/adapters.mjs').then(({ runAdapter }) => runAdapter(root, definition.healthAdapter, { source: definition, binding }))
        proof = observed.result
        if (proof?.ok === false || proof?.status === 'unavailable' || proof?.status === 'partial') health = proof.status ?? 'unavailable'
        else health = 'ready'
      } catch (error) {
        health = 'unavailable'
        proof = { error: { code: error.code, message: error.message } }
      }
    }
    if (definition.requirement === 'required' && ['unbound', 'unavailable', 'partial', 'none'].includes(health)) limits.push(`source-required-${health}:${definition.id}`)
    else if (['unbound', 'unavailable', 'partial', 'none'].includes(health)) limits.push(`source-recommended-${health}:${definition.id}`)
    sources.push({ ...definition, binding, health, proof })
  }
  return { status: limits.some((limit) => !limit.startsWith('source-recommended')) ? 'partial' : 'ready', sources, limits }
}

async function findExecutable(command) {
  if (command.includes('/')) return executable(command).then((ok) => ok ? command : null)
  for (const directory of String(process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command)
    if (await executable(candidate)) return candidate
  }
  return null
}

async function executable(path) {
  if (!path) return false
  return access(path, constants.X_OK).then(() => true).catch(() => false)
}
