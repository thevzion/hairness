import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { validateDocument } from './contracts.mjs'
import { HairnessError } from './lib/errors.mjs'
import { digest, exists } from './lib/io.mjs'

export async function installedItems(root) {
  const base = join(root, 'extensions')
  if (!await exists(base)) return []
  const receipts = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Installed Extension contains symbolic link ${relative(root, path)}.`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name === 'hairness.item.json') receipts.push(await loadReceipt(root, path))
    }
  }
  await visit(base)
  const ids = receipts.map((entry) => entry.receipt.id)
  if (new Set(ids).size !== ids.length) throw new HairnessError('item_invalid', 'Installed item ids must be unique.')
  return receipts.sort((left, right) => left.receipt.id.localeCompare(right.receipt.id))
}

export async function loadReceipt(root, path) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Receipt ${path} must not be a symbolic link.`)
  const receipt = await validateDocument(JSON.parse(await readFile(path, 'utf8')), 'item')
  const itemRoot = dirname(path)
  return { root: itemRoot, path, receipt }
}

export async function findInstalled(root, selector) {
  const items = await installedItems(root)
  const matches = items.filter((entry) => entry.receipt.id === selector || entry.receipt.name === selector)
  if (!matches.length) throw new HairnessError('item_not_installed', `${selector} is not installed.`)
  if (matches.length > 1) throw new HairnessError('item_ambiguous', `${selector} matches multiple installed items; use the full id.`)
  return matches[0]
}

export async function itemStatus(entry) {
  const files = []
  for (const file of entry.receipt.files) {
    const path = join(entry.root, file.path)
    let state
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isFile()) state = 'invalid'
      else state = digest(await readFile(path)) === file.baseDigest ? 'clean' : 'customized'
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = 'missing'
    }
    files.push({ path: file.path, state, baseDigest: file.baseDigest })
  }
  const state = files.some((file) => file.state === 'invalid') ? 'invalid'
    : files.some((file) => file.state === 'missing') ? 'missing'
      : files.some((file) => file.state === 'customized') ? 'customized'
        : 'clean'
  return {
    id: entry.receipt.id,
    name: entry.receipt.name,
    version: entry.receipt.version,
    source: entry.receipt.source,
    requestedRef: entry.receipt.requestedRef,
    resolvedCommit: entry.receipt.resolvedCommit,
    mobile: entry.receipt.mobile,
    state,
    files,
  }
}
