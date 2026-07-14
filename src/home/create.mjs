import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadDistribution } from '../composition/distributions.mjs'
import { resolveExtensionSource } from '../composition/extensions.mjs'
import { runtimePaths, userPaths } from '../runtime/index.mjs'
import { git } from '../runtime/git.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { initializeOverlay } from '../overlay/index.mjs'
import { doctorHome } from './doctor.mjs'
import { homeDocument, homeId, homeLockDocument } from './index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { copyTree, digest, exists, replaceDirectory, writeJsonAtomic } from '../lib/io.mjs'
import { bindTargetLink, inspectRepository, normalizeRemote } from '../targets/index.mjs'

const exec = promisify(execFile)
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageDocument = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

export async function previewCreate(destination, options = {}) {
  const preset = options.preset ?? 'standard'
  const loaded = await loadDistribution(options.from ?? preset, { ref: options.distributionRef, path: options.distributionPath })
  try {
    return createPreview(destination, options, loaded.document)
  } finally {
    await loaded.cleanup()
  }
}

function createPreview(destination, options, distribution) {
  const target = options.target ? resolve(options.target) : null
  const workspace = options.workspaceRoot ? resolve(options.workspaceRoot) : null
  const providers = options.providers ?? ['codex']
  return {
    destination: resolve(destination),
    dependency: options.packageSpec ?? `@hairness/cli@${packageDocument.version}`,
    distribution: distribution.metadata.id,
    extensions: distribution.spec.extensions,
    providers,
    repositoryAccess: target ? { kind: 'target', path: target } : workspace ? { kind: 'workspace', path: workspace } : null,
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
  const runtime = runtimePaths(id)
  await mkdir(userPaths().runtime, { recursive: true })
  try {
    await mkdir(runtime.root)
  } catch (error) {
    if (error.code === 'EEXIST') throw new HairnessError('home_runtime_exists', `Runtime identity ${id} already exists. Archive or remove that Home runtime before creating another Home with the same identity.`)
    throw error
  }
  const stage = join(runtime.tmp, `create-${randomUUID()}`)
  let distributionResult
  try {
    await mkdir(runtime.tmp, { recursive: true })
    distributionResult = await loadDistribution(options.from ?? options.preset ?? 'standard', { ref: options.distributionRef, path: options.distributionPath, tmp: runtime.tmp })
    const distribution = distributionResult.document
    const preview = createPreview(target, options, distribution)
    const providers = options.providers ?? ['codex']
    const targetInput = options.target ? await targetIdentity(options.target, options.targetId, distribution.spec.targets ?? []) : null
    const targets = [...(distribution.spec.targets ?? [])]
    if (targetInput && !targets.some((item) => item.id === targetInput.target.id)) targets.push(targetInput.target)
    const document = homeDocument({
      id,
      providers,
      extensions: distribution.spec.extensions,
      targets,
      config: distribution.spec.config ?? {},
      overlayGit: Boolean(options.overlayGit),
      snapshot: options.snapshot ?? 'boundary',
    })
    const extensionLocks = []
    await mkdir(stage, { recursive: true })
    await writeJsonAtomic(join(stage, 'hairness.json'), document)
    const dependency = dependencyValue(options.packageSpec)
    await writeFile(join(stage, 'package.json'), `${JSON.stringify({
      name: id,
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      workspaces: ['extensions/*/*'],
      dependencies: { '@hairness/cli': dependency },
      scripts: { build: 'hairness build', doctor: 'hairness doctor' },
    }, null, 2)}\n`)
    await writeFile(join(stage, '.gitignore'), 'node_modules/\ntargets/\n.overlay/\n.DS_Store\n')
    await git(['init', '--quiet'], { cwd: stage })

    for (const extensionId of distribution.spec.extensions) {
      const bundled = join(distributionResult.root, 'extensions', ...extensionId.split('/'))
      const isBundled = await exists(join(bundled, 'extension.json'))
      const source = await resolveExtensionSource(isBundled ? bundled : extensionId)
      try {
        const destinationPath = join(stage, 'extensions', ...extensionId.split('/'))
        await copyTree(source.root, destinationPath)
        extensionLocks.push({
          id: extensionId,
          source: isBundled ? distributionResult.provenance.source : source.provenance.source,
          sourceKind: isBundled ? distributionResult.provenance.kind : source.provenance.kind,
          requestedRef: isBundled ? distributionResult.provenance.requestedRef : source.provenance.requestedRef,
          resolvedCommit: isBundled ? distributionResult.provenance.resolvedCommit : source.provenance.resolvedCommit,
          path: isBundled ? `extensions/${extensionId}` : source.provenance.path,
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
        source: distributionResult.provenance.source,
        sourceKind: distributionResult.provenance.kind,
        requestedRef: distributionResult.provenance.requestedRef,
        resolvedCommit: distributionResult.provenance.resolvedCommit,
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

    await initializeOverlay(stage, { git: Boolean(options.overlayGit), profile: { language: options.language ?? 'en' } })
    if (targetInput) await bindTargetLink(stage, targetInput.target.id, targetInput.path)
    if (options.workspaceRoot) await writeJsonAtomic(runtime.onboarding, { discoveryRoot: resolve(options.workspaceRoot), createdAt: new Date().toISOString() })
    await buildProviders(stage)
    await doctorHome(stage, { allowMissingDependency: options.install === false })
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await replaceDirectory(stage, target)
    return { status: 'created', home: target, id, preview, launch: launchInstructions(target, providers, targetInput?.path ?? options.workspaceRoot) }
  } catch (error) {
    await rm(runtime.root, { recursive: true, force: true })
    throw error
  } finally {
    await distributionResult?.cleanup()
  }
}

async function targetIdentity(path, explicitId, expected) {
  const evidence = await inspectRepository(path)
  const observed = new Set(evidence.remotes.map((item) => item.normalized))
  const matched = expected.find((target) => target.remotes.some((remote) => observed.has(normalizeRemote(remote))))
  const id = explicitId ?? matched?.id ?? basename(evidence.root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  const target = matched ?? { id, kind: 'git', summary: basename(evidence.root), requirement: 'recommended', remotes: evidence.remotes.map((item) => item.url) }
  return { target: { ...target, id }, path: evidence.root, evidence }
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
