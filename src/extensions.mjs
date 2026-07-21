import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDocument } from './contracts.mjs'
import { git } from './git.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertInside, digest, exists, resolvePackageFile } from './lib/io.mjs'

const builtinRoot = fileURLToPath(new URL('../extensions', import.meta.url))
const MAX_FILE_BYTES = 5 * 1024 * 1024
const githubAddress = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/(.+?)(?:#([^#]+))?$/

export async function resolveExtension(root, address) {
  const source = String(address)
  const official = source.match(/^@hairness\/([a-z0-9][a-z0-9._-]*)$/)
  if (official) return loadManifest(join(builtinRoot, official[1], 'hairness.json'), { root, source, mobile: false })
  if (source.startsWith('@')) throw new HairnessError('source_invalid', `Unsupported Extension namespace ${source}; use a GitHub, HTTPS or local manifest address.`)
  if (/^https:\/\//.test(source)) return loadManifest(assertSafeUrl(source), { root, source, mobile: true })
  if (/^http:\/\//.test(source)) throw new HairnessError('source_insecure', 'Extension URLs must use HTTPS.')
  if (source.startsWith('.') || source.startsWith('/')) return loadManifest(source, { root, source, mobile: true })
  const github = source.match(githubAddress)
  if (github) return loadGithub(source, github)
  throw new HairnessError('source_invalid', `Unsupported Extension address ${source}.`)
}

export async function addExtensions(root, addresses, options = {}) {
  const resolved = await Promise.all(addresses.map((address) => resolveExtension(root, address)))
  const ids = resolved.map((entry) => entry.manifest.name)
  if (new Set(ids).size !== ids.length) throw new HairnessError('extension_collision', 'Each Extension may be selected only once per add transaction.')
  const installed = (await installedExtensions(root)).filter((entry) => !entry.invalid)
  assertCapabilityCollisions([
    ...installed.filter((entry) => !options.overwrite || !ids.includes(entry.manifest.name)).map((entry) => entry.manifest),
    ...resolved.map((entry) => entry.manifest),
  ])
  const current = new Set(installed.map((entry) => entry.manifest.name))
  const writes = []
  for (const extension of resolved) {
    const id = extension.manifest.name
    if (current.has(id) && !options.overwrite) throw new HairnessError('extension_exists', `${id} is already installed.`)
    const extensionRoot = join(root, 'extensions', id)
    for (const file of extension.files) {
      const path = assertInside(extensionRoot, join(extensionRoot, file.path), 'Extension destination')
      if (await exists(path) && !options.overwrite) throw new HairnessError('file_collision', `${relative(root, path)} already exists.`)
      writes.push({ path, content: file.content })
    }
    const manifestPath = join(extensionRoot, 'hairness.json')
    if (await exists(manifestPath) && !options.overwrite) throw new HairnessError('file_collision', `${relative(root, manifestPath)} already exists.`)
    writes.push({ path: manifestPath, content: manifestBytes(installedManifest(extension)) })
  }
  const preview = plan(root, writes, [])
  if (options.dryRun) return { status: 'planned', extensions: ids, ...preview }
  await applyTransaction(root, writes, [])
  return { status: 'added', extensions: ids, ...preview }
}

export async function installedExtensions(root) {
  const base = join(root, 'extensions')
  if (!await exists(base)) return []
  const values = []
  for (const namespace of await directories(base, root)) {
    for (const name of await directories(join(base, namespace), root)) {
      const path = join(base, namespace, name, 'hairness.json')
      if (!await exists(path)) continue
      values.push(await loadInstalled(root, path, `${namespace}/${name}`))
    }
  }
  const ids = values.filter((entry) => !entry.invalid).map((entry) => entry.manifest.name)
  if (new Set(ids).size !== ids.length) throw new HairnessError('extension_invalid', 'Installed Extension names must be unique.')
  return values.sort((left, right) => left.id.localeCompare(right.id))
}

export async function statusExtensions(root, selector) {
  const entries = selector ? [await findInstalled(root, selector)] : await installedExtensions(root)
  return Promise.all(entries.map(extensionStatus))
}

export async function diffExtension(root, selector, options = {}) {
  const installed = await requireValid(await findInstalled(root, selector))
  const local = await extensionStatus(installed)
  const upstream = await resolveExtension(root, options.to ?? installed.manifest.installation.source)
  assertSameExtension(installed, upstream)
  const base = installed.manifest.installation.baseDigests
  const next = new Map(upstream.files.map((file) => [file.path, digest(file.content)]))
  const paths = [...new Set([...Object.keys(base), ...next.keys()])].sort()
  return {
    name: installed.manifest.name,
    from: { version: installed.manifest.version, commit: installed.manifest.installation.resolvedCommit },
    to: { version: upstream.manifest.version, commit: upstream.resolvedCommit },
    local: local.state,
    files: paths.map((path) => ({
      path,
      change: !(path in base) ? 'added' : !next.has(path) ? 'removed' : base[path] === next.get(path) ? 'unchanged' : 'changed',
      local: local.files.find((file) => file.path === path)?.state ?? 'absent',
    })),
  }
}

export async function syncExtensions(root, selector, options = {}) {
  const selected = options.all ? await installedExtensions(root) : [await findInstalled(root, selector)]
  const results = []
  for (const installed of selected) results.push(await syncOne(root, await requireValid(installed), options))
  return results
}

export async function removeExtension(root, selector, options = {}) {
  const installed = await requireValid(await findInstalled(root, selector))
  const current = await extensionStatus(installed)
  if (current.state !== 'clean' && !options.overwrite) {
    throw new HairnessError('extension_customized', `${installed.id} has customized, missing or invalid source-owned files.`, { details: current })
  }
  const deletes = [...Object.keys(installed.manifest.installation.baseDigests).map((path) => join(installed.root, path)), installed.path]
  await applyTransaction(root, [], deletes)
  await removeEmptyParents(installed.root, join(root, 'extensions'))
  return { status: 'removed', name: installed.id, files: Object.keys(installed.manifest.installation.baseDigests) }
}

export async function extensionStatus(entry) {
  if (entry.invalid) return { name: entry.id, state: 'invalid', manifest: 'invalid', files: [], error: entry.invalid.message }
  const installation = entry.manifest.installation
  const expectedManifest = installation.baseManifestDigest
  const actualManifest = manifestDigest(entry.manifest)
  const manifest = actualManifest === expectedManifest ? 'clean' : 'customized'
  const files = []
  for (const [path, expected] of Object.entries(installation.baseDigests)) {
    let state
    try {
      const info = await lstat(join(entry.root, path))
      if (info.isSymbolicLink() || !info.isFile()) state = 'invalid'
      else state = digest(await readFile(join(entry.root, path))) === expected ? 'clean' : 'customized'
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = 'missing'
    }
    files.push({ path, state, baseDigest: expected })
  }
  const state = files.some((file) => file.state === 'invalid') ? 'invalid'
    : files.some((file) => file.state === 'missing') ? 'missing'
      : manifest !== 'clean' || files.some((file) => file.state === 'customized') ? 'customized'
        : 'clean'
  return {
    name: entry.manifest.name,
    version: entry.manifest.version,
    source: installation.source,
    requestedRef: installation.requestedRef,
    resolvedCommit: installation.resolvedCommit,
    mobile: installation.mobile,
    state,
    manifest,
    files,
  }
}

async function syncOne(root, installed, options) {
  const status = await extensionStatus(installed)
  const upstream = await resolveExtension(root, options.to ?? installed.manifest.installation.source)
  assertSameExtension(installed, upstream)
  const others = (await installedExtensions(root)).filter((entry) => !entry.invalid && entry.id !== installed.id).map((entry) => entry.manifest)
  assertCapabilityCollisions([...others, upstream.manifest])
  if (status.state !== 'clean' && !options.overwrite) {
    const result = await diffExtension(root, installed.id, { to: options.to })
    if (options.check) return { status: 'blocked', reason: 'customized', ...result }
    throw new HairnessError('sync_customized', `${installed.id} has local changes; inspect hairness diff or pass --overwrite.`, { details: result })
  }
  const writes = upstream.files.map((file) => ({ path: join(installed.root, file.path), content: file.content }))
  writes.push({ path: installed.path, content: manifestBytes(installedManifest(upstream)) })
  const nextPaths = new Set(upstream.files.map((file) => file.path))
  const deletes = Object.keys(installed.manifest.installation.baseDigests).filter((path) => !nextPaths.has(path)).map((path) => join(installed.root, path))
  const changed = deletes.length > 0 || await anyWriteChanged(writes)
  if (options.check) return { status: changed ? 'available' : 'current', name: installed.id, version: upstream.manifest.version, commit: upstream.resolvedCommit }
  await applyTransaction(root, writes, deletes)
  return { status: 'synced', name: installed.id, version: upstream.manifest.version, commit: upstream.resolvedCommit }
}

async function loadGithub(source, match) {
  const [, owner, repository, extensionPath, requestedRef] = match
  if (!extensionPath || extensionPath.startsWith('/') || extensionPath.includes('..') || extensionPath.includes('\\')) throw new HairnessError('source_invalid', `Invalid GitHub Extension path ${extensionPath}.`)
  const stage = await mkdtemp(join(tmpdir(), 'hairness-extension-'))
  try {
    await git(['init', '--quiet'], { cwd: stage })
    await git(['remote', 'add', 'origin', `https://github.com/${owner}/${repository}.git`], { cwd: stage })
    await git(['fetch', '--quiet', '--depth=1', 'origin', requestedRef ?? 'HEAD'], { cwd: stage })
    await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: stage })
    const resolvedCommit = await git(['rev-parse', 'HEAD'], { cwd: stage })
    const tag = requestedRef ? await git(['ls-remote', '--tags', 'origin', `refs/tags/${requestedRef}`], { cwd: stage }).then(Boolean, () => false) : false
    const pinned = Boolean(requestedRef && (/^[a-f0-9]{40}$/i.test(requestedRef) || tag))
    const manifestPath = extensionPath.endsWith('.json') ? extensionPath : join(extensionPath, 'hairness.json')
    return loadManifest(join(stage, manifestPath), { source, requestedRef: requestedRef ?? null, resolvedCommit, mobile: !pinned })
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function loadManifest(location, context) {
  let document
  let base
  if (/^https:\/\//.test(location)) {
    const remote = await fetchDocument(location)
    document = remote.document
    base = remote.url
  } else {
    const candidate = resolve(context.root ?? process.cwd(), location)
    const stat = await lstat(candidate)
    if (stat.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Extension manifest ${location} must not be a symbolic link.`)
    const path = await realpath(candidate)
    document = JSON.parse(await readFile(path, 'utf8'))
    base = path
  }
  const manifest = sourceManifest(await validateDocument(document, 'extension'))
  validateManifest(manifest)
  const files = []
  for (const file of manifest.files) {
    const content = /^https:\/\//.test(base)
      ? await fetchBytes(new URL(file.path, base).href)
      : await readFile(await resolvePackageFile(dirname(base), file.path, 'Extension file'))
    if (content.length > MAX_FILE_BYTES) throw new HairnessError('source_too_large', `${file.path} exceeds 5 MiB.`)
    files.push({ ...file, content })
  }
  return {
    manifest,
    files,
    source: context.source,
    requestedRef: context.requestedRef ?? null,
    resolvedCommit: context.resolvedCommit ?? null,
    mobile: Boolean(context.mobile),
  }
}

async function loadInstalled(root, path, id) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Extension manifest ${relative(root, path)} must not be a symbolic link.`)
    const manifest = await validateDocument(JSON.parse(await readFile(path, 'utf8')), 'extension')
    if (!manifest.installation) throw new HairnessError('extension_invalid', `${relative(root, path)} has no installation provenance.`)
    if (manifest.name !== id) throw new HairnessError('extension_invalid', `${relative(root, path)} declares ${manifest.name}, expected ${id}.`)
    validateManifest(sourceManifest(manifest))
    return { id, root: dirname(path), path, manifest }
  } catch (error) {
    return { id, root: dirname(path), path, invalid: error }
  }
}

async function findInstalled(root, selector) {
  const matches = (await installedExtensions(root)).filter((entry) => entry.id === selector || entry.id.split('/').at(-1) === selector)
  if (!matches.length) throw new HairnessError('extension_not_installed', `${selector} is not installed.`)
  if (matches.length > 1) throw new HairnessError('extension_ambiguous', `${selector} matches multiple Extensions; use the full name.`)
  return matches[0]
}

function installedManifest(extension) {
  return {
    ...extension.manifest,
    installation: {
      source: extension.source,
      requestedRef: extension.requestedRef,
      resolvedCommit: extension.resolvedCommit,
      mobile: extension.mobile,
      baseManifestDigest: manifestDigest(extension.manifest),
      baseDigests: Object.fromEntries(extension.files.map((file) => [file.path, digest(file.content)])),
    },
  }
}

function sourceManifest(manifest) {
  const { installation, ...source } = manifest
  return source
}

function manifestDigest(manifest) {
  return digest(stable(sourceManifest(manifest)))
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}

function validateManifest(manifest) {
  const paths = new Set()
  for (const file of manifest.files) {
    if (file.path === 'hairness.json') throw new HairnessError('extension_invalid', 'hairness.json is reserved for the Extension manifest.')
    if (paths.has(file.path)) throw new HairnessError('extension_invalid', `${manifest.name} declares ${file.path} more than once.`)
    paths.add(file.path)
    if (file.type === 'hairness:skill' && (!file.id || !file.description)) throw new HairnessError('extension_invalid', `Skill ${file.path} requires id and description.`)
    if (file.type !== 'hairness:skill' && (file.id || file.description)) throw new HairnessError('extension_invalid', `${file.path} may declare id and description only when it is a Skill.`)
  }
  if (manifest.adapter && !paths.has(manifest.adapter.entry)) throw new HairnessError('extension_invalid', `Adapter entry ${manifest.adapter.entry} must be a declared file.`)
}

function assertCapabilityCollisions(manifests) {
  const claims = new Map()
  for (const manifest of manifests) {
    for (const file of manifest.files.filter((entry) => entry.type === 'hairness:skill')) claim(`skill:${file.id}`, manifest.name)
    if (manifest.adapter) claim(`adapter:${manifest.adapter.id}`, manifest.name)
  }
  function claim(id, owner) {
    const current = claims.get(id)
    if (current && current !== owner) throw new HairnessError('capability_collision', `${id} is claimed by both ${current} and ${owner}.`)
    claims.set(id, owner)
  }
}

async function fetchDocument(url) {
  const response = await fetch(assertSafeUrl(url), { redirect: 'follow' })
  assertSafeResponse(response)
  if (!response.ok) throw new HairnessError('source_fetch_failed', `Extension request failed with HTTP ${response.status}.`, { exitCode: 4 })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_FILE_BYTES) throw new HairnessError('source_too_large', 'Extension manifest exceeds 5 MiB.')
  try { return { document: JSON.parse(bytes.toString('utf8')), url: response.url || url } }
  catch (error) { throw new HairnessError('invalid_json', 'Extension returned invalid JSON.', { cause: error }) }
}

async function fetchBytes(url) {
  const response = await fetch(assertSafeUrl(url), { redirect: 'follow' })
  assertSafeResponse(response)
  if (!response.ok) throw new HairnessError('source_fetch_failed', `Extension file request failed with HTTP ${response.status}.`, { exitCode: 4 })
  return Buffer.from(await response.arrayBuffer())
}

function assertSafeUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new HairnessError('source_insecure', 'Extension URLs must use HTTPS without credentials or query secrets.')
  return url.href
}

function assertSafeResponse(response) {
  if (response.url) assertSafeUrl(response.url)
}

async function directories(root, home) {
  const values = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Installed Extension contains symbolic link ${relative(home, join(root, entry.name))}.`)
    if (entry.isDirectory()) values.push(entry.name)
  }
  return values.sort()
}

async function requireValid(entry) {
  if (entry.invalid) throw new HairnessError('extension_invalid', `${entry.id} is invalid: ${entry.invalid.message}`)
  return entry
}

function assertSameExtension(installed, upstream) {
  if (installed.id !== upstream.manifest.name) throw new HairnessError('extension_identity_changed', `${upstream.manifest.name} cannot replace ${installed.id}.`)
}

async function anyWriteChanged(writes) {
  for (const entry of writes) {
    try { if (digest(await readFile(entry.path)) !== digest(entry.content)) return true }
    catch (error) { if (error.code === 'ENOENT') return true; throw error }
  }
  return false
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
      await writeFile(path, entry.content, { mode: 0o644 })
    }
    for (const path of touched) await assertNoSymlink(root, path)
    const backedUp = []
    try {
      for (const path of touched) {
        if (!await exists(path)) continue
        const destination = join(backup, relative(root, path))
        await mkdir(dirname(destination), { recursive: true })
        await rename(path, destination)
        backedUp.push({ path, destination })
      }
      for (const entry of writes) {
        await mkdir(dirname(entry.path), { recursive: true })
        await rename(join(staged, relative(root, entry.path)), entry.path)
      }
    } catch (error) {
      for (const entry of [...writes].reverse()) if (await exists(entry.path)) await rm(entry.path, { recursive: true, force: true })
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

async function assertNoSymlink(root, path) {
  let current = resolve(path)
  while (current !== resolve(root)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new HairnessError('symlink_forbidden', `${relative(root, current)} is a symbolic link.`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
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

function manifestBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`) }
function plan(root, writes, deletes) { return { writes: writes.map((entry) => relative(root, entry.path)).sort(), deletes: deletes.map((path) => relative(root, path)).sort() } }
