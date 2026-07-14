import { basename, join, resolve } from 'node:path'
import { loadHome, loadHomeLock } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { applyEffect, prepareEffect } from '../operations/index.mjs'
import { bindTarget, ensureRuntime, runtimePaths, targetBindings } from '../runtime/index.mjs'
import { inspectGit } from '../runtime/git.mjs'

export async function listTargets(root) {
  const home = await loadHome(root)
  const bindings = await targetBindings(home)
  const values = []
  for (const target of home.spec.targets) {
    const binding = bindings.targets[target.id]
    const evidence = binding ? await inspectGit(binding.path).catch((error) => ({ error: error.message })) : null
    values.push({ ...target, binding: binding?.path ?? null, evidence })
  }
  return values
}

export async function prepareTargetAdd(root, path, id) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const evidence = await inspectGit(path)
  const targetId = id ?? basename(evidence.root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  if (home.spec.targets.some((target) => target.id === targetId)) throw new HairnessError('target_exists', `Target ${targetId} already exists.`)
  const plan = { action: 'add', id: targetId, kind: 'git', path: evidence.root }
  return prepareTargetPlan(root, home, lock, plan, evidence)
}

export async function prepareTargetRemove(root, id) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const target = home.spec.targets.find((item) => item.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not registered.`)
  const bindings = await targetBindings(home)
  const evidence = bindings.targets[id] ? await inspectGit(bindings.targets[id].path).catch(() => null) : null
  const plan = { action: 'remove', id, kind: target.kind, path: bindings.targets[id]?.path ?? null }
  return prepareTargetPlan(root, home, lock, plan, evidence)
}

async function prepareTargetPlan(root, home, lock, plan, evidence) {
  const checkpoint = await prepareEffect(root, {
    operation: `target.${plan.action}`,
    adapter: 'hairness/cockpit:target-lifecycle',
    inputs: plan,
    evidence: evidence ?? {},
    policy: { grantsAuthority: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  })
  const runtime = await ensureRuntime(home)
  await writeJsonAtomic(join(runtime.checkpoints, `${checkpoint.metadata.id}.target.json`), { plan, evidence })
  return { status: 'checkpoint-required', preview: { action: plan.action, id: plan.id, path: plan.path }, checkpoint }
}

export async function applyTargetPlan(root, checkpointId) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const runtime = runtimePaths(home.metadata.id)
  const stored = await readJson(join(runtime.checkpoints, `${checkpointId}.target.json`))
  const currentEvidence = stored.plan.path ? await inspectGit(stored.plan.path).catch(() => null) : null
  const current = {
    inputs: stored.plan,
    evidence: currentEvidence ?? {},
    policy: { grantsAuthority: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  }
  return applyEffect(root, checkpointId, current, async () => {
    const bindings = await targetBindings(home)
    if (stored.plan.action === 'add') {
      home.spec.targets.push({ id: stored.plan.id, kind: 'git' })
      bindings.targets[stored.plan.id] = { path: stored.plan.path, boundAt: new Date().toISOString() }
    } else {
      home.spec.targets = home.spec.targets.filter((target) => target.id !== stored.plan.id)
      delete bindings.targets[stored.plan.id]
    }
    await writeJsonAtomic(join(root, 'hairness.json'), home)
    await writeJsonAtomic(runtime.targetBindings, bindings)
    return { action: stored.plan.action, id: stored.plan.id, grantsAuthority: false }
  })
}

export async function doctorTargets(root) {
  const targets = await listTargets(root)
  const limits = []
  for (const target of targets) {
    if (!target.binding) limits.push(`target-unbound:${target.id}`)
    else if (target.evidence?.error) limits.push(`target-unavailable:${target.id}`)
  }
  return { status: limits.length ? 'partial' : 'ready', targets, limits }
}

