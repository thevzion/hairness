import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadDistribution } from '../composition/distributions.mjs'
import { resolveExtensionSource } from '../composition/extensions.mjs'
import { bindTarget, runtimePaths, userPaths } from '../runtime/index.mjs'
import { inspectGit, git } from '../runtime/git.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { initializeOverlay } from '../overlay/index.mjs'
import { doctorHome } from './doctor.mjs'
import { homeDocument, homeId, homeLockDocument } from './index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { copyTree, digest, exists, replaceDirectory, writeJsonAtomic } from '../lib/io.mjs'

const exec = promisify(execFile)
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageDocument = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

export async function previewCreate(destination, options = {}) {
  const target = options.target ? resolve(options.target) : null
  const providers = options.providers ?? ['codex']
  const preset = options.preset ?? 'standard'
  const distribution = (await loadDistribution(options.from ?? preset)).document
  return {
    destination: resolve(destination),
    dependency: options.packageSpec ?? `@hairness/cli@${packageDocument.version}`,
    distribution: distribution.metadata.id,
    extensions: distribution.spec.extensions,
    providers,
    target,
    homeGit: { initialize: true, initialCommit: true },
    overlayGit: { initialize: Boolean(options.overlayGit), initialCommit: Boolean(options.overlayGit) },
    qualification: ['provider build', 'doctor'],
    exclusions: ['remote', 'push', 'tag', 'publication'],
  }
}

export async function createHome(destination, options = {}) {
  const target = resolve(destination)
  if (await exists(target)) throw new HairnessError('destination_exists', `Destination already exists: ${target}.`)
  const id = homeId(target)
  const stage = join(userPaths().runtime, id, 'tmp', `create-${randomUUID()}`)
  const preview = await previewCreate(target, options)
  const distributionResult = await loadDistribution(options.from ?? options.preset ?? 'standard')
  const distribution = distributionResult.document
  const providers = options.providers ?? ['codex']
  const targetInput = options.target ? await targetIdentity(options.target, options.targetId) : null
  const document = homeDocument({
    id,
    language: options.language ?? 'en',
    providers,
    extensions: distribution.spec.extensions,
    targets: targetInput ? [{ id: targetInput.id }] : [],
    overlayGit: Boolean(options.overlayGit),
    snapshot: options.snapshot ?? 'boundary',
  })
  const extensionLocks = []
  try {
    await mkdir(stage, { recursive: true })
    await writeJsonAtomic(join(stage, 'hairness.json'), document)
    const dependency = dependencyValue(options.packageSpec)
    await writeFile(join(stage, 'package.json'), `${JSON.stringify({
      name: id,
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      dependencies: { '@hairness/cli': dependency },
      scripts: { build: 'hairness build', doctor: 'hairness doctor' },
    }, null, 2)}\n`)
    await writeFile(join(stage, '.gitignore'), 'node_modules/\n.overlay/\n.DS_Store\n')
    await git(['init', '--quiet'], { cwd: stage })

    for (const extensionId of distribution.spec.extensions) {
      const source = await resolveExtensionSource(extensionId)
      try {
        const destinationPath = join(stage, 'extensions', ...extensionId.split('/'))
        await copyTree(source.root, destinationPath)
        extensionLocks.push({
          id: extensionId,
          source: source.provenance.source,
          sourceKind: source.provenance.kind,
          requestedRef: source.provenance.requestedRef,
          resolvedCommit: source.provenance.resolvedCommit,
          path: source.provenance.path,
          digest: source.digest,
          installedBaseDigest: source.digest,
        })
      } finally {
        await source.cleanup()
      }
    }
    await writeJsonAtomic(join(stage, 'hairness.lock.json'), homeLockDocument({
      id,
      distribution: {
        id: distribution.metadata.id,
        version: distribution.metadata.version,
        source: options.from ?? options.preset ?? 'standard',
        digest: digest(distribution),
      },
      extensions: extensionLocks,
    }))

    if (options.install !== false) {
      const packageSpec = options.packageSpec ?? `@hairness/cli@${packageDocument.version}`
      await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', packageSpec], {
        cwd: stage,
        env: { ...process.env, npm_config_update_notifier: 'false' },
        maxBuffer: 8 * 1024 * 1024,
      })
    } else {
      await writeFile(join(stage, 'package-lock.json'), `${JSON.stringify({ name: id, lockfileVersion: 3, requires: true, packages: {} }, null, 2)}\n`)
    }

    if (targetInput) await bindTarget(document, targetInput.id, targetInput.path)
    await initializeOverlay(stage, { git: Boolean(options.overlayGit) })
    await buildProviders(stage)
    await doctorHome(stage, { allowMissingDependency: options.install === false })
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await replaceDirectory(stage, target)
    return { status: 'created', home: target, id, preview, launch: launchInstructions(target, providers, targetInput?.path) }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    if (await exists(target)) await rm(target, { recursive: true, force: true })
    throw error
  }
}

async function targetIdentity(path, explicitId) {
  const evidence = await inspectGit(path)
  const id = explicitId ?? basename(evidence.root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return { id, path: evidence.root, evidence }
}

export function launchInstructions(home, providers, target) {
  const values = []
  if (providers.includes('codex')) values.push({ provider: 'codex', command: `codex -C ${quote(home)}${target ? ` --add-dir ${quote(target)}` : ''}`, onboarding: '$hairness-onboarding' })
  if (providers.includes('claude')) values.push({ provider: 'claude', command: `cd ${quote(home)} && claude${target ? ` --add-dir ${quote(target)}` : ''}`, onboarding: '/hairness-onboarding' })
  return values
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

function dependencyValue(packageSpec) {
  if (!packageSpec) return packageDocument.version
  return packageSpec.startsWith('@hairness/cli@') ? packageSpec.slice('@hairness/cli@'.length) : packageSpec
}
