import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { activeExtensions, inspectExtension, validateComposition } from './extensions.mjs'
import { git } from './git.mjs'
import { loadHome, loadHomeLock } from './home.mjs'
import { buildProviders } from './providers/compiler.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertInside, copyTree, exists, treeDigest, writeJsonAtomic } from './lib/io.mjs'

export async function listInstalledExtensions(root) {
  const [home, lock] = await Promise.all([loadHome(root), loadHomeLock(root)])
  return home.spec.extensions.map((id) => {
    const entry = lock.extensions.find((item) => item.id === id)
    return { id, version: entry?.version ?? null, source: entry?.source ?? null, resolvedCommit: entry?.resolvedCommit ?? null, digest: entry?.digest ?? null }
  })
}

export async function addExtension(root, source, options = {}) {
  const [home, lock] = await Promise.all([loadHome(root), loadHomeLock(root)])
  const resolved = await resolveExtensionSource(root, source, options)
  try {
    const id = resolved.manifest.metadata.id
    if (home.spec.extensions.includes(id)) throw new HairnessError('extension_active', `${id} is already active.`)
    await validateComposition([...await activeExtensions(root, home), resolved], { ...home, spec: { ...home.spec, extensions: [...home.spec.extensions, id] } })
    const candidate = await stageCopy(root, resolved.root)
    const destination = join(root, 'extensions', ...id.split('/'))
    if (await exists(destination)) throw new HairnessError('extension_present_inactive', `${id} is physically present but inactive; remove or relocate it before add.`)
    const nextHome = structuredClone(home)
    const nextLock = structuredClone(lock)
    nextHome.spec.extensions.push(id)
    nextLock.extensions.push(lockEntry(resolved))
    return applyChange(root, { home, lock, nextHome, nextLock, candidate, destination, action: 'add', id })
  } finally {
    await resolved.cleanup()
  }
}

export async function updateExtension(root, id) {
  const [home, lock] = await Promise.all([loadHome(root), loadHomeLock(root)])
  const entry = lock.extensions.find((item) => item.id === id)
  if (!entry || !home.spec.extensions.includes(id)) throw new HairnessError('extension_inactive', `${id} is not active.`)
  const installed = join(root, 'extensions', ...id.split('/'))
  const currentDigest = await treeDigest(installed)
  if (currentDigest !== entry.installedBaseDigest) {
    throw new HairnessError('extension_diverged', `${id} has local changes; merge them manually before updating.`, {
      exitCode: 5,
      details: { expected: entry.installedBaseDigest, actual: currentDigest },
    })
  }
  const resolved = await resolveExtensionSource(root, entry.source, {
    ref: entry.requestedRef,
    path: entry.path,
    sourceKind: entry.sourceKind,
  })
  try {
    if (resolved.digest === currentDigest) return { status: 'current', id, digest: currentDigest }
    const extensions = await activeExtensions(root, home)
    await validateComposition(extensions.map((extension) => extension.manifest.metadata.id === id ? resolved : extension), home)
    const candidate = await stageCopy(root, resolved.root)
    const nextLock = structuredClone(lock)
    nextLock.extensions[nextLock.extensions.findIndex((item) => item.id === id)] = lockEntry(resolved)
    return applyChange(root, { home, lock, nextHome: home, nextLock, candidate, destination: installed, action: 'update', id })
  } finally {
    await resolved.cleanup()
  }
}

export async function removeExtension(root, id) {
  const [home, lock] = await Promise.all([loadHome(root), loadHomeLock(root)])
  const extensions = await activeExtensions(root, home)
  const removed = extensions.find((extension) => extension.manifest.metadata.id === id)
  if (!removed) throw new HairnessError('extension_inactive', `${id} is not active.`)
  const requiredBy = extensions.filter((extension) => (extension.manifest.spec.requires ?? []).includes(id)).map((extension) => extension.manifest.metadata.id)
  if (requiredBy.length) throw new HairnessError('extension_required', `${id} is required by ${requiredBy.join(', ')}.`)
  const entry = lock.extensions.find((item) => item.id === id)
  if (!entry || await treeDigest(removed.root) !== entry.installedBaseDigest) {
    throw new HairnessError('extension_diverged', `${id} has local changes and will not be deleted.`, { exitCode: 5 })
  }
  const nextHome = structuredClone(home)
  const nextLock = structuredClone(lock)
  nextHome.spec.extensions = nextHome.spec.extensions.filter((entry) => entry !== id)
  delete nextHome.spec.config[id]
  nextLock.extensions = nextLock.extensions.filter((entry) => entry.id !== id)
  await validateComposition(extensions.filter((extension) => extension !== removed), nextHome)
  return applyChange(root, { home, lock, nextHome, nextLock, candidate: null, destination: removed.root, action: 'remove', id })
}

async function resolveExtensionSource(root, source, options) {
  const gitSource = options.sourceKind === 'git' || /^(?:https?|ssh|git|file):\/\//.test(source) || /^git@/.test(source)
  if (gitSource) return resolveGitSource(root, source, options)
  const base = await realpath(resolve(options.cwd ?? process.cwd(), source))
  const path = options.path && options.path !== '.' ? assertInside(base, join(base, options.path), 'extension subtree') : base
  const inspected = await inspectExtension(path)
  return {
    ...inspected,
    provenance: { sourceKind: 'path', source: base, requestedRef: null, resolvedCommit: null, path: options.path ?? null },
    cleanup: async () => {},
  }
}

async function resolveGitSource(root, source, options) {
  await mkdir(join(root, '.hairness', 'tmp'), { recursive: true })
  const temporary = await mkdtemp(join(root, '.hairness', 'tmp', 'git-extension-'))
  const repository = join(temporary, 'repository')
  try {
    await git(['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', repository])
    await git(['-C', repository, 'remote', 'add', 'origin', source])
    const requestedRef = options.ref ?? 'HEAD'
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet', '--depth=1', 'origin', requestedRef])
    const resolvedCommit = await git(['-C', repository, 'rev-parse', 'FETCH_HEAD'])
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', resolvedCommit])
    const path = options.path && options.path !== '.' ? assertInside(repository, join(repository, options.path), 'extension subtree') : repository
    const inspected = await inspectExtension(path)
    return {
      ...inspected,
      provenance: { sourceKind: 'git', source, requestedRef, resolvedCommit, path: options.path ?? null },
      cleanup: async () => rm(temporary, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

async function stageCopy(root, source) {
  const destination = join(root, '.hairness', 'tmp', `extension-${randomUUID()}`)
  await mkdir(join(destination, '..'), { recursive: true })
  await copyTree(source, destination)
  return destination
}

async function applyChange(root, change) {
  const backup = join(root, '.hairness', 'tmp', `backup-${randomUUID()}`)
  let oldMoved = false
  let candidateMoved = false
  try {
    if (['update', 'remove'].includes(change.action)) {
      await rename(change.destination, backup)
      oldMoved = true
    }
    if (['add', 'update'].includes(change.action)) {
      await mkdir(join(change.destination, '..'), { recursive: true })
      await rename(change.candidate, change.destination)
      candidateMoved = true
    }
    await writeJsonAtomic(join(root, 'hairness.json'), change.nextHome)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), change.nextLock)
    await buildProviders(root)
    if (oldMoved) await rm(backup, { recursive: true, force: true })
    return { status: change.action === 'remove' ? 'removed' : 'active', action: change.action, id: change.id }
  } catch (error) {
    await writeJsonAtomic(join(root, 'hairness.json'), change.home)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), change.lock)
    if (candidateMoved) await rm(change.destination, { recursive: true, force: true })
    if (oldMoved && await exists(backup)) await rename(backup, change.destination)
    await buildProviders(root).catch(() => {})
    throw error
  } finally {
    if (change.candidate && await exists(change.candidate)) await rm(change.candidate, { recursive: true, force: true })
  }
}

function lockEntry(extension) {
  return {
    id: extension.manifest.metadata.id,
    version: extension.manifest.metadata.version,
    source: extension.provenance.source,
    sourceKind: extension.provenance.sourceKind,
    requestedRef: extension.provenance.requestedRef,
    resolvedCommit: extension.provenance.resolvedCommit,
    path: extension.provenance.path,
    digest: extension.digest,
    installedBaseDigest: extension.digest,
  }
}
