import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HairnessError } from '../core/errors.mjs'
import { readJson, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract } from '../core/contracts.mjs'

const supportedProviders = new Set(['codex', 'claude'])
const version = '0.2.0-alpha.0'

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function assertProvider(provider) {
  if (!supportedProviders.has(provider)) throw new HairnessError('unknown_host', `Unknown provider: ${provider}`, { exitCode: 2 })
}

async function exists(path) {
  try { await stat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

async function extensionManifest(root, entry) {
  const path = resolve(root, entry.path)
  const manifest = await readJson(join(path, 'extension.json'), null)
  if (!manifest) throw new HairnessError('extension_source_missing', `${entry.id} is missing.`, { exitCode: 4 })
  await validateContract('ExtensionManifest', manifest)
  if (manifest.id !== entry.id) throw new HairnessError('extension_id_mismatch', `${entry.id} does not match ${manifest.id}.`, { exitCode: 2 })
  return { id: entry.id, path, manifest }
}

async function activeExtensions(root, includeLocal = false) {
  const distribution = await readJson(join(root, 'hairness.json'))
  await validateContract('DistributionManifest', distribution)
  const config = await readJson(workspacePaths(root).config, {})
  const disabled = new Set(config.extensions?.disabled ?? [])
  const entries = distribution.extensions.filter((entry) => !disabled.has(entry.id))
  if (includeLocal) for (const entry of config.extensions?.local ?? []) if (entry.enabled) entries.push(entry)
  const values = []
  for (const entry of entries) values.push(await extensionManifest(root, entry))
  return { distribution, extensions: values }
}

async function projectionModel(root, includeLocal = false) {
  const active = await activeExtensions(root, includeLocal)
  const commands = []
  const modifiers = new Map()
  const guidance = []
  const hooks = []
  for (const extension of active.extensions) {
    for (const modifier of extension.manifest.intentModifiers ?? []) {
      if (modifiers.has(modifier.id)) throw new HairnessError('intent_modifier_collision', `Duplicate intent modifier ${modifier.id}.`, { exitCode: 2 })
      modifiers.set(modifier.id, { ...modifier, owner: extension.id })
    }
    for (const item of extension.manifest.agentGuidance ?? []) {
      if (item.roles && !item.roles.includes(active.distribution.role)) continue
      const source = resolve(extension.path, item.source)
      if (relative(extension.path, source).startsWith('..')) throw new HairnessError('managed_source_escape', `${extension.id} guidance escapes its extension.`, { exitCode: 2 })
      guidance.push({ ...item, owner: extension.id, content: (await readFile(source, 'utf8')).trim() })
    }
    for (const command of extension.manifest.providerCommands) {
      const source = resolve(extension.path, command.instructions)
      if (relative(extension.path, source).startsWith('..')) throw new HairnessError('provider_instruction_escape', `${extension.id} instruction escapes its extension.`, { exitCode: 2 })
      commands.push({ ...command, owner: extension.id, instructionsText: (await readFile(source, 'utf8')).trim() })
    }
    if ((extension.manifest.contributes ?? []).includes('provider-hooks')) {
      const module = await import(`${pathToFileURL(resolve(extension.path, extension.manifest.module)).href}?build=${Date.now()}`)
      if (typeof module.providerHooks !== 'function') throw new HairnessError('provider_hook_missing', `${extension.id} declares provider-hooks without exporting providerHooks.`, { exitCode: 2 })
      for (const hook of await module.providerHooks()) hooks.push({ ...hook, owner: extension.id })
    }
  }
  const ids = new Set()
  const names = new Map()
  for (const command of commands) {
    if (ids.has(command.id) || names.has(command.name)) throw new HairnessError('provider_command_collision', `Duplicate provider command ${command.id}/${command.name}.`, { exitCode: 2 })
    ids.add(command.id)
    names.set(command.name, command.owner)
    for (const modifier of command.acceptsModifiers ?? []) if (!modifiers.has(modifier)) throw new HairnessError('intent_modifier_missing', `${command.id} accepts missing modifier ${modifier}.`, { exitCode: 2 })
  }
  return { ...active, commands, guidance, hooks, modifiers: [...modifiers.values()] }
}

function skillMarkdown(command, provider, modifiers) {
  const invocation = provider === 'codex' ? `$${command.name}` : `/${command.name}`
  const accepted = (command.acceptsModifiers ?? []).map((id) => modifiers.find((item) => item.id === id)).filter(Boolean)
  const modifierText = accepted.length ? `\nAccepted modifiers:\n${accepted.map((item) => `- \`--${item.argument} <${item.values.join('|')}>\` (default: \`${item.default}\`)`).join('\n')}\n` : ''
  return `---\nname: ${command.name}\ndescription: ${command.summary}\n---\n\n# ${command.name}\n\nInvocation: \`${invocation}\`\nDeterministic route: \`${command.command} --json\`\nOwner: \`${command.owner}\`\n${modifierText}\n${command.instructionsText}\n\nA command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.\n`
}

function workerFiles(provider) {
  const producer = 'Use only the supplied WorkerCapsule. Do not load the main-session cockpit or conversation history, and do not spawn nested agents. Read only allowed sources. Return exactly one typed result through the declared submit route. Never mutate a target codebase.'
  const executor = 'Use only the supplied WorkerCapsule. Do not load the main-session cockpit or conversation history, and do not spawn nested agents. Perform only granted effects on declared targets. Stop on ambiguity or boundary expansion. Return one typed ChangeReceipt. Never stage, commit, push, or mutate external systems unless explicitly granted.'
  if (provider === 'codex') return [
    ['.codex/agents/hairness-producer.toml', `name = "hairness-producer"\ndescription = "Produce one bounded typed result. Resolve fast, balanced, or deep from the WorkerCapsule."\nsandbox_mode = "read-only"\ndeveloper_instructions = """\n${producer}\n"""\n`],
    ['.codex/agents/hairness-executor.toml', `name = "hairness-executor"\ndescription = "Perform one bounded granted operation. Resolve fast, balanced, or deep from the WorkerCapsule."\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """\n${executor}\n"""\n`],
  ]
  return [
    ['.claude/agents/hairness-producer.md', `---\nname: hairness-producer\ndescription: Produce one bounded typed result\nmodel: inherit\ntools: Read, Glob, Grep, Bash\n---\n\n${producer}\n`],
    ['.claude/agents/hairness-executor.md', `---\nname: hairness-executor\ndescription: Perform one bounded granted operation\nmodel: inherit\ntools: Read, Glob, Grep, Edit, Write, Bash\n---\n\n${executor}\n`],
  ]
}

function providerOutputs(model, provider, base = '') {
  const files = []
  const skillsRoot = provider === 'codex' ? '.agents/skills' : '.claude/skills'
  for (const command of model.commands) files.push([join(base, skillsRoot, command.name, 'SKILL.md'), skillMarkdown(command, provider, model.modifiers), command.owner])
  for (const [path, content] of workerFiles(provider)) files.push([join(base, path), content, 'protocol'])
  return files
}

const regionPattern = /<!-- hairness:begin id="([^"]+)" owner="([^"]+)" schema="1" digest="(sha256:[a-f0-9]+)" -->\n([\s\S]*?)\n<!-- hairness:end id="\1" -->/g

function regionBlock(item) {
  return `<!-- hairness:begin id="${item.id}" owner="${item.owner}" schema="1" digest="${digest(item.content)}" -->\n${item.content}\n<!-- hairness:end id="${item.id}" -->`
}

function mergeRegions(current, expected, target) {
  const seen = new Set()
  let unsafe = null
  let next = current.replace(regionPattern, (block, id, owner, previousDigest, content) => {
    const key = `${owner}:${id}`
    if (seen.has(key)) { unsafe = `duplicate managed region ${key} in ${target}`; return block }
    seen.add(key)
    if (digest(content) !== previousDigest) { unsafe = `managed region ${key} in ${target} was edited`; return block }
    const item = expected.find((candidate) => candidate.id === id && candidate.owner === owner)
    return item ? regionBlock(item) : ''
  })
  if (unsafe) throw new HairnessError('review_required', unsafe, { exitCode: 5, details: { decision: 'review-required', target } })
  const missing = expected.filter((item) => !seen.has(`${item.owner}:${item.id}`))
  if (missing.length) { const prefix = next.trimEnd(); next = `${prefix}${prefix ? '\n\n' : ''}${missing.map(regionBlock).join('\n\n')}\n` }
  return next.replace(/\n{3,}/g, '\n\n')
}

const tomlRegionPattern = /# hairness:begin id="([^"]+)" owner="([^"]+)" schema="1" digest="(sha256:[a-f0-9]+)"\n([\s\S]*?)\n# hairness:end id="\1"/g

function tomlBlock(item) {
  return `# hairness:begin id="${item.id}" owner="${item.owner}" schema="1" digest="${digest(item.content)}"\n${item.content}\n# hairness:end id="${item.id}"`
}

function mergeTomlRegions(current, expected, target) {
  const seen = new Set()
  let unsafe = null
  let next = current.replace(tomlRegionPattern, (block, id, owner, previousDigest, content) => {
    const key = `${owner}:${id}`
    if (seen.has(key)) { unsafe = `duplicate managed TOML region ${key}`; return block }
    seen.add(key)
    if (digest(content) !== previousDigest) { unsafe = `managed TOML region ${key} in ${target} was edited`; return block }
    const item = expected.find((candidate) => candidate.id === id && candidate.owner === owner)
    return item ? tomlBlock(item) : ''
  })
  if (unsafe) throw new HairnessError('review_required', unsafe, { exitCode: 5 })
  const missing = expected.filter((item) => !seen.has(`${item.owner}:${item.id}`))
  if (missing.length) { const prefix = next.trimEnd(); next = `${prefix}${prefix ? '\n\n' : ''}${missing.map(tomlBlock).join('\n\n')}\n` }
  return next.replace(/\n{3,}/g, '\n\n')
}

function hookEntry(provider) {
  return { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: `node "$(git rev-parse --show-toplevel)/src/prologue.mjs" --host ${provider}`, timeout: 5, ...(provider === 'codex' ? { statusMessage: 'Loading Hairness context' } : {}) }] }
}

function mergeHookJson(current, expected, priorDigest, target, remove = false) {
  let document
  try { document = current.trim() ? JSON.parse(current) : {} } catch { throw new HairnessError('review_required', `${target} is not valid JSON.`, { exitCode: 5 }) }
  document.hooks ??= {}
  document.hooks.SessionStart ??= []
  const managed = document.hooks.SessionStart.filter((group) => group.hooks?.some((hook) => hook.command?.includes('/src/prologue.mjs')))
  if (managed.length > 1) throw new HairnessError('review_required', `${target} contains duplicate Hairness hooks.`, { exitCode: 5 })
  if (managed.length && priorDigest && digest(JSON.stringify(managed[0])) !== priorDigest) throw new HairnessError('review_required', `${target} Hairness entry was edited.`, { exitCode: 5 })
  document.hooks.SessionStart = document.hooks.SessionStart.filter((group) => !group.hooks?.some((hook) => hook.command?.includes('/src/prologue.mjs')))
  if (!remove) document.hooks.SessionStart.push(expected)
  if (!document.hooks.SessionStart.length) delete document.hooks.SessionStart
  if (!Object.keys(document.hooks).length) delete document.hooks
  return `${JSON.stringify(document, null, 2)}\n`
}

async function writeLocalExcludes(root, paths) {
  const target = join(root, '.git/info/exclude')
  if (!await exists(join(root, '.git'))) return
  const current = await readFile(target, 'utf8').catch(() => '')
  const begin = '# hairness:begin provider-local'
  const end = '# hairness:end provider-local'
  const pattern = /# hairness:begin provider-local\n[\s\S]*?# hairness:end provider-local\n?/g
  const clean = current.replace(pattern, '').trimEnd()
  const block = paths.length ? `${begin}\n${paths.map((path) => `/${path}`).join('\n')}\n${end}\n` : ''
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${clean}${clean && block ? '\n\n' : ''}${block}`)
}

async function expectedFiles(root, provider, local) {
  const model = await projectionModel(root, local)
  const base = local ? join('.overlay', 'provider-local', provider) : ''
  return { model, files: providerOutputs(model, provider, base) }
}

async function ensureSafeWrite(root, path, content, owner, provider, previous, check) {
  const absolute = join(root, path)
  const current = await readFile(absolute, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (current === content) return { path, owner, provider, digest: digest(content), state: 'current' }
  if (check) throw new HairnessError('provider_projection_drift', `${path} is missing or stale.`, { exitCode: 5, routes: ['hairness build'] })
  if (current !== null && previous?.digest && digest(current) !== previous.digest) throw new HairnessError('review_required', `${path} was edited outside its canonical owner.`, { exitCode: 5, details: { decision: 'review-required', target: path } })
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content)
  return { path, owner, provider, digest: digest(content), state: current === null ? 'created' : 'updated' }
}

export async function buildProviders(root, options = {}) {
  const providers = options.provider ? [options.provider] : ['codex', 'claude']
  providers.forEach(assertProvider)
  const manifestPath = options.local ? join(workspacePaths(root).overlay, 'provider-local', 'manifest.json') : join(root, 'hairness.build.json')
  const previous = await readJson(manifestPath, { outputs: [], regions: [] })
  const outputs = []
  const entries = []
  let sharedModel
  for (const provider of providers) {
    const { model, files } = await expectedFiles(root, provider, Boolean(options.local))
    sharedModel ??= model
    const desired = new Set(files.map(([path]) => path))
    const owns = (path) => options.local
      ? path.startsWith(join('.overlay', 'provider-local', provider))
      : provider === 'codex' ? path.startsWith('.agents/') || path.startsWith('.codex/') : path.startsWith('.claude/')
    const managedContainers = new Set(['.codex/config.toml', '.codex/hooks.json', '.claude/settings.json'])
    for (const prior of previous.outputs?.filter((item) => owns(item.path) && !desired.has(item.path) && !managedContainers.has(item.path)) ?? []) {
      const absolute = join(root, prior.path)
      const current = await readFile(absolute, 'utf8').catch(() => null)
      if (current !== null && digest(current) !== prior.digest) throw new HairnessError('review_required', `${prior.path} is stale but was edited.`, { exitCode: 5 })
      if (options.check && current !== null) throw new HairnessError('provider_projection_drift', `${prior.path} is a stale owned output.`, { exitCode: 5, routes: ['hairness build'] })
      if (!options.check) await rm(absolute, { force: true })
    }
    for (const [path, content, owner] of files) {
      const prior = previous.outputs?.find((item) => item.path === path)
      outputs.push(await ensureSafeWrite(root, path, content, owner, provider, prior, Boolean(options.check)))
    }
  }
  const regions = []
  if (!options.local) for (const target of ['AGENTS.md', 'CLAUDE.md']) {
    const expected = sharedModel.guidance.filter((item) => item.targets.includes(target))
    const absolute = join(root, target)
    const current = await readFile(absolute, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
    const next = mergeRegions(current, expected, target)
    if (options.check && current !== next) throw new HairnessError('provider_projection_drift', `${target} managed regions are stale.`, { exitCode: 5, routes: ['hairness build'] })
    if (!options.check && current !== next) await writeFile(absolute, next)
    for (const item of expected) regions.push({ target, id: item.id, owner: item.owner, digest: digest(item.content) })
  }
  if (!options.local && providers.includes('codex')) {
    const target = '.codex/config.toml'
    const absolute = join(root, target)
    let current = await readFile(absolute, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
    const legacy = previous.outputs?.find((item) => item.path === target)
    if (!tomlRegionPattern.test(current) && legacy?.digest === digest(current)) current = ''
    tomlRegionPattern.lastIndex = 0
    const owner = sharedModel.extensions.find(({ manifest }) => manifest.contributes?.includes('provider-hooks'))?.id
    const item = owner ? { id: 'agent-limits', owner, content: '[agents]\nmax_threads = 3\nmax_depth = 1' } : null
    const next = mergeTomlRegions(current, item ? [item] : [], target)
    const actual = await readFile(absolute, 'utf8').catch(() => '')
    if (options.check && actual !== next) throw new HairnessError('provider_projection_drift', `${target} managed region is stale.`, { exitCode: 5 })
    if (!options.check && actual !== next) { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, next) }
    if (item) regions.push({ target, id: item.id, owner: item.owner, digest: digest(item.content) })
  }
  if (!options.local) for (const provider of providers) {
    const target = provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'
    const absolute = join(root, target)
    const current = await readFile(absolute, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
    const hook = sharedModel.hooks.find((item) => item.id === 'session-opening')
    if (!hook) continue
    const expected = hookEntry(provider)
    const prior = previous.entries?.find((item) => item.target === target && item.id === 'session-opening')
    const next = mergeHookJson(current, expected, prior?.digest, target)
    if (options.check && current !== next) throw new HairnessError('provider_projection_drift', `${target} managed entry is stale.`, { exitCode: 5 })
    if (!options.check && current !== next) { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, next) }
    entries.push({ target, pointer: '/hooks/SessionStart/hairness', id: 'session-opening', owner: hook.owner, digest: digest(JSON.stringify(expected)) })
  }
  const manifest = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    implementationVersion: version,
    sourceDigest: digest(JSON.stringify({ extensions: sharedModel.extensions.map((item) => [item.id, item.manifest.version]), commands: sharedModel.commands.map((item) => [item.id, digest(item.instructionsText)]) })),
    composition: sharedModel.distribution.name,
    role: sharedModel.distribution.role,
    local: Boolean(options.local),
    providers: options.provider ? [...new Set([...(previous.providers ?? []), ...providers])] : providers,
    extensions: sharedModel.extensions.map((item) => item.id),
    commands: sharedModel.commands.map(({ id, name, owner }) => ({ id, name, owner })),
    outputs: [
      ...(options.provider ? (previous.outputs ?? []).filter((item) => {
        const selected = new Set(providers)
        if (selected.has('codex') && (item.path.startsWith('.agents/') || item.path.startsWith('.codex/'))) return false
        if (selected.has('claude') && item.path.startsWith('.claude/')) return false
        return true
      }) : []),
      ...outputs.map(({ path, owner, provider, digest: value }) => ({ path, owner, provider, digest: value })),
    ],
    regions,
    entries: [
      ...(options.provider ? (previous.entries ?? []).filter((item) => !providers.some((provider) => item.target === (provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'))) : []),
      ...entries,
    ],
  }
  await validateContract('BuildManifest', manifest)
  if (!options.check) {
    await writeJsonAtomic(manifestPath, manifest)
    if (options.local) await writeLocalExcludes(root, manifest.outputs.map((item) => item.path))
  }
  return { summary: options.check ? 'Provider projections are current.' : `Built ${providers.join(' and ')} repo-local projections.`, status: options.check ? 'current' : 'built', providers, commands: manifest.commands.length, outputs: outputs.length, limits: [], routes: ['start a new provider session'] }
}

export async function cleanProviders(root, options = {}) {
  const manifestPath = options.local ? join(workspacePaths(root).overlay, 'provider-local', 'manifest.json') : join(root, 'hairness.build.json')
  const manifest = await readJson(manifestPath, null)
  if (!manifest) return { summary: 'No owned provider outputs found.', status: 'clean', limits: [], routes: [] }
  for (const output of manifest.outputs ?? []) {
    const absolute = join(root, output.path)
    const current = await readFile(absolute, 'utf8').catch(() => null)
    if (current !== null && digest(current) !== output.digest) throw new HairnessError('review_required', `${output.path} was edited and will not be removed.`, { exitCode: 5 })
    await rm(absolute, { force: true })
  }
  if (!options.local) for (const target of ['AGENTS.md', 'CLAUDE.md']) {
    const absolute = join(root, target)
    const current = await readFile(absolute, 'utf8').catch(() => '')
    await writeFile(absolute, mergeRegions(current, [], target))
  }
  if (!options.local) {
    const toml = join(root, '.codex/config.toml')
    const current = await readFile(toml, 'utf8').catch(() => '')
    await writeFile(toml, mergeTomlRegions(current, [], '.codex/config.toml'))
    for (const entry of manifest.entries ?? []) {
      const absolute = join(root, entry.target)
      const json = await readFile(absolute, 'utf8').catch(() => '')
      await writeFile(absolute, mergeHookJson(json, null, entry.digest, entry.target, true))
    }
  }
  await rm(manifestPath, { force: true })
  if (options.local) await writeLocalExcludes(root, [])
  return { summary: 'Removed intact Hairness-owned provider outputs.', status: 'cleaned', limits: [], routes: [] }
}

export async function providerStatus(root, provider) {
  assertProvider(provider)
  const manifest = await readJson(join(root, 'hairness.build.json'), null)
  const paths = provider === 'codex' ? ['.agents/skills', '.codex/agents', '.codex/hooks.json'] : ['.claude/skills', '.claude/agents', '.claude/settings.json']
  const checks = []
  for (const path of paths) checks.push({ path, present: await exists(join(root, path)) })
  const projected = Boolean(manifest?.providers?.includes(provider)) && checks.every((check) => check.present)
  if (!projected) return { schemaVersion: 2, protocolVersion: '0.2', provider, status: 'blocked', checks, limits: ['repo-local projection missing'], routes: [`hairness build --provider ${provider}`] }
  const owned = (manifest.outputs ?? []).filter((item) => item.provider === provider)
  const drift = (await Promise.all(owned.map(async (item) => {
    const content = await readFile(join(root, item.path), 'utf8').catch(() => null)
    return content === null || digest(content) !== item.digest
  }))).some(Boolean)
  const receipt = await readJson(join(workspacePaths(root).overlay, 'provider-local', provider, 'session-start.json'), null)
  const hook = manifest.entries?.find((item) => item.id === 'session-opening' && item.target === (provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'))
  const compatible = receipt?.protocolVersion === '0.2' && receipt.sourceDigest === manifest.sourceDigest && receipt.hookDigest === hook?.digest
  const onboarding = await readJson(join(workspacePaths(root).overlay, 'onboarding.json'), null)
  const status = drift || (receipt && !compatible) ? 'stale' : compatible ? 'verified' : onboarding?.state === 'applied' ? 'verification-required' : 'projected'
  return { schemaVersion: 2, protocolVersion: '0.2', provider, status, checks, receipt: receipt ? { observedAt: receipt.observedAt, compatible } : null, limits: status === 'verified' ? [] : [status === 'stale' ? 'projection or SessionStart receipt is incompatible' : 'SessionStart execution is not yet proven'], routes: status === 'stale' ? [`hairness build --provider ${provider}`] : status === 'verified' ? [] : ['start a new trusted provider task'] }
}
