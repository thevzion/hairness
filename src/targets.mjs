import { lstat, mkdir, readdir, readlink, realpath, symlink, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadHome } from './home.mjs'
import { inspectRepository, normalizeRepository } from './git.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertId, exists, writeJsonAtomic } from './lib/io.mjs'

export async function targetBinding(root, id) {
  const link = join(root, 'targets', id)
  let info
  try {
    info = await lstat(link)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!info.isSymbolicLink()) throw new HairnessError('target_binding_invalid', `${link} is not a symbolic link.`)
  try {
    return { link, raw: await readlink(link), path: await realpath(link) }
  } catch (error) {
    if (error.code === 'ENOENT') return { link, raw: await readlink(link), path: null, broken: true }
    throw error
  }
}

export async function listTargets(root) {
  const home = await loadHome(root)
  return Promise.all(home.spec.targets.map(async (target) => {
    const binding = await targetBinding(root, target.id)
    const evidence = binding?.path ? await inspectRepository(binding.path).catch((error) => ({ error: error.message })) : null
    const matches = evidence?.remotes?.some((remote) => remote.repository === normalizeRepository(target.repository)) ?? false
    return { ...target, binding: binding?.path ?? null, broken: binding?.broken ?? false, matches, evidence }
  }))
}

export async function addTarget(root, repository, options = {}) {
  const home = await loadHome(root)
  let path = null
  let normalized = normalizeRepository(repository)
  if (await exists(repository)) {
    const evidence = await inspectRepository(repository)
    if (!evidence.remotes.length) throw new HairnessError('target_remote_missing', 'A Target must have at least one Git remote.')
    path = evidence.root
    normalized = evidence.remotes[0].repository
  }
  const id = assertId(options.id ?? slug(path ? basename(path) : normalized.split('/').at(-1)), 'Target id')
  if (home.spec.targets.some((target) => target.id === id)) throw new HairnessError('target_exists', `Target ${id} already exists.`)
  home.spec.targets.push({ id, repository: normalized, ...(options.summary ? { summary: options.summary } : {}) })
  await writeJsonAtomic(join(root, 'hairness.json'), home)
  if (path) await bindTarget(root, id, path)
  return (await listTargets(root)).find((target) => target.id === id)
}

export async function bindTarget(root, id, repositoryPath) {
  const home = await loadHome(root)
  const target = home.spec.targets.find((entry) => entry.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not declared.`)
  const evidence = await inspectRepository(repositoryPath)
  if (!evidence.remotes.some((remote) => remote.repository === normalizeRepository(target.repository))) {
    throw new HairnessError('target_remote_mismatch', `${evidence.root} does not match ${target.repository}.`)
  }
  const link = join(root, 'targets', id)
  const previous = await targetBinding(root, id)
  if (previous?.path === evidence.root) return { id, path: evidence.root, repository: target.repository }
  if (previous) await unlink(link)
  await mkdir(join(root, 'targets'), { recursive: true })
  await symlink(evidence.root, link, 'dir')
  return { id, path: await realpath(link), repository: target.repository }
}

export async function unbindTarget(root, id) {
  const binding = await targetBinding(root, id)
  if (!binding) return { id, status: 'unbound' }
  await unlink(binding.link)
  return { id, status: 'unbound' }
}

export async function removeTarget(root, id) {
  const home = await loadHome(root)
  if (!home.spec.targets.some((target) => target.id === id)) throw new HairnessError('target_missing', `Target ${id} is not declared.`)
  await unbindTarget(root, id)
  home.spec.targets = home.spec.targets.filter((target) => target.id !== id)
  await writeJsonAtomic(join(root, 'hairness.json'), home)
  return { id, status: 'removed' }
}

export async function doctorTargets(root) {
  const targets = await listTargets(root)
  const limits = targets.flatMap((target) => target.broken
    ? [`target-broken:${target.id}`]
    : !target.binding
      ? [`target-unbound:${target.id}`]
      : !target.matches
        ? [`target-remote-mismatch:${target.id}`]
        : [])
  return { status: limits.length ? 'partial' : 'ready', targets, limits }
}

export async function discoverTargets(directory, options = {}) {
  const root = await realpath(directory)
  const ignored = new Set(options.ignored ?? ['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', 'tmp'])
  const repositories = []
  const limits = []

  async function visit(path) {
    let entries
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch (error) {
      limits.push({ path, code: error.code ?? 'read_failed', message: error.message })
      return
    }
    const gitEntry = entries.find((entry) => entry.name === '.git')
    if (gitEntry) {
      try {
        repositories.push(await inspectRepository(path))
      } catch (error) {
        limits.push({ path, code: error.code ?? 'git_failed', message: error.message })
      }
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignored.has(entry.name)) continue
      await visit(join(path, entry.name))
    }
  }

  await visit(root)
  return { root, repositories, limits }
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}
