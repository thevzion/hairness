import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDocument } from './contracts.mjs'
import { git } from './git.mjs'
import { loadHome } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertId, resolvePackageFile } from './lib/io.mjs'

const builtinRegistry = fileURLToPath(new URL('../registry/registry.json', import.meta.url))
const MAX_FILE_BYTES = 5 * 1024 * 1024
const githubAddress = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/([a-z0-9][a-z0-9._-]*)(?:#([^#]+))?$/

export async function resolveItem(root, address, options = {}) {
  const home = options.home ?? await loadHome(root)
  const source = String(address)
  const namespace = source.match(/^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/)
  if (namespace) {
    const [, scope, name] = namespace
    if (scope === 'hairness') return loadDocumentSource(builtinRegistry, { source, id: `hairness/${name}`, itemName: name, mobile: false })
    const configured = home.registries[`@${scope}`]
    if (!configured) throw new HairnessError('registry_missing', `Registry @${scope} is not configured.`)
    const descriptor = typeof configured === 'string' ? { url: configured, headers: {} } : configured
    const location = descriptor.url.replaceAll('{name}', name)
    const headers = expandHeaders(descriptor.headers ?? {})
    const result = await loadDocumentSource(location, { root, source, id: `${scope}/${name}`, itemName: name, headers, mobile: true })
    return result
  }
  const github = source.match(githubAddress)
  if (github) return loadGithubSource(source, github)
  if (/^https:\/\//.test(source)) return loadDocumentSource(source, { root, source, headers: {}, mobile: true })
  if (/^http:\/\//.test(source)) throw new HairnessError('source_insecure', 'Registry URLs must use HTTPS.')
  if (source.startsWith('.') || source.startsWith('/')) return loadDocumentSource(source, { root, source, mobile: true })
  throw new HairnessError('source_invalid', `Unsupported item address ${source}.`)
}

export async function loadRegistry(root, address) {
  const source = String(address)
  if (/^https:\/\//.test(source)) return validateRegistry((await loadRemoteDocument(assertSafeUrl(source), {})).document)
  if (/^http:\/\//.test(source)) throw new HairnessError('source_insecure', 'Registry URLs must use HTTPS.')
  const path = resolve(root, source)
  return validateRegistry(JSON.parse(await readFile(path, 'utf8')))
}

export async function validateRegistry(document) {
  await validateDocument(document, 'registry')
  if (document.items.length > 256) throw new HairnessError('registry_invalid', 'A registry may contain at most 256 items.')
  const names = new Set()
  for (const item of document.items) {
    if (names.has(item.name)) throw new HairnessError('registry_invalid', `Duplicate registry item ${item.name}.`)
    names.add(item.name)
    validateSourceItem(item)
  }
  return document
}

export async function listRegistry(root, address) {
  const registry = await loadRegistry(root, address)
  return registry.items.map(({ name, version, type, title, description }) => ({ registry: registry.name, name, version, type, title, description }))
}

export async function searchRegistry(root, address, query = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  return (await listRegistry(root, address)).filter((item) => words.every((word) => JSON.stringify(item).toLowerCase().includes(word)))
}

export async function viewItems(root, addresses) {
  return Promise.all(addresses.map(async (address) => {
    const resolved = await resolveItem(root, address)
    return {
      id: resolved.id,
      name: resolved.item.name,
      version: resolved.item.version,
      type: resolved.item.type,
      title: resolved.item.title,
      description: resolved.item.description,
      source: resolved.source,
      requestedRef: resolved.requestedRef,
      resolvedCommit: resolved.resolvedCommit,
      mobile: resolved.mobile,
      registryDependencies: resolved.item.registryDependencies ?? [],
      files: resolved.files.map(({ content, ...file }) => ({ ...file, bytes: content.length })),
    }
  }))
}

async function loadGithubSource(source, match) {
  const [, owner, repository, itemName, requestedRef] = match
  const stage = await mkdtemp(join(tmpdir(), 'hairness-registry-'))
  try {
    await git(['init', '--quiet'], { cwd: stage })
    await git(['remote', 'add', 'origin', `https://github.com/${owner}/${repository}.git`], { cwd: stage })
    await git(['fetch', '--quiet', '--depth=1', 'origin', requestedRef ?? 'HEAD'], { cwd: stage })
    await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: stage })
    const resolvedCommit = await git(['rev-parse', 'HEAD'], { cwd: stage })
    const tag = requestedRef ? await git(['ls-remote', '--tags', 'origin', `refs/tags/${requestedRef}`], { cwd: stage }).then((output) => Boolean(output), () => false) : false
    const pinned = Boolean(requestedRef && (/^[a-f0-9]{40}$/i.test(requestedRef) || tag))
    return await loadDocumentSource(join(stage, 'registry.json'), {
      source,
      id: null,
      itemName,
      requestedRef: requestedRef ?? null,
      resolvedCommit,
      mobile: !pinned,
    })
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function loadDocumentSource(location, context) {
  let document
  let base
  if (/^https:\/\//.test(location)) {
    const remote = await loadRemoteDocument(assertSafeUrl(location), context.headers ?? {})
    document = remote.document
    base = remote.url
  } else {
    const candidate = resolve(context.root ?? process.cwd(), location)
    const stat = await lstat(candidate)
    if (stat.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Registry source ${location} must not be a symbolic link.`)
    const path = await realpath(candidate)
    document = JSON.parse(await readFile(path, 'utf8'))
    base = path
  }
  const registry = document.items ? await validateRegistry(document) : await validateRegistry({
    $schema: 'https://hairness.dev/schema/registry.json',
    name: document.registry ?? 'direct',
    items: [Object.fromEntries(Object.entries(document).filter(([key]) => !['$schema', 'registry'].includes(key)))],
  })
  const item = selectItem(registry, context.itemName)
  const files = []
  for (const file of item.files) {
    const target = normalizeTarget(item.name, file)
    let content
    if (file.content !== undefined) content = Buffer.from(file.content)
    else if (/^https:\/\//.test(base)) content = await fetchBytes(new URL(file.path, base).href, context.headers ?? {})
    else content = await readLocalFile(dirname(base), file.path)
    if (content.length > MAX_FILE_BYTES) throw new HairnessError('source_too_large', `${file.path} exceeds 5 MiB.`)
    files.push({ path: target, sourcePath: file.path, type: file.type, ...(file.id ? { id: file.id } : {}), ...(file.description ? { description: file.description } : {}), content })
  }
  const id = context.id ?? `${registry.name}/${item.name}`
  assertId(id, 'item id')
  return {
    id,
    item,
    files,
    source: context.source,
    requestedRef: context.requestedRef ?? null,
    resolvedCommit: context.resolvedCommit ?? null,
    mobile: Boolean(context.mobile),
  }
}

async function loadRemoteDocument(url, headers) {
  const response = await fetch(url, { headers, redirect: 'follow' })
  if (response.url && !response.url.startsWith('https://')) throw new HairnessError('source_insecure', 'Registry redirects must remain on HTTPS.')
  if (!response.ok) throw new HairnessError('registry_fetch_failed', `Registry request failed with HTTP ${response.status}.`, { exitCode: 4 })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_FILE_BYTES) throw new HairnessError('source_too_large', 'Registry document exceeds 5 MiB.')
  try {
    return { document: JSON.parse(bytes.toString('utf8')), url: response.url }
  } catch (error) {
    throw new HairnessError('invalid_json', 'Registry returned invalid JSON.', { cause: error })
  }
}

async function fetchBytes(url, headers) {
  const response = await fetch(assertSafeUrl(url), { headers, redirect: 'follow' })
  if (response.url && !response.url.startsWith('https://')) throw new HairnessError('source_insecure', 'Registry redirects must remain on HTTPS.')
  if (!response.ok) throw new HairnessError('registry_fetch_failed', `Registry file request failed with HTTP ${response.status}.`, { exitCode: 4 })
  return Buffer.from(await response.arrayBuffer())
}

async function readLocalFile(root, path) {
  const resolved = await resolvePackageFile(root, path, 'registry file')
  return readFile(resolved)
}

function selectItem(registry, name) {
  if (name) {
    const item = registry.items.find((entry) => entry.name === name)
    if (!item) throw new HairnessError('item_missing', `Registry ${registry.name} does not contain ${name}.`)
    return item
  }
  if (registry.items.length !== 1) throw new HairnessError('item_ambiguous', 'The source contains multiple items; use an address that selects one.')
  return registry.items[0]
}

function normalizeTarget(itemName, file) {
  const prefix = `${itemName}/`
  const value = file.target ?? (file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path)
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) throw new HairnessError('path_escape', `Invalid item target ${value}.`)
  if (value === 'hairness.item.json') throw new HairnessError('registry_invalid', 'hairness.item.json is reserved for the provenance receipt.')
  return value.replaceAll('\\', '/')
}

function validateSourceItem(item) {
  if (item.files.length > 1024) throw new HairnessError('registry_invalid', `Item ${item.name} declares more than 1024 files.`)
  const targets = new Set()
  for (const file of item.files) {
    if (file.path.includes('\\')) throw new HairnessError('path_escape', `Invalid registry source path ${file.path}.`)
    const target = normalizeTarget(item.name, file)
    if (targets.has(target)) throw new HairnessError('registry_invalid', `Item ${item.name} writes ${target} more than once.`)
    targets.add(target)
    if (file.type === 'hairness:skill' && (!file.id || !file.description)) {
      throw new HairnessError('registry_invalid', `Skill ${file.path} requires id and description.`)
    }
  }
  if (item.adapter && !item.files.some((file) => normalizeTarget(item.name, file) === item.adapter.entry && file.type === 'hairness:adapter')) {
    throw new HairnessError('registry_invalid', `Adapter entry ${item.adapter.entry} must be declared as hairness:adapter.`)
  }
}

function assertSafeUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search) {
    throw new HairnessError('source_insecure', 'Registry URLs must use HTTPS without credentials or query secrets; configure authentication headers in hairness.json.')
  }
  return url.href
}

function expandHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value).replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, key) => {
    if (process.env[key] === undefined) throw new HairnessError('registry_secret_missing', `Registry environment variable ${key} is not set.`)
    return process.env[key]
  })]))
}
