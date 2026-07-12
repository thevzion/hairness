import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { artifactHistory, promoteArtifact, readArtifact, stageArtifact } from '../core/artifacts.mjs'
import { acquireLocks, grantCheckpoint, quarantineLocks, releaseLocks } from '../core/authority.mjs'
import { createExtensionRuntime } from '../core/extension-runtime/index.mjs'
import { readJson, userPaths, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { readPlan, reduceStoredPlan, writePlan } from '../core/plans.mjs'
import { buildWorkerCapsule, createRun, readRun, readRunResult, submitRunResult, transitionRun } from '../core/runs.mjs'
import { validateContract, validateJsonSchema } from '../core/contracts.mjs'
import { capabilityIndex, loadCapabilities, resolveOperation, validateOperationProfile } from '../core/capabilities.mjs'
import { resolvePreferences } from './preferences.mjs'
import { applyDistributionUpdate, checkDistributionUpdate, doctorDistribution, inspectDistribution, planDistributionUpdate } from './update-engine.mjs'

const exec = promisify(execFile)

export async function distribution(root) {
  const manifest = await readJson(join(root, 'hairness.json'))
  await validateContract('DistributionManifest', manifest)
  return manifest
}

export async function descriptors(root) {
  const manifest = await distribution(root)
  const config = await readJson(workspacePaths(root).config, {})
  const disabled = new Set(config.extensions?.disabled ?? [])
  const shared = manifest.extensions.map((entry) => ({ ...entry, path: resolve(root, entry.path), source: 'shared', enabled: !disabled.has(entry.id) }))
  const local = (config.extensions?.local ?? []).map((entry) => ({ id: entry.id, path: resolve(root, entry.path), source: 'local', enabled: entry.enabled ?? false }))
  return [...shared, ...local]
}

export async function descriptorManifest(descriptor) {
  const path = join(descriptor.path, 'extension.json')
  const manifest = await readJson(path, null)
  if (!manifest) return { descriptor, path, manifest: null, error: 'manifest missing' }
  try {
    await validateContract('ExtensionManifest', manifest)
    if (manifest.id !== descriptor.id) throw new HairnessError('extension_id_mismatch', `${descriptor.id} does not match ${manifest.id}.`, { exitCode: 2 })
    const capabilities = await loadCapabilities(descriptor.path, manifest)
    return { descriptor, path, manifest, capabilities, error: null }
  } catch (error) {
    return { descriptor, path, manifest, error: error.message }
  }
}

async function trustState() {
  return readJson(userPaths().trust, { schemaVersion: 2, protocolVersion: '0.2', workspaces: {}, extensions: {} })
}

async function assertTrusted(root, descriptor) {
  const trust = await trustState()
  if (!trust.workspaces?.[root]?.trusted) throw new HairnessError('workspace_untrusted', `Workspace is not trusted: ${root}`, { routes: ['hairness onboarding plan'] })
  if (descriptor.source === 'local' && !trust.extensions?.[descriptor.id]?.trusted) throw new HairnessError('extension_untrusted', `Local extension is not trusted: ${descriptor.id}`, { routes: [`hairness extension enable ${descriptor.id}`] })
}

function modulePathFor(inspected) {
  const modulePath = resolve(inspected.descriptor.path, inspected.manifest.module)
  if (relative(inspected.descriptor.path, modulePath).startsWith('..')) throw new HairnessError('extension_module_escape', `Extension module escapes its root: ${modulePath}`, { exitCode: 2 })
  return modulePath
}

async function loadModule(inspected) {
  const module = await import(`${pathToFileURL(modulePathFor(inspected)).href}?v=${Date.now()}`)
  return module
}

function extensionFailure(owner, error) {
  if (error instanceof HairnessError) return error
  const usage = /^(Usage:|Unknown |Invalid )|requires /.test(error.message)
  return new HairnessError(usage ? 'extension_input_invalid' : 'extension_failed', error.message, { exitCode: usage ? 2 : 3, details: { owner } })
}

async function enabledInspected(root) {
  const values = []
  for (const descriptor of await descriptors(root)) {
    if (!descriptor.enabled) continue
    const inspected = await descriptorManifest(descriptor)
    if (descriptor.source === 'local' && (!inspected.manifest || !Array.isArray(inspected.manifest.capabilities))) continue
    if (inspected.error) throw new HairnessError('extension_invalid', `${descriptor.id}: ${inspected.error}`, { exitCode: 2 })
    values.push(inspected)
  }
  validateDependencyGraph(values)
  validateCapabilities(values)
  return values
}

function validateCapabilities(values) {
  const index = capabilityIndex(values)
  const modifiers = new Set(values.flatMap((value) => (value.manifest.intentModifiers ?? []).map((item) => item.id)))
  for (const value of values) for (const command of value.manifest.providerCommands) {
    if (command.kind !== 'bridge') resolveOperation(index, command.operation)
    for (const modifier of command.acceptsModifiers ?? []) if (!modifiers.has(modifier)) throw new HairnessError('modifier_unknown', `${command.id} accepts unknown modifier ${modifier}.`, { exitCode: 2 })
  }
  return index
}

function validateDependencyGraph(values) {
  const byId = new Map(values.map((value) => [value.manifest.id, value]))
  for (const value of values) for (const dependency of value.manifest.dependencies ?? []) {
    if (!byId.has(dependency)) throw new HairnessError('extension_dependency_missing', `${value.manifest.id} requires ${dependency}.`, { exitCode: 4 })
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(id, path = []) {
    if (visiting.has(id)) throw new HairnessError('extension_dependency_cycle', `Extension dependency cycle: ${[...path, id].join(' -> ')}`, { exitCode: 2 })
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.manifest.dependencies ?? []) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
  return byId
}

async function listRuns(root) {
  const entries = await readdir(workspacePaths(root).runs, { withFileTypes: true }).catch(() => [])
  return Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== '.plans').map(async (entry) => {
    try { return await readRun(root, entry.name) }
    catch (error) {
      return {
        id: entry.name,
        state: 'unknown',
        incompatible: true,
        limits: ['run-protocol-incompatible'],
        error: error.code ?? 'run-invalid',
      }
    }
  }))
}

async function validateAssignmentOperation(root, assignment) {
  const index = capabilityIndex(await enabledInspected(root))
  const operation = resolveOperation(index, assignment.operation)
  validateOperationProfile(operation, assignment.profile)
  if (operation.class === 'effect' && assignment.requestedEffects.length === 0) throw new HairnessError('operation_effect_missing', `${operation.capability}#${operation.id} requires requested effects.`, { exitCode: 2 })
  if (operation.class !== 'effect' && assignment.requestedEffects.length) throw new HairnessError('operation_effect_forbidden', `${operation.capability}#${operation.id} cannot request effects.`, { exitCode: 2 })
  return assignment
}

async function validatePlanOperations(root, plan) {
  const index = capabilityIndex(await enabledInspected(root))
  for (const route of plan.routes) {
    const operation = resolveOperation(index, route.operation)
    if (route.kind === 'worker') validateOperationProfile(operation, route.profile)
    if (!operation.routes.includes(route.kind)) throw new HairnessError('operation_route_unsupported', `${operation.capability}#${operation.id} does not support ${route.kind}.`, { exitCode: 2 })
  }
  return plan
}

async function runtimeFor(root, owner, stack = []) {
  const inspected = (await enabledInspected(root)).find((value) => value.manifest.id === owner)
  if (!inspected) throw new HairnessError('extension_not_enabled', `${owner} is not enabled.`, { exitCode: 4 })
  const bindings = {
    contracts: {
      validate: validateContract,
      validateSchema: async (schema, value, label = 'extension payload') => {
        const schemaPath = resolve(inspected.descriptor.path, schema)
        if (relative(inspected.descriptor.path, schemaPath).startsWith('..')) throw new HairnessError('extension_schema_escape', `${owner} schema escapes its root.`, { exitCode: 2 })
        return validateJsonSchema(schemaPath, value, label)
      },
    },
    distribution: {
      read: () => distribution(root),
      preferences: (overrides = {}) => resolvePreferences(root, overrides),
      ...(owner === 'hairness/distribution' ? { update: {
        inspect: () => inspectDistribution(root),
        check: () => checkDistributionUpdate(root),
        doctor: () => doctorDistribution(root),
        plan: (options = {}) => planDistributionUpdate(root, options),
        apply: (planId, checkpointId) => applyDistributionUpdate(root, planId, checkpointId),
      } } : {}),
    },
    runs: {
      create: async (value) => createRun(root, { ...value, assignment: await validateAssignmentOperation(root, value.assignment) }), read: (id) => readRun(root, id), list: () => listRuns(root),
      transition: (id, state, detail) => transitionRun(root, id, state, detail), result: (id, value) => value === undefined ? readRunResult(root, id) : submitRunResult(root, value),
      capsule: (id) => buildWorkerCapsule(root, id), checkpoint: (value) => grantCheckpoint(root, value, (effects) => aggregateAuthorityPolicy(root, effects)),
    },
    plans: { read: (id) => readPlan(root, id), write: async (value) => writePlan(root, await validatePlanOperations(root, value)), reduce: (id) => reduceStoredPlan(root, id) },
    artifacts: {
      read: (id, revision) => readArtifact(root, id, revision), history: (id) => artifactHistory(root, id),
      stage: async (runId, value) => { await validateArtifactPayload(root, value); return stageArtifact(root, runId, value) }, promote: (runId) => promoteArtifact(root, runId),
    },
    authority: {
      grant: (value) => grantCheckpoint(root, value, (effects) => aggregateAuthorityPolicy(root, effects)), acquireLocks, releaseLocks, quarantineLocks,
    },
    extensions: {
      list: () => listExtensions(root), call: (id, service, input = {}) => callService(root, owner, id, service, input, stack),
      collect: (contribution, input = {}) => collectContributions(root, contribution, input, stack),
    },
  }
  return createExtensionRuntime({ root, extensionId: owner, bindings })
}

async function commandOwner(root, namespace) {
  const found = (await enabledInspected(root)).filter((value) => value.manifest.commands.some((command) => command.namespace === namespace))
  if (found.length === 0) {
    const declared = []
    for (const descriptor of await descriptors(root)) {
      const value = await descriptorManifest(descriptor)
      if (!value.error && value.manifest.commands.some((command) => command.namespace === namespace)) declared.push(descriptor.id)
    }
    if (declared.length) throw new HairnessError('command_unavailable', `No enabled extension owns ${namespace}.`, { exitCode: 4, routes: ['hairness extension list'] })
    throw new HairnessError('unknown_command', `Unknown command: ${namespace}`, { exitCode: 2 })
  }
  if (found.length > 1) throw new HairnessError('command_conflict', `Multiple extensions own ${namespace}: ${found.map((item) => item.descriptor.id).join(', ')}`, { exitCode: 2 })
  await assertTrusted(root, found[0].descriptor)
  const module = await loadModule(found[0])
  if (typeof module.handleCommand !== 'function') throw new HairnessError('extension_handler_missing', `${found[0].descriptor.id} has no handleCommand export.`, { exitCode: 2 })
  return { ...found[0], module }
}

async function callService(root, caller, id, service, input, stack) {
  if (stack.includes(id)) throw new HairnessError('extension_service_cycle', `Extension service cycle: ${[...stack, id].join(' -> ')}`, { exitCode: 2 })
  const all = await enabledInspected(root)
  const callerManifest = all.find((value) => value.manifest.id === caller)?.manifest
  if (!callerManifest?.dependencies?.includes(id)) throw new HairnessError('extension_dependency_undeclared', `${caller} cannot call undeclared dependency ${id}.`, { exitCode: 2 })
  const target = all.find((value) => value.manifest.id === id)
  if (!target) throw new HairnessError('extension_dependency_missing', `${id} is not enabled.`, { exitCode: 4 })
  await assertTrusted(root, target.descriptor)
  if (!target.manifest.services?.includes(service)) throw new HairnessError('extension_service_undeclared', `${id} does not declare service ${service}.`, { exitCode: 2 })
  const module = await loadModule(target)
  if (typeof module.services?.[service] !== 'function') throw new HairnessError('extension_service_missing', `${id} does not export service ${service}.`, { exitCode: 2 })
  return module.services[service]({ root, input, manifest: target.manifest, runtime: await runtimeFor(root, id, [...stack, caller]) })
}

export async function callExtensionService(root, id, service, input = {}) {
  const target = (await enabledInspected(root)).find((value) => value.manifest.id === id)
  if (!target) throw new HairnessError('extension_not_enabled', `${id} is not enabled.`, { exitCode: 4 })
  await assertTrusted(root, target.descriptor)
  if (!target.manifest.services?.includes(service)) throw new HairnessError('extension_service_undeclared', `${id} does not declare service ${service}.`, { exitCode: 2 })
  const module = await loadModule(target)
  if (typeof module.services?.[service] !== 'function') throw new HairnessError('extension_service_missing', `${id} does not export service ${service}.`, { exitCode: 2 })
  return module.services[service]({ root, input, manifest: target.manifest, runtime: await runtimeFor(root, id) })
}

export async function collectContributions(root, contribution, input, stack = []) {
  const output = []
  for (const value of await enabledInspected(root)) {
    if (!(value.manifest.contributes ?? []).includes(contribution)) continue
    await assertTrusted(root, value.descriptor)
    const module = await loadModule(value)
    const handlers = {
      attention: module.attentionSignals,
      'authority-policy': module.authorityPolicy,
      'session-opening': module.sessionContributions,
      'session-renderer': module.renderSessionOpening,
      'provider-hooks': module.providerHooks,
    }
    const handler = handlers[contribution]
    if (typeof handler !== 'function') throw new HairnessError('extension_contribution_missing', `${value.manifest.id} does not export ${contribution}.`, { exitCode: 2 })
    const values = await handler({ root, input, manifest: value.manifest, runtime: await runtimeFor(root, value.manifest.id, stack) })
    if (contribution === 'session-renderer') output.push({ owner: value.manifest.id, value: values })
    else for (const item of values ?? []) {
      const contract = contribution === 'attention' ? 'AttentionSignal' : contribution === 'authority-policy' ? 'EffectPolicy' : contribution === 'session-opening' ? 'SessionContribution' : null
      output.push(contract ? await validateContract(contract, item) : item)
    }
  }
  return output
}

export async function collectOnboardingContributions(root, phase, input = {}, options = {}) {
  if (input.trustDecision !== 'trust') throw new HairnessError('workspace_untrusted', 'Extension onboarding requires an explicit trust decision.', { exitCode: 3 })
  const output = []
  for (const value of await enabledInspected(root)) {
    if (!(value.manifest.contributes ?? []).includes('onboarding')) continue
    if (options.applied) await assertTrusted(root, value.descriptor)
    const module = await loadModule(value)
    if (typeof module.onboardingContributions !== 'function') throw new HairnessError('extension_contribution_missing', `${value.manifest.id} does not export onboardingContributions.`, { exitCode: 2 })
    const runtime = options.applied
      ? await runtimeFor(root, value.manifest.id)
      : Object.freeze({ contracts: Object.freeze({ validate: validateContract }), distribution: Object.freeze({ read: () => distribution(root) }) })
    const contribution = await module.onboardingContributions({ root, phase, input, manifest: value.manifest, runtime })
    output.push({ owner: value.manifest.id, value: contribution ?? {} })
  }
  return output
}

export async function aggregateAuthorityPolicy(root, requestedEffects, input = {}) {
  const policies = await collectContributions(root, 'authority-policy', { ...input, requestedEffects })
  const denied = [...new Set(policies.flatMap((policy) => policy.deniedEffects))]
  const allowedEffects = requestedEffects.filter((effect) => !denied.includes(effect) && policies.every((policy) => policy.allowedEffects.includes(effect)))
  const payload = { requestedEffects, allowedEffects, deniedEffects: requestedEffects.filter((effect) => !allowedEffects.includes(effect)), policies: policies.map((policy) => policy.digest) }
  return {
    owner: 'protocol/authority',
    requestedEffects,
    allowedEffects,
    deniedEffects: payload.deniedEffects,
    reasons: policies.flatMap((policy) => policy.reasons),
    digest: `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`,
    observedAt: new Date().toISOString(),
  }
}

export async function validateArtifactPayload(root, envelope) {
  const enabled = await enabledInspected(root)
  const owners = []
  for (const value of enabled) for (const artifact of value.manifest.artifactSchemas ?? []) {
    if (artifact.type === envelope.type) owners.push({ value, artifact })
  }
  if (owners.length !== 1) throw new HairnessError(owners.length ? 'artifact_owner_conflict' : 'artifact_owner_missing', `Artifact type ${envelope.type} has ${owners.length} owners.`, { exitCode: 2 })
  if (envelope.owner !== owners[0].value.manifest.id) throw new HairnessError('artifact_owner_mismatch', `Artifact ${envelope.id} declares ${envelope.owner}, expected ${owners[0].value.manifest.id}.`, { exitCode: 2 })
  const schemaPath = resolve(owners[0].value.descriptor.path, owners[0].artifact.schema)
  if (relative(owners[0].value.descriptor.path, schemaPath).startsWith('..')) throw new HairnessError('artifact_schema_escape', `Artifact schema escapes ${owners[0].value.manifest.id}.`, { exitCode: 2 })
  await validateJsonSchema(schemaPath, envelope.payload, `${envelope.type} payload`)
  const relationTypes = new Set(enabled.flatMap((value) => value.manifest.relationTypes ?? []))
  const seen = new Set()
  for (const relation of envelope.metadata.relations) {
    if (!relationTypes.has(relation.type)) throw new HairnessError('artifact_relation_unknown', `Unknown relation type ${relation.type}.`, { exitCode: 2 })
    const key = `${relation.type}:${relation.target.kind}:${relation.target.id}:${relation.target.revision ?? ''}`
    if (seen.has(key)) throw new HairnessError('artifact_relation_duplicate', `Duplicate artifact relation ${key}.`, { exitCode: 2 })
    seen.add(key)
    if (relation.target.kind === 'artifact') await readArtifact(root, relation.target.id, relation.target.revision)
  }
  return envelope
}

export async function listExtensions(root) {
  return Promise.all((await descriptors(root)).map(async (descriptor) => {
    const inspected = await descriptorManifest(descriptor)
    const legacy = descriptor.source === 'local' && (!inspected.manifest || !Array.isArray(inspected.manifest.capabilities))
    return { id: descriptor.id, source: descriptor.source, enabled: descriptor.enabled && !legacy, valid: !inspected.error && !legacy, ignored: legacy, error: legacy ? 'legacy-extension-state' : inspected.error, path: descriptor.path, methodologyBindings: inspected.manifest?.methodologyBindings ?? [], providerCommands: legacy ? [] : (inspected.manifest?.providerCommands ?? []).map(({ name, summary, command, classification }) => ({ name, summary, classification, owner: descriptor.id, route: command })) }
  }))
}

function parseExtensionId(id) {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id)) throw new HairnessError('invalid_extension_id', `Invalid extension id: ${id}`, { exitCode: 2 })
  return id.split('/')
}

async function initLocalExtension(root, id) {
  const [namespace, name] = parseExtensionId(id)
  const path = join(workspacePaths(root).extensions, namespace, name)
  if (await readJson(join(path, 'extension.json'), null)) throw new HairnessError('extension_exists', `Extension already exists: ${id}`, { exitCode: 2 })
  await mkdir(path, { recursive: true })
  await writeJsonAtomic(join(path, 'extension.json'), { $schema: join(root, 'schemas/extension.schema.json'), schemaVersion: 2, protocolVersion: '0.2', id, version: '0.2.0-alpha.0', summary: `${id} local capability.`, category: 'ecosystem', tags: ['local'], maturity: 'experimental', readme: './README.md', module: './index.mjs', capabilities: [], dependencies: [], commands: [], providerCommands: [], services: [], contributes: [], artifactSchemas: [] })
  await writeFile(join(path, 'index.mjs'), 'export const services = {}\n')
  await writeFile(join(path, 'README.md'), `# ${id}\n\n## Value and use cases\n\nDescribe the one capability this extension adds.\n\n## Selection and setup\n\nThis extension is local, disabled by default and must be explicitly trusted.\n\n## Capabilities and operations\n\nAdd only operations that the extension owns.\n\n## Inputs, controls and results\n\nDeclare typed inputs and results in the extension source.\n\n## State and artifacts\n\nLocal state is owner-scoped. Scratch is never authoritative.\n\n## Effects and safety\n\nNo effect or authority is implied by installation.\n\n## Providers\n\nProvider commands are compiled from this extension when enabled.\n\n## Tests and maturity\n\nMaturity: experimental. Add one runnable proof for every non-trivial behavior.\n`)
  const config = await readJson(workspacePaths(root).config, { schemaVersion: 2, protocolVersion: '0.2', extensions: { disabled: [], local: [] } })
  config.extensions ??= { disabled: [], local: [] }
  config.extensions.local ??= []
  config.extensions.local.push({ id, path: `./.overlay/extensions/${namespace}/${name}`, enabled: false })
  await writeJsonAtomic(workspacePaths(root).config, config)
  return { summary: `Created local extension ${id}.`, status: 'disabled', path, limits: [], routes: [`hairness extension enable ${id}`] }
}

async function sourceResolver(root, requestedId, from) {
  if (!from) throw new HairnessError('extension_source_required', 'extension add requires --from <path|tarball|npm-spec>.', { exitCode: 2 })
  await mkdir(workspacePaths(root).scratch, { recursive: true })
  let source = from.startsWith('.') || from.startsWith('/') || from.startsWith('~') ? resolve(root, from.replace(/^~(?=\/)/, process.env.HOME ?? '~')) : null
  let temporary = null
  if (!source || source.endsWith('.tgz')) {
    temporary = await mkdtemp(join(workspacePaths(root).scratch, 'extension-source-'))
    let tarball = source
    if (!tarball) {
      const packed = await exec('npm', ['pack', from, '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', timeout: 120_000 })
      const result = JSON.parse(packed.stdout)
      tarball = join(temporary, result[0].filename)
    }
    await exec('tar', ['-xzf', tarball, '-C', temporary], { encoding: 'utf8', timeout: 30_000 })
    source = await readJson(join(temporary, 'package', 'package.json'), null) ? join(temporary, 'package') : temporary
  }
  const resolveSource = async (id) => {
    const candidates = [source, join(source, 'extensions', ...id.split('/')), join(source, ...id.split('/')), join(source, 'catalog', 'extensions', ...id.split('/'))]
    for (const candidate of candidates) {
      const manifest = await readJson(join(candidate, 'extension.json'), null)
      if (!manifest || manifest.id !== id) continue
      await validateContract('ExtensionManifest', manifest)
      return { id, source: candidate, manifest }
    }
    return null
  }
  return { resolveSource, cleanup: async () => { if (temporary) await rm(temporary, { recursive: true, force: true }) } }
}

async function extensionClosure(resolveSource, id, materialized) {
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  async function visit(next) {
    if (materialized.has(next) || visited.has(next)) return
    if (visiting.has(next)) throw new HairnessError('extension_dependency_cycle', `Catalog dependency cycle at ${next}.`, { exitCode: 2 })
    const item = await resolveSource(next)
    if (!item) throw new HairnessError('extension_source_missing', `Explicit source does not contain ${next}.`, { exitCode: 4 })
    visiting.add(next)
    for (const dependency of item.manifest.dependencies ?? []) await visit(dependency)
    visiting.delete(next)
    visited.add(next)
    ordered.push(item)
  }
  await visit(id)
  return ordered
}

async function addSharedExtension(root, id, checkpoint, from) {
  parseExtensionId(id)
  const manifest = await distribution(root)
  const source = await sourceResolver(root, id, from)
  const closure = await extensionClosure(source.resolveSource, id, new Set(manifest.extensions.map((entry) => entry.id)))
  if (!closure.length) { await source.cleanup(); return { summary: `${id} is already materialized.`, status: 'present', limits: [], routes: [] } }
  const checkpointId = `extension-${Buffer.from(`${root}:${closure.map((item) => item.id).join(',')}`).toString('base64url').slice(0, 16)}`
  const plan = { checkpointId, mode: 'mutation', intent: `Materialize ${closure.map((item) => item.id).join(', ')} from ${from}.`, source: from, targets: [...closure.map((item) => join(root, 'extensions', ...item.id.split('/'))), join(root, 'hairness.json')], effects: ['copy-extension', 'update-distribution', 'rebuild-providers'], exclusions: ['implicit registry', 'commit', 'push'], risk: 'Copies inspected source-owned extension files and changes provider projections.' }
  if (!checkpoint) { await source.cleanup(); return plan }
  if (checkpoint !== checkpointId) { await source.cleanup(); throw new HairnessError('checkpoint_mismatch', 'Extension checkpoint does not match.', { exitCode: 2 }) }
  for (const item of closure) {
    const destination = join(root, 'extensions', ...item.id.split('/'))
    await cp(item.source, destination, { recursive: true })
    manifest.extensions.push({ id: item.id, path: `./extensions/${item.id}` })
  }
  await source.cleanup()
  await writeJsonAtomic(join(root, 'hairness.json'), manifest)
  const config = await readJson(workspacePaths(root).config, null)
  if (config?.extensions && Array.isArray(config.extensions.disabled)) {
    config.extensions.disabled = config.extensions.disabled.filter((id) => !closure.some((item) => item.id === id))
    await writeJsonAtomic(workspacePaths(root).config, config)
  }
  const { buildProviders } = await import('../providers/compiler.mjs')
  await buildProviders(root)
  return { summary: `Added ${closure.map((item) => item.id).join(', ')}.`, status: 'added', limits: [], routes: ['start a new provider session'] }
}

async function linkLocalExtension(root, id, checkpoint, from) {
  parseExtensionId(id)
  if (!from || !(from.startsWith('.') || from.startsWith('/') || from.startsWith('~'))) {
    throw new HairnessError('extension_source_required', 'extension link requires --from <path>.', { exitCode: 2 })
  }
  const config = await readJson(workspacePaths(root).config, { schemaVersion: 2, protocolVersion: '0.2', extensions: { disabled: [], local: [] } })
  config.extensions ??= { disabled: [], local: [] }
  config.extensions.local ??= []
  const shared = new Set((await distribution(root)).extensions.map((entry) => entry.id))
  const local = new Set(config.extensions.local.map((entry) => entry.id))
  const source = await sourceResolver(root, id, from)
  const closure = await extensionClosure(source.resolveSource, id, new Set([...shared, ...local]))
  if (!closure.length) { await source.cleanup(); return { summary: `${id} is already available.`, status: 'present', limits: [], routes: [] } }
  const canonical = await Promise.all(closure.map(async (item) => ({ ...item, source: await realpath(item.source) })))
  const checkpointId = `extension-link-${createHash('sha256').update(JSON.stringify({ root, id, from: canonical.map((item) => [item.id, item.source]) })).digest('hex').slice(0, 12)}`
  const plan = {
    checkpointId,
    mode: 'mutation',
    intent: `Link ${canonical.map((item) => item.id).join(', ')} from an explicit local source.`,
    source: from,
    targets: canonical.map((item) => join(workspacePaths(root).extensions, ...item.id.split('/'))),
    effects: ['link-local-extension', 'trust-local-extension', 'build-local-providers'],
    exclusions: ['source mutation', 'shared projection mutation', 'commit', 'push'],
    risk: 'Executes explicitly trusted local extension code in this workspace.',
  }
  if (!checkpoint) { await source.cleanup(); return plan }
  if (checkpoint !== checkpointId) { await source.cleanup(); throw new HairnessError('checkpoint_mismatch', 'Extension link checkpoint does not match.', { exitCode: 2 }) }
  const trust = await trustState()
  trust.extensions ??= {}
  for (const item of canonical) {
    const [owner, name] = item.id.split('/')
    const destination = join(workspacePaths(root).extensions, owner, name)
    await mkdir(dirname(destination), { recursive: true })
    await symlink(item.source, destination, 'dir').catch((error) => {
      if (error.code === 'EEXIST') throw new HairnessError('extension_link_exists', `Local extension path already exists: ${destination}`, { exitCode: 2 })
      throw error
    })
    config.extensions.local.push({ id: item.id, path: `./.overlay/extensions/${owner}/${name}`, enabled: true, linkedFrom: item.source })
    trust.extensions[item.id] = { trusted: true, path: destination, source: item.source, trustedAt: new Date().toISOString() }
  }
  delete config.extensions.enabled
  await source.cleanup()
  await writeJsonAtomic(workspacePaths(root).config, config)
  await writeJsonAtomic(userPaths().trust, trust)
  const { buildProviders } = await import('../providers/compiler.mjs')
  await buildProviders(root, { local: true })
  return { summary: `Linked ${canonical.map((item) => item.id).join(', ')}.`, status: 'linked', limits: [], routes: ['start a new provider session'] }
}

async function unlinkLocalExtension(root, id, checkpoint) {
  parseExtensionId(id)
  const config = await readJson(workspacePaths(root).config, null)
  const entry = config?.extensions?.local?.find((item) => item.id === id)
  if (!entry?.linkedFrom) throw new HairnessError('extension_link_not_found', `Linked local extension not found: ${id}`, { exitCode: 2 })
  const dependents = []
  for (const candidate of config.extensions.local.filter((item) => item.enabled && item.id !== id)) {
    const inspected = await descriptorManifest({ ...candidate, path: resolve(root, candidate.path), source: 'local', enabled: true })
    if (inspected.manifest?.dependencies?.includes(id)) dependents.push(candidate.id)
  }
  if (dependents.length) throw new HairnessError('extension_dependency_in_use', `${id} is required by ${dependents.join(', ')}.`, { exitCode: 2 })
  const destination = resolve(root, entry.path)
  const checkpointId = `extension-unlink-${createHash('sha256').update(`${root}:${id}:${entry.linkedFrom}`).digest('hex').slice(0, 12)}`
  const plan = { checkpointId, mode: 'mutation', intent: `Unlink local extension ${id}.`, targets: [destination], effects: ['unlink-local-extension', 'remove-local-trust', 'build-local-providers'], exclusions: ['source mutation', 'shared projection mutation', 'commit', 'push'], risk: 'Removes only the workspace-local reference and its local provider projection.' }
  if (!checkpoint) return plan
  if (checkpoint !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Extension unlink checkpoint does not match.', { exitCode: 2 })
  config.extensions.local = config.extensions.local.filter((item) => item.id !== id)
  delete config.extensions.enabled
  await rm(destination, { force: true })
  await writeJsonAtomic(workspacePaths(root).config, config)
  const trust = await trustState()
  if (trust.extensions) delete trust.extensions[id]
  await writeJsonAtomic(userPaths().trust, trust)
  const { buildProviders } = await import('../providers/compiler.mjs')
  await buildProviders(root, { local: true })
  return { summary: `Unlinked ${id}; the source was preserved.`, status: 'unlinked', limits: [], routes: [] }
}

async function removeSharedExtension(root, id, checkpoint) {
  parseExtensionId(id)
  const manifest = await distribution(root)
  const entry = manifest.extensions.find((value) => value.id === id)
  if (!entry) throw new HairnessError('extension_not_found', `Materialized extension not found: ${id}`, { exitCode: 2 })
  const dependents = []
  for (const candidate of manifest.extensions.filter((value) => value.id !== id)) {
    const value = await readJson(join(root, candidate.path, 'extension.json'))
    if (value.dependencies?.includes(id)) dependents.push(candidate.id)
  }
  if (dependents.length) throw new HairnessError('extension_dependency_in_use', `${id} is required by ${dependents.join(', ')}.`, { exitCode: 2 })
  const checkpointId = `extension-remove-${Buffer.from(`${root}:${id}`).toString('base64url').slice(0, 16)}`
  const plan = { checkpointId, mode: 'mutation', intent: `Remove materialized extension ${id}.`, targets: [resolve(root, entry.path), join(root, 'hairness.json')], effects: ['remove-extension', 'update-distribution', 'rebuild-providers'], exclusions: ['catalog source', 'remote registry', 'commit', 'push'], risk: 'Removes the active source-owned extension and its provider projection inputs.' }
  if (!checkpoint) return plan
  if (checkpoint !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Extension removal checkpoint does not match.', { exitCode: 2 })
  await rm(resolve(root, entry.path), { recursive: true, force: true })
  manifest.extensions = manifest.extensions.filter((value) => value.id !== id)
  await writeJsonAtomic(join(root, 'hairness.json'), manifest)
  const config = await readJson(workspacePaths(root).config, null)
  if (config?.extensions && Array.isArray(config.extensions.disabled)) {
    config.extensions.disabled = config.extensions.disabled.filter((value) => value !== id)
    await writeJsonAtomic(workspacePaths(root).config, config)
  }
  const { buildProviders } = await import('../providers/compiler.mjs')
  await buildProviders(root)
  return { summary: `Removed ${id}.`, status: 'removed', limits: [], routes: ['start a new provider session'] }
}

async function setEnabled(root, id, enabled) {
  const all = await descriptors(root)
  const descriptor = all.find((value) => value.id === id)
  if (!descriptor) throw new HairnessError('extension_not_found', `Extension not found: ${id}`)
  if (!enabled) {
    const dependents = []
    for (const value of all.filter((candidate) => candidate.enabled && candidate.id !== id)) {
      const inspected = await descriptorManifest(value)
      if (inspected.manifest?.dependencies?.includes(id)) dependents.push(value.id)
    }
    if (dependents.length) throw new HairnessError('extension_dependency_in_use', `${id} is required by ${dependents.join(', ')}.`, { exitCode: 2 })
  }
  const config = await readJson(workspacePaths(root).config, { schemaVersion: 2, protocolVersion: '0.2', extensions: { disabled: [], local: [] } })
  config.extensions ??= { disabled: [], local: [] }
  config.extensions.disabled ??= []
  config.extensions.disabled = enabled ? config.extensions.disabled.filter((value) => value !== id) : [...new Set([...config.extensions.disabled, id])]
  const local = config.extensions.local?.find((value) => value.id === id)
  if (local) local.enabled = enabled
  await writeJsonAtomic(workspacePaths(root).config, config)
  if (descriptor.source === 'local') {
    const trust = await trustState()
    trust.extensions ??= {}
    if (enabled) trust.extensions[id] = { trusted: true, path: descriptor.path, trustedAt: new Date().toISOString() }
    else delete trust.extensions[id]
    await writeJsonAtomic(userPaths().trust, trust)
  }
  return { summary: `${enabled ? 'Enabled' : 'Disabled'} ${id}.`, status: enabled ? 'enabled' : 'disabled', limits: [], routes: [`hairness extension doctor ${id}`] }
}

async function doctorExtension(root, id) {
  const descriptor = (await descriptors(root)).find((value) => value.id === id)
  if (!descriptor) throw new HairnessError('extension_not_found', `Extension not found: ${id}`)
  const inspected = await descriptorManifest(descriptor)
  const legacy = descriptor.source === 'local' && (!inspected.manifest || !Array.isArray(inspected.manifest.capabilities))
  if (legacy) return { schemaVersion: 2, protocolVersion: '0.2', subject: `extension:${id}`, status: 'partial', checks: [{ name: 'manifest', ok: false }, { name: 'enabled', ok: false }, { name: 'runtime', ok: true }], limits: ['legacy-extension-state'], routes: [`hairness extension unlink --local ${id}`] }
  let runtimeError = null
  if (!inspected.error && descriptor.enabled) try { await enabledInspected(root); await assertTrusted(root, descriptor); await loadModule(inspected) } catch (error) { runtimeError = error.message }
  const error = inspected.error ?? runtimeError
  return { schemaVersion: 2, protocolVersion: '0.2', subject: `extension:${id}`, status: error ? 'blocked' : descriptor.enabled ? 'ready' : 'partial', checks: [{ name: 'manifest', ok: !inspected.error }, { name: 'enabled', ok: descriptor.enabled }, { name: 'runtime', ok: !runtimeError }], limits: [error, descriptor.enabled ? null : 'extension is disabled'].filter(Boolean), routes: descriptor.enabled ? [] : [`hairness extension enable ${id}`] }
}

export async function extensionCommand(root, namespace, target, action, rest, flags) {
  if (namespace === 'extension') {
    const mode = target ?? 'list'
    if (mode === 'list') return { extensions: await listExtensions(root) }
    if (mode === 'add') return addSharedExtension(root, action, flags.checkpoint, flags.from)
    if (mode === 'remove') return removeSharedExtension(root, action, flags.checkpoint)
    if (mode === 'link') {
      if (!flags.local || flags.local === true) throw new HairnessError('usage', 'Usage: hairness extension link --local <namespace/name> --from <path>', { exitCode: 2 })
      return linkLocalExtension(root, flags.local, flags.checkpoint, flags.from)
    }
    if (mode === 'unlink') {
      if (!flags.local || flags.local === true) throw new HairnessError('usage', 'Usage: hairness extension unlink --local <namespace/name>', { exitCode: 2 })
      return unlinkLocalExtension(root, flags.local, flags.checkpoint)
    }
    if (mode === 'init') {
      if (!flags.local || flags.local === true) throw new HairnessError('usage', 'Usage: hairness extension init --local <namespace/name>', { exitCode: 2 })
      return initLocalExtension(root, flags.local)
    }
    if (mode === 'enable') return setEnabled(root, action, true)
    if (mode === 'disable') return setEnabled(root, action, false)
    if (mode === 'doctor') return doctorExtension(root, action)
    throw new HairnessError('unknown_command', `Unknown extension action: ${mode}`, { exitCode: 2 })
  }
  const owner = await commandOwner(root, namespace)
  try { return await owner.module.handleCommand({ root, namespace, target, action, rest, flags, manifest: owner.manifest, runtime: await runtimeFor(root, owner.manifest.id) }) }
  catch (error) { throw extensionFailure(owner.manifest.id, error) }
}

export { validateDependencyGraph }
