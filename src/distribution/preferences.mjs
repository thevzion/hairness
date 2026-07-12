import { join } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { readJson, userPaths, workspacePaths, writeJsonAtomic } from '../core/io.mjs'

const invariants = { protocol: { version: '0.2', authority: 'explicit', transcriptStorage: false } }

function merge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = merge({ ...(target[key] ?? {}) }, value)
    else target[key] = value
  }
  return target
}

function assign(object, path, value) {
  const parts = path.split('.')
  let current = object
  for (const part of parts.slice(0, -1)) current = current[part] ??= {}
  current[parts.at(-1)] = value
}

function remove(object, path) {
  const parts = path.split('.')
  let current = object
  for (const part of parts.slice(0, -1)) {
    if (!current[part]) return
    current = current[part]
  }
  delete current[parts.at(-1)]
}

function valueAt(object, path) {
  return path.split('.').reduce((value, part) => value?.[part], object)
}

export async function resolvePreferences(root, overrides = {}) {
  const distribution = await readJson(join(root, 'hairness.json'))
  const user = await readJson(userPaths().preferences, {})
  const local = await readJson(workspacePaths(root).config, {})
  const profile = { interaction: {} }
  if (local.profile?.language !== undefined) profile.interaction.language = local.profile.language
  if (local.profile?.timezone !== undefined) profile.interaction.timezone = local.profile.timezone
  return merge(merge(merge(merge(merge(structuredClone(invariants), distribution.defaults ?? {}), user), profile), local.preferences ?? {}), overrides)
}

export async function preferencesCommand(root, target, action, rest, flags) {
  const mode = target ?? 'show'
  if (mode === 'show') return { preferences: await resolvePreferences(root) }
  if (mode === 'explain') {
    const key = action
    if (!key) throw new HairnessError('usage', 'Usage: hairness preferences explain <key>', { exitCode: 2 })
    const distribution = await readJson(join(root, 'hairness.json'))
    const user = await readJson(userPaths().preferences, {})
    const local = await readJson(workspacePaths(root).config, {})
    const layers = [
      { layer: 'protocol', value: valueAt(invariants, key) },
      { layer: 'distribution', value: valueAt(distribution.defaults ?? {}, key) },
      { layer: 'user', value: valueAt(user, key) },
      { layer: 'workspace', value: valueAt(local.preferences ?? {}, key) },
    ].filter((entry) => entry.value !== undefined)
    return { key, value: valueAt(await resolvePreferences(root), key), layers }
  }
  if (['set', 'unset'].includes(mode)) {
    const key = action
    if (!key) throw new HairnessError('usage', `Usage: hairness preferences ${mode} <key>${mode === 'set' ? ' --value <JSON>' : ''}`, { exitCode: 2 })
    const scope = flags.scope ?? 'workspace'
    if (!['user', 'workspace'].includes(scope)) throw new HairnessError('preference_scope_invalid', `Invalid preference scope: ${scope}`, { exitCode: 2 })
    const path = scope === 'user' ? userPaths().preferences : workspacePaths(root).config
    const document = await readJson(path, scope === 'workspace' ? { schemaVersion: 2, protocolVersion: '0.2', preferences: {} } : {})
    const values = scope === 'workspace' ? (document.preferences ??= {}) : document
    if (mode === 'unset') remove(values, key)
    else {
      if (flags.value === undefined) throw new HairnessError('usage', 'preferences set requires --value.', { exitCode: 2 })
      let value = flags.value
      try { value = JSON.parse(flags.value) } catch {}
      assign(values, key, value)
    }
    await writeJsonAtomic(path, document)
    return { summary: `${mode === 'set' ? 'Set' : 'Unset'} ${key} at ${scope} scope.`, status: 'updated', preferences: await resolvePreferences(root), limits: [], routes: ['hairness preferences doctor'] }
  }
  if (mode === 'doctor') {
    const preferences = await resolvePreferences(root)
    return { schemaVersion: 2, protocolVersion: '0.2', subject: 'preferences', status: preferences.protocol?.transcriptStorage === false ? 'ready' : 'blocked', checks: [{ name: 'transcripts-never-durable', ok: preferences.protocol?.transcriptStorage === false }], limits: [], routes: [] }
  }
  throw new HairnessError('unknown_command', `Unknown preferences action: ${mode}`, { exitCode: 2 })
}
