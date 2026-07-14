import { basename, join, resolve } from 'node:path'
import { lstat, mkdir, readdir, readlink, realpath, symlink, unlink } from 'node:fs/promises'
import { loadHome, loadHomeLock } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { applyEffect, prepareEffect } from '../operations/index.mjs'
import { ensureRuntime, runtimePaths } from '../runtime/index.mjs'
import { git, inspectGit } from '../runtime/git.mjs'

const pruned = new Set(['node_modules', 'vendor', '.cache', '.pnpm-store', '.yarn', 'dist', 'build', '.next', 'coverage', 'target'])

export function targetLinksRoot(root) {
  return join(root, 'targets')
}

export async function targetBinding(root, id) {
  const path = join(targetLinksRoot(root), id)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!info.isSymbolicLink()) throw new HairnessError('target_binding_invalid', `Target binding ${id} is not a symbolic link.`)
  return { id, link: path, path: await realpath(path), raw: await readlink(path) }
}

export async function bindTargetLink(root, id, path) {
  const links = targetLinksRoot(root)
  const link = join(links, id)
  if (await exists(link)) throw new HairnessError('target_already_bound', `Target ${id} is already bound.`)
  await mkdir(links, { recursive: true })
  await symlink((await inspectGit(path)).root, link, 'dir')
  return targetBinding(root, id)
}

export async function listTargets(root) {
  const home = await loadHome(root)
  const values = []
  for (const target of home.spec.targets) {
    const binding = await targetBinding(root, target.id).catch((error) => ({ error: error.message }))
    const evidence = binding?.path ? await inspectRepository(binding.path).catch((error) => ({ error: error.message })) : null
    values.push({ ...target, binding: binding?.path ?? null, evidence, bindingError: binding?.error ?? null })
  }
  return values
}

export async function discoverTargets(root, scanRoot) {
  const home = await loadHome(root)
  const base = resolve(scanRoot)
  const candidates = []
  const limits = []
  const expected = new Map(home.spec.targets.map((target) => [target.id, new Set(target.remotes.map(normalizeRemote))]))

  async function visit(directory, workspaceRoot = false) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(error.code)) {
        limits.push(`scan-unreadable:${directory}`)
        return
      }
      throw error
    }
    if (entries.some((entry) => entry.name === '.git')) {
      const repository = await inspectRepository(directory).catch((error) => ({ error: error.message, root: directory, remotes: [] }))
      const normalized = new Set((repository.remotes ?? []).map((remote) => remote.normalized))
      const matches = [...expected].filter(([, remotes]) => [...remotes].some((remote) => normalized.has(remote))).map(([id]) => id)
      candidates.push({ ...repository, matches })
      if (!workspaceRoot) return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || pruned.has(entry.name)) continue
      await visit(join(directory, entry.name))
    }
  }

  await visit(base, true)
  candidates.sort((left, right) => left.root.localeCompare(right.root))
  return { root: base, targets: home.spec.targets, candidates, limits }
}

export async function prepareTargetAdd(root, path, id) {
  const home = await loadHome(root)
  const evidence = await inspectRepository(path)
  const targetId = id ?? basename(evidence.root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  if (home.spec.targets.some((target) => target.id === targetId)) throw new HairnessError('target_exists', `Target ${targetId} already exists.`)
  const target = { id: targetId, kind: 'git', summary: basename(evidence.root), requirement: 'recommended', remotes: evidence.remotes.map((item) => item.url) }
  return prepareTargetPlan(root, { action: 'add', target, path: evidence.root }, evidence)
}

export async function prepareTargetBind(root, id, path) {
  const home = await loadHome(root)
  const target = home.spec.targets.find((item) => item.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not declared.`)
  if (await targetBinding(root, id)) throw new HairnessError('target_already_bound', `Target ${id} is already bound.`)
  const evidence = await inspectRepository(path)
  assertRemoteMatch(target, evidence)
  return prepareTargetPlan(root, { action: 'bind', target, path: evidence.root }, evidence)
}

export async function prepareTargetUnbind(root, id) {
  const home = await loadHome(root)
  const target = home.spec.targets.find((item) => item.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not declared.`)
  const binding = await targetBinding(root, id)
  if (!binding) throw new HairnessError('target_unbound', `Target ${id} is not bound.`)
  const evidence = await inspectRepository(binding.path)
  await assertBindingReleasable(home, target, evidence)
  return prepareTargetPlan(root, { action: 'unbind', target, path: binding.path }, evidence)
}

export async function prepareTargetRemove(root, id) {
  const home = await loadHome(root)
  const target = home.spec.targets.find((item) => item.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not registered.`)
  const binding = await targetBinding(root, id)
  const evidence = binding ? await inspectRepository(binding.path).catch(() => null) : null
  if (binding && evidence) await assertBindingReleasable(home, target, evidence)
  return prepareTargetPlan(root, { action: 'remove', target, path: binding?.path ?? null }, evidence)
}

async function prepareTargetPlan(root, plan, evidence) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const checkpoint = await prepareEffect(root, {
    operation: `target.${plan.action}`,
    adapter: 'hairness/core:target-lifecycle',
    inputs: plan,
    evidence: evidence ?? {},
    policy: { grantsAuthority: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  })
  const runtime = await ensureRuntime(home)
  await writeJsonAtomic(join(runtime.checkpoints, `${checkpoint.metadata.id}.target.json`), { plan, evidence })
  return { status: 'checkpoint-required', preview: { action: plan.action, id: plan.target.id, path: plan.path }, checkpoint }
}

export async function applyTargetPlan(root, checkpointId) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const stored = await readJson(join(runtimePaths(home.metadata.id).checkpoints, `${checkpointId}.target.json`))
  const currentEvidence = stored.plan.path ? await inspectRepository(stored.plan.path).catch(() => null) : null
  const current = {
    inputs: stored.plan,
    evidence: currentEvidence ?? {},
    policy: { grantsAuthority: false },
    target: { id: home.metadata.id, homeDigest: digest(home), lockDigest: digest(lock) },
  }
  return applyEffect(root, checkpointId, current, async () => {
    const link = join(targetLinksRoot(root), stored.plan.target.id)
    if (stored.plan.action === 'add') {
      home.spec.targets.push(stored.plan.target)
      await bindTargetLink(root, stored.plan.target.id, stored.plan.path)
    } else if (stored.plan.action === 'bind') {
      await bindTargetLink(root, stored.plan.target.id, stored.plan.path)
    } else if (stored.plan.action === 'unbind') {
      await unlink(link)
    } else {
      if (await exists(link)) await unlink(link)
      home.spec.targets = home.spec.targets.filter((target) => target.id !== stored.plan.target.id)
    }
    await writeJsonAtomic(join(root, 'hairness.json'), home)
    return { action: stored.plan.action, id: stored.plan.target.id, grantsAuthority: false }
  })
}

export async function doctorTargets(root) {
  const targets = await listTargets(root)
  const limits = []
  for (const target of targets) {
    if (!target.binding && target.requirement === 'required') limits.push(`target-required-unbound:${target.id}`)
    else if (!target.binding) limits.push(`target-recommended-unbound:${target.id}`)
    else if (target.bindingError || target.evidence?.error) limits.push(`target-unavailable:${target.id}`)
    else {
      try { assertRemoteMatch(target, target.evidence) } catch { limits.push(`target-remote-mismatch:${target.id}`) }
    }
  }
  return { status: limits.some((limit) => !limit.startsWith('target-recommended')) ? 'partial' : 'ready', targets, limits }
}

export async function inspectRepository(path) {
  const evidence = await inspectGit(path)
  const output = await git(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: evidence.root }).catch(() => '')
  const remotes = output.split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf(' ')
    const name = line.slice(0, separator).replace(/^remote\./, '').replace(/\.url$/, '')
    const url = line.slice(separator + 1).trim()
    return { name, url, normalized: normalizeRemote(url) }
  })
  return { ...evidence, remotes }
}

export function normalizeRemote(value) {
  let source = String(value).trim()
  const scp = source.match(/^(?:[^@]+@)?([^:/]+):(.+)$/)
  if (scp && !source.includes('://')) source = `ssh://${scp[1]}/${scp[2]}`
  try {
    const url = new URL(source)
    return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase()}`
  } catch {
    return source.replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase()
  }
}

function assertRemoteMatch(target, evidence) {
  if (!target.remotes.length) return
  const expected = new Set(target.remotes.map(normalizeRemote))
  if (!evidence.remotes.some((remote) => expected.has(remote.normalized))) throw new HairnessError('target_remote_mismatch', `Repository ${evidence.root} does not match the declared remotes for ${target.id}.`)
}

async function assertBindingReleasable(home, target, evidence) {
  if (!evidence.clean) throw new HairnessError('target_binding_dirty', `Target ${target.id} has uncommitted changes; preserve them before removing its binding.`)
  const locks = runtimePaths(home.metadata.id).locks
  const prefix = `checkout-${slug(target.id)}-`
  const occupied = (await readdir(locks).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))).some((name) => name.startsWith(prefix) && name.endsWith('.json'))
  if (occupied) throw new HairnessError('target_binding_occupied', `Target ${target.id} is used by an active delivery checkout.`)
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}
