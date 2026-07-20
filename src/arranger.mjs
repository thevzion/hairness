import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { API } from './contracts.mjs'
import { loadHome } from './home.mjs'
import { findInstalled, installedItems, itemStatus } from './items.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertInside, digest, exists } from './lib/io.mjs'
import { resolveItem } from './registry.mjs'

export async function addItems(root, addresses, options = {}) {
  const home = await loadHome(root)
  const resolved = await resolveTree(root, addresses, home)
  const current = await installedItems(root)
  const currentIds = new Set(current.map((entry) => entry.receipt.id))
  const writes = []
  for (const item of resolved) {
    if (currentIds.has(item.id) && !options.overwrite) throw new HairnessError('item_exists', `${item.id} is already installed.`)
    const itemRoot = join(root, 'extensions', item.id)
    for (const file of item.files) {
      const path = assertInside(itemRoot, join(itemRoot, file.path), 'item destination')
      if (await exists(path) && !options.overwrite) throw new HairnessError('file_collision', `${relative(root, path)} already exists.`)
      writes.push({ path, content: file.content })
    }
    writes.push({ path: join(itemRoot, 'hairness.item.json'), content: Buffer.from(`${JSON.stringify(receiptFor(item, resolved), null, 2)}\n`) })
  }
  const preview = previewPlan(root, writes, [])
  if (options.dryRun) return { status: 'planned', items: resolved.map((entry) => entry.id), ...preview }
  await applyTransaction(root, writes, [])
  return { status: 'added', items: resolved.map((entry) => entry.id), ...preview }
}

export async function statusItems(root, selector) {
  const entries = selector ? [await findInstalled(root, selector)] : await installedItems(root)
  return Promise.all(entries.map(itemStatus))
}

export async function diffItem(root, selector, options = {}) {
  const installed = await findInstalled(root, selector)
  const local = await itemStatus(installed)
  const upstream = await resolveItem(root, options.to ?? installed.receipt.source)
  const base = new Map(installed.receipt.files.map((file) => [file.path, file]))
  const next = new Map(upstream.files.map((file) => [file.path, file]))
  const paths = [...new Set([...base.keys(), ...next.keys()])].sort()
  return {
    id: installed.receipt.id,
    from: { version: installed.receipt.version, commit: installed.receipt.resolvedCommit },
    to: { version: upstream.item.version, commit: upstream.resolvedCommit },
    local: local.state,
    files: paths.map((path) => {
      const before = base.get(path)
      const after = next.get(path)
      return {
        path,
        change: !before ? 'added' : !after ? 'removed' : before.baseDigest === digest(after.content) ? 'unchanged' : 'changed',
        local: local.files.find((file) => file.path === path)?.state ?? 'absent',
      }
    }),
  }
}

export async function syncItems(root, selector, options = {}) {
  const selected = options.all ? await installedItems(root) : [await findInstalled(root, selector)]
  const results = []
  for (const installed of selected) results.push(await syncOne(root, installed, options))
  return results
}

export async function removeItem(root, selector, options = {}) {
  const selected = await findInstalled(root, selector)
  const current = await itemStatus(selected)
  const blocked = current.files.filter((file) => file.state !== 'clean')
  if (blocked.length && !options.overwrite) throw new HairnessError('item_customized', `${selected.receipt.id} has customized, missing or invalid files.`, { details: { files: blocked } })
  const all = await installedItems(root)
  const dependents = all.filter((entry) => entry.receipt.id !== selected.receipt.id && (entry.receipt.dependencies ?? []).includes(selected.receipt.id))
  if (dependents.length) throw new HairnessError('item_required', `${selected.receipt.id} is required by ${dependents.map((entry) => entry.receipt.id).join(', ')}.`)
  const deletes = selected.receipt.files.map((file) => join(selected.root, file.path))
  deletes.push(selected.path)
  await applyTransaction(root, [], deletes)
  await removeEmptyParents(selected.root, join(root, 'extensions'))
  return { status: 'removed', id: selected.receipt.id, files: selected.receipt.files.map((file) => file.path) }
}

async function syncOne(root, installed, options) {
  const status = await itemStatus(installed)
  const blocked = status.files.filter((file) => file.state !== 'clean')
  const upstream = await resolveItem(root, options.to ?? installed.receipt.source)
  if (blocked.length && !options.overwrite) {
    const result = await diffItem(root, installed.receipt.id, { to: options.to })
    if (options.check) return { status: 'blocked', reason: 'customized', ...result }
    throw new HairnessError('sync_customized', `${installed.receipt.id} has local changes; inspect hairness diff or pass --overwrite.`, { details: result })
  }
  const home = await loadHome(root)
  const dependencies = await resolveTree(root, upstream.item.registryDependencies ?? [], home)
  const existing = await installedItems(root)
  const existingIds = new Set(existing.map((entry) => entry.receipt.id))
  const newDependencies = dependencies.filter((entry) => !existingIds.has(entry.id))
  const writes = []
  const deletes = []
  const itemRoot = installed.root
  for (const file of upstream.files) writes.push({ path: join(itemRoot, file.path), content: file.content })
  const nextPaths = new Set(upstream.files.map((file) => file.path))
  for (const file of installed.receipt.files) if (!nextPaths.has(file.path)) deletes.push(join(itemRoot, file.path))
  writes.push({ path: installed.path, content: Buffer.from(`${JSON.stringify(receiptFor({ ...upstream, id: installed.receipt.id }, dependencies), null, 2)}\n`) })
  for (const dependency of newDependencies) {
    const dependencyRoot = join(root, 'extensions', dependency.id)
    for (const file of dependency.files) {
      const path = join(dependencyRoot, file.path)
      if (await exists(path)) throw new HairnessError('file_collision', `${relative(root, path)} already exists.`)
      writes.push({ path, content: file.content })
    }
    const receiptPath = join(dependencyRoot, 'hairness.item.json')
    if (await exists(receiptPath)) throw new HairnessError('file_collision', `${relative(root, receiptPath)} already exists.`)
    writes.push({ path: receiptPath, content: Buffer.from(`${JSON.stringify(receiptFor(dependency, dependencies), null, 2)}\n`) })
  }
  let changed = deletes.length > 0
  for (const entry of writes) if (!await existsWithDigest(entry.path, digest(entry.content))) changed = true
  if (options.check) return { status: blocked.length ? 'blocked' : changed ? 'available' : 'current', id: installed.receipt.id, version: upstream.item.version, commit: upstream.resolvedCommit }
  await applyTransaction(root, writes, deletes)
  return { status: 'synced', id: installed.receipt.id, version: upstream.item.version, commit: upstream.resolvedCommit, dependencies: newDependencies.map((entry) => entry.id) }
}

async function resolveTree(root, addresses, home) {
  const ordered = []
  const resolvedByAddress = new Map()
  const visiting = []
  async function visit(address) {
    if (resolvedByAddress.has(address)) return resolvedByAddress.get(address)
    const cycleAt = visiting.indexOf(address)
    if (cycleAt >= 0) throw new HairnessError('dependency_cycle', `Registry dependency cycle: ${[...visiting.slice(cycleAt), address].join(' -> ')}.`)
    visiting.push(address)
    const item = await resolveItem(root, address, { home })
    for (const dependency of item.item.registryDependencies ?? []) await visit(dependency)
    visiting.pop()
    resolvedByAddress.set(address, item)
    if (!ordered.some((entry) => entry.id === item.id)) ordered.push(item)
    else if (ordered.find((entry) => entry.id === item.id).source !== item.source) throw new HairnessError('dependency_collision', `Multiple sources resolve to ${item.id}.`)
    return item
  }
  for (const address of addresses) await visit(address)
  return ordered
}

function receiptFor(item, resolved) {
  const dependencyIds = (item.item.registryDependencies ?? []).map((address) => resolved.find((entry) => entry.source === address)?.id).filter(Boolean)
  return {
    $schema: API.item,
    id: item.id,
    name: item.item.name,
    version: item.item.version,
    type: item.item.type,
    title: item.item.title,
    description: item.item.description,
    source: item.source,
    requestedRef: item.requestedRef,
    resolvedCommit: item.resolvedCommit,
    mobile: item.mobile,
    registryDependencies: item.item.registryDependencies ?? [],
    ...(dependencyIds.length ? { dependencies: dependencyIds } : {}),
    ...(item.item.adapter ? { adapter: { id: item.item.adapter.id ?? item.id, entry: item.item.adapter.entry, outputs: item.item.adapter.outputs } } : {}),
    files: item.files.map((file) => ({
      path: file.path,
      type: file.type,
      ...(file.id ? { id: file.id } : {}),
      ...(file.description ? { description: file.description } : {}),
      baseDigest: digest(file.content),
    })),
  }
}

async function applyTransaction(root, writes, deletes) {
  const transaction = await mkdtemp(join(root, '.hairness-transaction-'))
  const staged = join(transaction, 'staged')
  const backup = join(transaction, 'backup')
  const touched = [...new Set([...writes.map((entry) => entry.path), ...deletes])]
  try {
    for (const entry of writes) {
      const relativePath = relative(root, assertInside(root, entry.path, 'transaction path'))
      const path = join(staged, relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeJsonOrBytes(path, entry.content)
    }
    for (const path of touched) await assertNoSymlink(root, path)
    const backedUp = []
    try {
      for (const path of touched) {
        if (!await exists(path)) continue
        const relativePath = relative(root, path)
        const destination = join(backup, relativePath)
        await mkdir(dirname(destination), { recursive: true })
        await rename(path, destination)
        backedUp.push({ path, destination })
      }
      for (const entry of writes) {
        const relativePath = relative(root, entry.path)
        await mkdir(dirname(entry.path), { recursive: true })
        await rename(join(staged, relativePath), entry.path)
      }
    } catch (error) {
      for (const entry of writes.reverse()) if (await exists(entry.path)) await rm(entry.path, { recursive: true, force: true })
      for (const entry of backedUp.reverse()) {
        await mkdir(dirname(entry.path), { recursive: true })
        await rename(entry.destination, entry.path)
      }
      throw error
    }
  } finally {
    await rm(transaction, { recursive: true, force: true })
  }
}

async function writeJsonOrBytes(path, content) {
  await writeFile(path, content, { mode: 0o644 })
}

async function assertNoSymlink(root, path) {
  let current = resolve(path)
  while (current !== resolve(root)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new HairnessError('symlink_forbidden', `${relative(root, current)} is a symbolic link.`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    current = dirname(current)
  }
}

async function removeEmptyParents(path, stop) {
  let current = path
  while (current !== stop) {
    try { await rm(current, { recursive: false }) } catch { break }
    current = dirname(current)
  }
}

function previewPlan(root, writes, deletes) {
  return { writes: writes.map((entry) => relative(root, entry.path)).sort(), deletes: deletes.map((entry) => relative(root, entry)).sort() }
}

async function existsWithDigest(path, expected) {
  try { return digest(await readFile(path)) === expected } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
