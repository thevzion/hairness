import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { activeExtensions, inspectExtension, resolveExtensionSource, validateComposition } from './extensions.mjs'
import { loadHome, loadHomeLock } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { copyTree, digest, exists, readJson, treeDigest, writeJsonAtomic } from '../lib/io.mjs'
import { applyEffect, prepareEffect } from '../operations/index.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { ensureRuntime, runtimePaths } from '../runtime/index.mjs'

export async function listExtensions(root) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  return home.spec.extensions.map((id) => {
    const entry = lock.extensions.find((item) => item.id === id)
    return { id, source: entry?.source ?? null, resolvedCommit: entry?.resolvedCommit ?? null, digest: entry?.digest ?? null }
  })
}

export async function initializeExtension(path, id) {
  const destination = resolve(path)
  if (await exists(destination)) throw new HairnessError('destination_exists', `Destination already exists: ${destination}.`)
  const recipeId = `hairness-${id.split('/').at(-1)}`
  await mkdir(join(destination, 'recipes'), { recursive: true })
  await writeJsonAtomic(join(destination, 'extension.json'), {
    apiVersion: 'hairness.dev/extension/v1alpha1',
    kind: 'Extension',
    metadata: { id, version: '0.1.0', summary: `${id} agentic assets.` },
    spec: {
      provides: [`${id.replace('/', '.')}.chat`], requires: [],
      recipes: [{ id: recipeId, path: `recipes/${recipeId}.md`, summary: `Run the ${id} recipe.`, capability: `${id.replace('/', '.')}.chat` }],
      adapters: [], schemas: [], gates: [], onboarding: [], tests: [],
    },
  })
  await writeFile(join(destination, 'recipes', `${recipeId}.md`), `Guide the user through ${id} directly in chat. Persist nothing unless explicitly asked.\n`)
  return inspectExtension(destination)
}

export async function prepareExtensionAdd(root, source, options = {}) {
  const home = await loadHome(root)
  if (home.spec.extensions.includes(options.id ?? source)) throw new HairnessError('extension_active', `${options.id ?? source} is already active.`)
  const runtime = await ensureRuntime(home)
  const resolved = await resolveExtensionSource(source, { ...options, tmp: runtime.tmp })
  try {
    if (home.spec.extensions.includes(resolved.manifest.metadata.id)) throw new HairnessError('extension_active', `${resolved.manifest.metadata.id} is already active.`)
    const current = await activeExtensions(root, home)
    validateComposition([...current, resolved])
    const candidate = join(runtime.tmp, 'extensions', randomUUID())
    await copyTree(resolved.root, candidate)
    const plan = {
      action: 'add',
      id: resolved.manifest.metadata.id,
      candidate,
      destination: join(root, 'extensions', ...resolved.manifest.metadata.id.split('/')),
      provenance: resolved.provenance,
    }
    return prepareExtensionPlan(root, home, plan, resolved.digest)
  } finally {
    await resolved.cleanup()
  }
}

export async function prepareExtensionUpdate(root, id) {
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  const lock = await loadHomeLock(root)
  const entry = lock.extensions.find((item) => item.id === id)
  if (!entry) throw new HairnessError('extension_not_active', `${id} is not active.`)
  const installed = join(root, 'extensions', ...id.split('/'))
  const installedDigest = await treeDigest(installed)
  if (installedDigest !== entry.installedBaseDigest) {
    throw new HairnessError('extension_diverged', `${id} has local changes. Adopt them or merge the update manually.`, { exitCode: 5, details: { expected: entry.installedBaseDigest, actual: installedDigest } })
  }
  if (entry.sourceKind === 'adopted') return { status: 'current', id, digest: installedDigest, limit: 'adopted extensions have no upstream update source' }
  const resolved = await resolveExtensionSource(entry.source, { ref: entry.requestedRef, path: entry.path, tmp: runtime.tmp })
  try {
    if (resolved.digest === installedDigest) return { status: 'current', id, digest: installedDigest }
    const current = await activeExtensions(root, home)
    validateComposition(current.map((item) => item.manifest.metadata.id === id ? resolved : item))
    const candidate = join(runtime.tmp, 'extensions', randomUUID())
    await copyTree(resolved.root, candidate)
    const plan = { action: 'update', id, candidate, destination: installed, provenance: resolved.provenance }
    return prepareExtensionPlan(root, home, plan, resolved.digest)
  } finally {
    await resolved.cleanup()
  }
}

export async function prepareExtensionRemove(root, id) {
  const home = await loadHome(root)
  const extensions = await activeExtensions(root, home)
  const removed = extensions.find((item) => item.manifest.metadata.id === id)
  if (!removed) throw new HairnessError('extension_not_active', `${id} is not active.`)
  const provided = new Set(removed.manifest.spec.provides)
  const blocked = extensions.filter((item) => item !== removed && item.manifest.spec.requires.some((capability) => provided.has(capability))).map((item) => item.manifest.metadata.id)
  if (blocked.length) throw new HairnessError('extension_required', `${id} is required by ${blocked.join(', ')}.`)
  validateComposition(extensions.filter((item) => item !== removed))
  const plan = { action: 'remove', id, candidate: null, destination: removed.root, provenance: null }
  return prepareExtensionPlan(root, home, plan, await treeDigest(removed.root))
}

export async function prepareExtensionAdopt(root, path) {
  const home = await loadHome(root)
  const inspected = await inspectExtension(path)
  const rel = relative(await realpath(join(root, 'extensions')), inspected.root)
  if (rel.startsWith('..')) throw new HairnessError('adopt_outside_home', 'Adopt only registers source already present under this Home extensions directory; use add for external source.')
  const current = await activeExtensions(root, home)
  const active = home.spec.extensions.includes(inspected.manifest.metadata.id)
  validateComposition(active ? current.map((item) => item.manifest.metadata.id === inspected.manifest.metadata.id ? inspected : item) : [...current, inspected])
  const plan = {
    action: active ? 'adopt' : 'add-present',
    id: inspected.manifest.metadata.id,
    candidate: null,
    destination: inspected.root,
    provenance: { kind: 'adopted', source: relative(root, inspected.root), requestedRef: null, resolvedCommit: null, path: '.', digest: inspected.digest },
  }
  return prepareExtensionPlan(root, home, plan, inspected.digest)
}

async function prepareExtensionPlan(root, home, plan, candidateDigest) {
  const lock = await loadHomeLock(root)
  const checkpoint = await prepareEffect(root, {
    operation: `extension.${plan.action}`,
    adapter: 'hairness/cockpit:extension-lifecycle',
    inputs: plan,
    evidence: { candidateDigest },
    policy: { activation: 'explicit', executeBeforeTrust: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  })
  const runtime = await ensureRuntime(home)
  await writeJsonAtomic(join(runtime.checkpoints, `${checkpoint.metadata.id}.extension.json`), { ...plan, candidateDigest })
  return { status: 'checkpoint-required', preview: { action: plan.action, id: plan.id, add: ['add', 'add-present'].includes(plan.action) ? [plan.id] : [], remove: plan.action === 'remove' ? [plan.id] : [], update: plan.action === 'update' ? [plan.id] : [] }, checkpoint }
}

export async function applyExtensionPlan(root, checkpointId) {
  const home = await loadHome(root)
  const runtime = runtimePaths(home.metadata.id)
  const plan = await readJson(join(runtime.checkpoints, `${checkpointId}.extension.json`))
  const lock = await loadHomeLock(root)
  const current = {
    inputs: withoutCandidateDigest(plan),
    evidence: { candidateDigest: plan.candidateDigest },
    policy: { activation: 'explicit', executeBeforeTrust: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  }
  return applyEffect(root, checkpointId, current, async () => applyFilesystemPlan(root, home, lock, plan))
}

async function applyFilesystemPlan(root, home, lock, plan) {
  const oldHome = structuredClone(home)
  const oldLock = structuredClone(lock)
  const backup = join(runtimePaths(home.metadata.id).tmp, 'extensions', `backup-${randomUUID()}`)
  let movedExisting = false
  let movedCandidate = false
  try {
    if (['update', 'remove'].includes(plan.action)) {
      await mkdir(join(backup, '..'), { recursive: true })
      await rename(plan.destination, backup)
      movedExisting = true
    }
    if (['add', 'update'].includes(plan.action)) {
      await mkdir(join(plan.destination, '..'), { recursive: true })
      await rename(plan.candidate, plan.destination)
      movedCandidate = true
    }
    if (['add', 'add-present'].includes(plan.action)) home.spec.extensions.push(plan.id)
    if (plan.action === 'remove') home.spec.extensions = home.spec.extensions.filter((id) => id !== plan.id)
    if (plan.action === 'remove') lock.extensions = lock.extensions.filter((entry) => entry.id !== plan.id)
    else {
      const entry = {
        id: plan.id,
        source: plan.provenance.source,
        sourceKind: plan.provenance.kind,
        requestedRef: plan.provenance.requestedRef,
        resolvedCommit: plan.provenance.resolvedCommit,
        path: plan.provenance.path,
        digest: plan.candidateDigest,
        installedBaseDigest: plan.candidateDigest,
      }
      const index = lock.extensions.findIndex((item) => item.id === plan.id)
      if (index >= 0) lock.extensions[index] = entry
      else lock.extensions.push(entry)
    }
    await writeJsonAtomic(join(root, 'hairness.json'), home)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), lock)
    await buildProviders(root)
    if (movedExisting) await rm(backup, { recursive: true, force: true })
    return { action: plan.action, id: plan.id, composition: home.spec.extensions }
  } catch (error) {
    await writeJsonAtomic(join(root, 'hairness.json'), oldHome)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), oldLock)
    if (movedCandidate) await rm(plan.destination, { recursive: true, force: true })
    if (movedExisting && await exists(backup)) await rename(backup, plan.destination)
    await buildProviders(root).catch(() => {})
    throw error
  }
}

function withoutCandidateDigest(plan) {
  const { candidateDigest, ...value } = plan
  return value
}
