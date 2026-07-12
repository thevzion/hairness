import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

function normalizeRemote(value = '') {
  return value.replace(/^ssh:\/\/git@/, 'git@').replace(/:22\//, ':').replace(/\/$/, '').replace(/\.git$/, '')
}

async function config(root) {
  try { return JSON.parse(await readFile(join(root, '.overlay', 'config.json'), 'utf8')) } catch { return {} }
}

async function writeConfig(root, value) {
  const target = join(root, '.overlay', 'config.json')
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
}

async function contracts(root, runtime) {
  const distribution = await runtime.distribution.read()
  const local = await config(root)
  const shared = new Map(distribution.codebases.map((contract) => [contract.id, { contract, scope: 'shared' }]))
  for (const contract of local.codebases?.local ?? []) {
    if (shared.has(contract.id)) throw new Error(`Local codebase conflicts with shared contract: ${contract.id}`)
    await runtime.contracts.validate('CodebaseContract', contract)
    shared.set(contract.id, { contract, scope: 'local' })
  }
  return [...shared.values()]
}

async function mountedPath(root, id, checkout = 'default') {
  const local = await config(root)
  const configured = local.codebases?.mounts?.[id]?.[checkout]?.path
  if (configured) return resolve(root, configured)
  try { return await realpath(join(root, '.overlay', 'codebases', id, checkout)) } catch { return null }
}

function repository(remote) {
  const match = /^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)(?::\d+)?[/:](.+?)\/?$/.exec(remote)
  if (!match) throw new Error(`Unsupported Git remote: ${remote}`)
  const host = match[1]
  const parts = match[2].replace(/\.git$/, '').split('/')
  const name = parts.pop()
  const namespace = parts.join('/')
  if (!namespace || !name) throw new Error(`Git remote must include namespace and repository: ${remote}`)
  return { provider: host.includes('gitlab') ? 'gitlab' : host.includes('github') ? 'github' : 'git', host, namespace, name, webUrl: `https://${host}/${namespace}/${name}`, acceptedRemotes: [remote] }
}

function operationId(kind, value) {
  return `codebase-${kind}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)}`
}

async function targetState(runtime, path, acceptedRemotes) {
  const canonical = await realpath(path)
  const status = await runtime.sources.read('git', 'status', { path: canonical }).then((value) => value.data)
  const identity = await runtime.sources.read('git', 'identity', { path: canonical }).then((value) => value.data).catch(() => null)
  const remote = identity?.remote ?? null
  const remoteMatch = remote ? acceptedRemotes.map(normalizeRemote).includes(normalizeRemote(remote)) : false
  if (remote && !remoteMatch) throw new Error(`Git remote does not match the codebase contract: ${remote}`)
  return { canonical, status, remote, remoteMatch }
}

async function placeMount(root, id, checkout, source) {
  const destination = join(root, '.overlay', 'codebases', id, checkout)
  const prior = await lstat(destination).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (prior) {
    if (!prior.isSymbolicLink()) throw new Error(`Codebase mount path is not a symlink: ${destination}`)
    const linked = await realpath(destination)
    if (linked === source) return destination
    throw new Error(`Codebase mount already points elsewhere: ${destination}`)
  }
  await mkdir(dirname(destination), { recursive: true })
  await symlink(source, destination, 'dir')
  return destination
}

async function mountCodebase({ root, id, path, checkout = 'default', runtime, checkpoint, contract, localContract = false }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(checkout)) throw new Error(`Invalid checkout id: ${checkout}`)
  const state = await targetState(runtime, path, contract.repository.acceptedRemotes)
  const baseline = { codebaseId: id, checkoutId: checkout, realpath: state.canonical, branch: state.status.branch ?? null, head: state.status.head ?? null, dirty: state.status.dirty ?? 0 }
  const checkpointId = operationId('mount', { root, id, checkout, source: state.canonical, contract, baseline })
  const limits = state.remote ? [] : ['remote-pending']
  const plan = { checkpointId, mode: 'mutation', intent: `Mount checkout ${checkout} for codebase ${id}.`, targets: [join(root, '.overlay', 'codebases', id, checkout)], effects: ['write-local-config', 'create-codebase-symlink'], exclusions: ['target mutation', 'Git mutation', 'remote write'], risk: 'Adds a workspace-local reference to an existing checkout.', proof: { baseline, remote: state.remote, remoteMatch: state.remoteMatch }, limits }
  if (!checkpoint) return plan
  if (checkpoint !== checkpointId) throw new Error('Codebase mount checkpoint does not match.')
  await placeMount(root, id, checkout, state.canonical)
  const value = await config(root)
  value.schemaVersion ??= 2
  value.protocolVersion ??= '0.2'
  value.codebases ??= { local: [], mounts: {} }
  value.codebases.local ??= []
  value.codebases.mounts ??= {}
  if (localContract && !value.codebases.local.some((entry) => entry.id === id)) value.codebases.local.push(contract)
  value.codebases.mounts[id] ??= {}
  value.codebases.mounts[id][checkout] = { path: `./.overlay/codebases/${id}/${checkout}` }
  await writeConfig(root, value)
  return { summary: `Mounted ${id}/${checkout}.`, status: state.remote ? 'mounted' : 'remote-pending', checkout: baseline, limits, routes: [`hairness codebase ${id} doctor --checkout ${checkout}`] }
}

async function unmountCodebase({ root, id, checkout = 'default', runtime, checkpoint, removeContract = false }) {
  const values = await contracts(root, runtime)
  const found = values.find((value) => value.contract.id === id)
  if (!found) throw new Error(`Unknown codebase: ${id}`)
  if (removeContract && found.scope !== 'local') throw new Error(`Shared codebase contracts cannot be removed locally: ${id}`)
  const destination = join(root, '.overlay', 'codebases', id, checkout)
  const checkpointId = operationId(removeContract ? 'remove' : 'unmount', { root, id, checkout, destination })
  const plan = { checkpointId, mode: 'mutation', intent: `${removeContract ? 'Remove local codebase contract and unmount' : 'Unmount'} ${id}/${checkout}.`, targets: [destination], effects: [removeContract ? 'remove-local-codebase' : 'remove-codebase-symlink'], exclusions: ['target deletion', 'Git mutation', 'remote write'], risk: 'Removes only Hairness local state; the checkout is preserved.' }
  if (!checkpoint) return plan
  if (checkpoint !== checkpointId) throw new Error('Codebase removal checkpoint does not match.')
  const prior = await lstat(destination).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (prior && !prior.isSymbolicLink()) throw new Error(`Refusing to remove non-symlink mount path: ${destination}`)
  await rm(destination, { force: true })
  const value = await config(root)
  if (value.codebases?.mounts?.[id]) delete value.codebases.mounts[id][checkout]
  if (removeContract) value.codebases.local = (value.codebases?.local ?? []).filter((entry) => entry.id !== id)
  await writeConfig(root, value)
  return { summary: `${removeContract ? 'Removed local codebase' : 'Unmounted'} ${id}/${checkout}; the checkout was preserved.`, status: removeContract ? 'removed' : 'unmounted', limits: [], routes: [] }
}

async function inspect({ root, input, runtime }) {
  const id = input.id
  const checkout = input.checkout ?? 'default'
  const found = (await contracts(root, runtime)).find((candidate) => candidate.contract.id === id)
  if (!found) throw new Error(`Unknown codebase: ${id}`)
  const { contract, scope } = found
  const path = await mountedPath(root, id, checkout)
  if (!path) return { id, checkout, scope, contract, path: null, mounted: false, git: null, remoteMatch: false }
  try { await access(path) } catch { return { id, checkout, scope, contract, path, mounted: false, git: null, remoteMatch: false } }
  const [identity, status] = await Promise.all([
    runtime.sources.read('git', 'identity', { path }).then((value) => value.data).catch(() => null),
    runtime.sources.read('git', 'status', { path }).then((value) => value.data).catch(() => null),
  ])
  const accepted = contract.repository.acceptedRemotes.map(normalizeRemote)
  const remoteMatch = Boolean(identity?.remote && accepted.includes(normalizeRemote(identity.remote)))
  const baseline = status ? { codebaseId: id, checkoutId: checkout, realpath: await realpath(path), branch: status.branch ?? null, head: status.head ?? null, dirty: status.dirty ?? 0 } : null
  return { id, checkout, scope, contract, path, mounted: true, baseline, remoteMatch, remoteStatus: identity?.remote ? remoteMatch ? 'matched' : 'mismatch' : 'pending', git: status ? { ...status, available: true, remote: identity?.remote ?? null } : { available: false } }
}

async function mapCodebase({ root, runtime, kind, id, focus, workload }) {
  const available = (await contracts(root, runtime)).map((value) => value.contract)
  const selected = kind === 'system' ? available : [available.find((candidate) => candidate.id === id)]
  if (!selected.length || selected.some((value) => !value)) throw new Error(`Unknown codebase: ${id}`)
  const states = await Promise.all(selected.map((contract) => inspect({ root, input: { id: contract.id }, runtime })))
  const missing = states.filter((state) => !state.mounted)
  if (missing.length) throw new Error(`Codebase is not mounted: ${missing.map((state) => state.id).join(', ')}`)
  const suffix = Date.now().toString(36)
  const planId = `${kind}-${id ?? 'distribution'}-${suffix}`
  const runId = `${planId}-producer`
  const fanIn = `${planId}-fan-in`
  const artifactId = kind === 'system' ? 'system/codebases' : `codebase/${id}-${kind}`
  const baselines = states.map((state) => state.baseline)
  const targetSet = { id: `targets-${planId}`, targets: baselines, digest: `sha256:${createHash('sha256').update(JSON.stringify(baselines)).digest('hex')}` }
  await runtime.contracts.validate('TargetSet', targetSet)
  const intent = { schemaVersion: 2, protocolVersion: '0.2', id: planId, summary: `Map ${kind} context.`, outcome: `A compact ${kind} artifact.`, targets: states.map((state) => state.path), limits: ['No target mutation.'] }
  const route = { schemaVersion: 2, protocolVersion: '0.2', id: runId, kind: 'producer', requirement: 'required', resultSchema: 'ArtifactEnvelope', fanIn, workload }
  await runtime.plans.write({ schemaVersion: 2, protocolVersion: '0.2', id: planId, intent, routes: [route], fanIn: { id: fanIn, mode: 'mechanical' } })
  const artifactType = kind === 'map' ? 'codebase-map' : `${kind}-map`
  await runtime.runs.create({ id: runId, planId, assignment: {
    schemaVersion: 2, protocolVersion: '0.2', id: `produce-${artifactId.replace('/', '-')}`, profile: 'producer',
    goal: `Map ${kind}${id ? ` for ${id}` : ''}${focus ? `: ${focus}` : ''}.`, outcome: `Artifact ${artifactId} with precise references, proof, doubts, and limits.`,
    workload, budget: 1, inputs: [{ codebases: states }, { targetSet }, { artifactId, artifactType }], targets: states.map((state) => state.path),
    exclusions: ['filesystem mutation', 'Git mutation', 'raw source dumps', 'nested subagents'], allowedSources: ['git:status', 'filesystem:read'], requestedEffects: [], result: { schema: 'ArtifactEnvelope', disposition: 'artifact', artifactOwner: 'hairness/codebase', artifactType },
  } })
  await runtime.runs.transition(runId, 'ready')
  return { summary: `Prepared ${kind} producer.`, status: 'ready', planId, runId, capsule: await runtime.runs.capsule(runId), limits: [], routes: [`spawn producer for ${runId}`, `hairness plan ${planId} reduce`] }
}

export const services = { inspect }

export async function attentionSignals({ root, runtime }) {
  const signals = []
  for (const { contract } of await contracts(root, runtime)) {
    const state = await inspect({ root, input: { id: contract.id }, runtime })
    if (contract.requirement === 'required' && !state.mounted) signals.push({ state: 'blocked', priority: 95, summary: `${contract.displayName} is required but not mounted.`, route: 'hairness onboarding next' })
    else if (state.mounted && !state.remoteMatch) signals.push({ state: contract.requirement === 'required' ? 'blocked' : 'active', priority: 85, summary: state.remoteStatus === 'pending' ? `${contract.displayName} has no origin yet.` : `${contract.displayName} origin does not match the declared repository.`, route: `hairness codebase ${contract.id} doctor` })
    else if (state.git?.ahead > 0 || (state.mounted && !state.git?.upstream)) signals.push({ state: 'active', priority: 65, summary: `${contract.displayName} has ${state.git?.upstream ? `${state.git.ahead} unpushed commit(s)` : 'no upstream'}.`, route: `hairness codebase ${contract.id} show` })
  }
  return signals
}

export async function sessionContributions({ root, runtime, manifest }) {
  const available = await contracts(root, runtime)
  const mounted = []
  for (const { contract } of available.slice(0, 8)) {
    const value = await inspect({ root, input: { id: contract.id }, runtime })
    if (value.mounted) mounted.push(contract.id)
  }
  return [{ owner: manifest.id, section: 'codebases', priority: 50, summary: `${mounted.length}/${available.length} codebases mounted.`, data: { mounted }, routes: mounted.length === available.length ? [] : ['hairness onboarding next'], limits: [], freshness: new Date().toISOString(), byteSize: 0 }]
}

export async function handleCommand({ root, target, action, rest, flags, runtime }) {
  if (target === 'list' || !target) return { codebases: (await contracts(root, runtime)).map(({ contract, scope }) => ({ ...contract, scope })) }
  if (target === 'add') {
    if (!flags.local || flags.local === true || !flags.path || !flags.remote) throw new Error('Usage: hairness codebase add --local <id> --path <path> --remote <url>')
    const contract = { schemaVersion: 2, protocolVersion: '0.2', id: flags.local, displayName: flags['display-name'] ?? flags.local, requirement: flags.requirement ?? 'optional', repository: repository(flags.remote), testCommands: [] }
    await runtime.contracts.validate('CodebaseContract', contract)
    if ((await contracts(root, runtime)).some((value) => value.contract.id === contract.id)) throw new Error(`Codebase already exists: ${contract.id}`)
    return mountCodebase({ root, id: contract.id, path: flags.path, checkout: flags.as ?? 'default', runtime, checkpoint: flags.checkpoint, contract, localContract: true })
  }
  if (target === 'mount') {
    if (!action || !rest[0]) throw new Error('Usage: hairness codebase mount <id> <path>')
    const found = (await contracts(root, runtime)).find((value) => value.contract.id === action)
    if (!found) throw new Error(`Unknown codebase: ${action}`)
    return mountCodebase({ root, id: action, path: rest[0], checkout: flags.as ?? 'default', runtime, checkpoint: flags.checkpoint, contract: found.contract, localContract: found.scope === 'local' })
  }
  if (target === 'unmount') {
    if (!action) throw new Error('Usage: hairness codebase unmount <id>')
    return unmountCodebase({ root, id: action, checkout: flags.as ?? 'default', runtime, checkpoint: flags.checkpoint })
  }
  if (target === 'remove') {
    if (!flags.local || flags.local === true) throw new Error('Usage: hairness codebase remove --local <id>')
    return unmountCodebase({ root, id: flags.local, checkout: flags.as ?? 'default', runtime, checkpoint: flags.checkpoint, removeContract: true })
  }
  if (['map', 'entrypoint', 'system'].includes(target)) {
    const id = action
    if (target !== 'system' && !id) throw new Error(`Usage: hairness codebase ${target} <id>`)
    return mapCodebase({ root, runtime, kind: target, id, focus: rest.join(' ') || flags.focus, workload: flags.budget ?? (target === 'system' ? 'deep' : 'balanced') })
  }
  const state = await inspect({ root, input: { id: target, checkout: flags.checkout ?? 'default' }, runtime })
  const mode = action ?? 'show'
  if (mode === 'show') return state
  if (mode === 'doctor') {
    const blocking = state.contract.requirement === 'required' && (!state.mounted || !state.remoteMatch)
    const partial = !state.mounted || !state.remoteMatch || !state.git?.available
    return { schemaVersion: 2, protocolVersion: '0.2', subject: `codebase:${target}`, status: blocking ? 'blocked' : partial ? 'partial' : 'ready', checks: [{ name: 'mounted', ok: state.mounted }, { name: 'repository-identity', ok: state.remoteMatch }, { name: 'git', ok: state.git?.available ?? false }], limits: [!state.mounted && 'codebase is not mounted', state.mounted && state.remoteStatus === 'pending' && 'remote-pending', state.mounted && state.remoteStatus === 'mismatch' && 'origin does not match the declared repository', state.git?.dirty && `working tree has ${state.git.dirty} change(s)`].filter(Boolean), routes: blocking ? ['hairness onboarding next'] : [] }
  }
  throw new Error(`Unknown codebase action: ${mode}`)
}
