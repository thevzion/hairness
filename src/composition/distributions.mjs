import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDocument } from '../contracts/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertInside } from '../lib/io.mjs'
import { git } from '../runtime/git.mjs'

const presets = new Set(['minimal', 'standard'])

export async function loadDistribution(source = 'standard', options = {}) {
  if (presets.has(source)) {
    const path = fileURLToPath(new URL(`../../distributions/${source}/hairness.distribution.json`, import.meta.url))
    return readDistribution(path, { kind: 'official', source, requestedRef: null, resolvedCommit: null }, async () => {})
  }
  if (/^(?:https?|file):\/\//.test(source) || /^git@/.test(source)) return loadGitDistribution(source, options)
  const input = resolve(options.cwd ?? process.cwd(), source)
  let path = input
  try {
    if ((await stat(input)).isDirectory()) path = join(input, 'hairness.distribution.json')
  } catch (error) {
    if (error.code === 'ENOENT') throw new HairnessError('distribution_not_found', `Distribution not found: ${source}.`)
    throw error
  }
  return readDistribution(path, { kind: 'path', source: dirname(path), requestedRef: null, resolvedCommit: null }, async () => {})
}

async function loadGitDistribution(source, options) {
  const temporary = await mkdtemp(join(options.tmp ?? tmpdir(), 'hairness-distribution-'))
  const repository = join(temporary, 'repository')
  try {
    await git(['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', repository])
    await git(['-C', repository, 'remote', 'add', 'origin', source])
    const requestedRef = options.ref ?? 'HEAD'
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet', '--depth=1', 'origin', requestedRef])
    const resolvedCommit = await git(['-C', repository, 'rev-parse', 'FETCH_HEAD'])
    await git(['-C', repository, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', resolvedCommit])
    const root = options.path ? assertInside(repository, join(repository, options.path), 'Distribution subtree') : repository
    return readDistribution(join(root, 'hairness.distribution.json'), { kind: 'git', source, requestedRef, resolvedCommit }, async () => rm(temporary, { recursive: true, force: true }))
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

async function readDistribution(path, provenance, cleanup) {
  let document
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new HairnessError('distribution_not_found', `Distribution manifest not found: ${path}.`)
    throw error
  }
  await validateDocument(document, 'Distribution')
  return { path, root: dirname(path), document, provenance, cleanup }
}
