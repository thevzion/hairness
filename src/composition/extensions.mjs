import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDocument } from '../contracts/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertInside, digest, exists, readJson, treeDigest } from '../lib/io.mjs'
import { git } from '../runtime/git.mjs'

const officialRoot = fileURLToPath(new URL('../../assets/extensions/', import.meta.url))

function officialPath(id) {
  return join(officialRoot, ...id.split('/'))
}

export async function inspectExtension(path) {
  const root = await realpath(path)
  const manifest = await readJson(join(root, 'extension.json'))
  await validateDocument(manifest, 'Extension')
  for (const collection of ['recipes', 'adapters', 'schemas', 'tests']) {
    for (const entry of manifest.spec[collection]) {
      const target = assertInside(root, resolve(root, entry.path), `${collection} path`)
      if (!await exists(target)) throw new HairnessError('extension_file_missing', `${manifest.metadata.id} is missing ${entry.path}.`)
    }
  }
  return { root, manifest, digest: await treeDigest(root) }
}

export async function resolveExtensionSource(source, options = {}) {
  if (/^(?:https?|file):\/\//.test(source) || /^git@/.test(source)) return resolveGitSource(source, options)
  const path = source.startsWith('.') || source.startsWith('/') ? resolve(options.cwd ?? process.cwd(), source) : officialPath(source)
  const inspected = await inspectExtension(path)
  const kind = path.startsWith(officialRoot) ? 'official' : 'path'
  return {
    ...inspected,
    provenance: { kind, source: kind === 'path' ? path : source, requestedRef: null, resolvedCommit: null, path: '.', digest: inspected.digest },
    cleanup: async () => {},
  }
}

async function resolveGitSource(source, options) {
  const temporaryRoot = await mkdtemp(join(options.tmp ?? process.cwd(), '.hairness-extension-'))
  const repository = join(temporaryRoot, 'repository')
  try {
    await git(['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', repository])
    await git(['-C', repository, 'remote', 'add', 'origin', source])
    const requestedRef = options.ref ?? 'HEAD'
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet', '--depth=1', 'origin', requestedRef])
    const resolvedCommit = await git(['-C', repository, 'rev-parse', 'FETCH_HEAD'])
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', resolvedCommit])
    const subtree = options.path ? assertInside(repository, join(repository, options.path), 'extension subtree') : repository
    const inspected = await inspectExtension(subtree)
    return {
      ...inspected,
      provenance: {
        kind: 'git',
        source,
        requestedRef,
        resolvedCommit,
        path: options.path ?? '.',
        digest: inspected.digest,
      },
      cleanup: async () => rm(temporaryRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

export async function activeExtensions(root, home) {
  const values = []
  for (const id of home.spec.extensions) {
    let installed = join(root, 'extensions', ...id.split('/'))
    if (!await exists(join(installed, 'extension.json'))) installed = join(root, 'assets', 'extensions', ...id.split('/'))
    values.push(await inspectExtension(installed))
  }
  validateComposition(values)
  return values
}

export function validateComposition(extensions) {
  const capabilities = new Map()
  const recipes = new Map()
  for (const extension of extensions) {
    for (const id of extension.manifest.spec.provides) {
      if (capabilities.has(id)) throw new HairnessError('capability_collision', `${id} is provided by both ${capabilities.get(id)} and ${extension.manifest.metadata.id}.`)
      capabilities.set(id, extension.manifest.metadata.id)
    }
    for (const recipe of extension.manifest.spec.recipes) {
      if (recipes.has(recipe.id)) throw new HairnessError('command_collision', `${recipe.id} is declared by multiple extensions.`)
      recipes.set(recipe.id, extension.manifest.metadata.id)
    }
  }
  for (const extension of extensions) {
    for (const required of extension.manifest.spec.requires) {
      if (!capabilities.has(required)) throw new HairnessError('capability_missing', `${extension.manifest.metadata.id} requires ${required}.`)
    }
  }
  return { capabilities, recipes }
}
