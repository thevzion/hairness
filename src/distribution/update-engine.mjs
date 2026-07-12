import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { readJson, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract } from '../core/contracts.mjs'

const exec = promisify(execFile)

async function digestPath(path) {
  const hash = createHash('sha256')
  async function visit(target, prefix = '') {
    const stat = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stat) { hash.update('missing'); return }
    if (stat.isSymbolicLink()) throw new HairnessError('update_symlink_forbidden', `Update material cannot be a symlink: ${target}`, { exitCode: 2 })
    if (stat.isDirectory()) {
      for (const entry of (await readdir(target)).sort()) await visit(join(target, entry), `${prefix}${entry}/`)
      return
    }
    hash.update(prefix)
    hash.update(await readFile(target))
  }
  await visit(path)
  return `sha256:${hash.digest('hex')}`
}

function safePath(root, path) {
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new HairnessError('update_path_escape', `Update path escapes the distribution: ${path}`, { exitCode: 2 })
  return target
}

export async function inspectDistribution(root) {
  const lock = await readJson(join(root, 'hairness.lock.json'), null)
  if (!lock) throw new HairnessError('distribution_lock_missing', 'hairness.lock.json is missing.', { exitCode: 4, routes: ['hairness update doctor'] })
  await validateContract('DistributionLock', lock)
  return lock
}

export async function doctorDistribution(root) {
  const lock = await inspectDistribution(root)
  const checks = []
  for (const material of lock.materials) {
    const currentDigest = await digestPath(safePath(root, material.path))
    checks.push({ id: material.id, path: material.path, policy: material.policy, baseDigest: material.baseDigest, currentDigest, status: currentDigest === material.baseDigest ? 'intact' : 'diverged' })
  }
  const diverged = checks.filter((check) => check.status === 'diverged')
  return { summary: diverged.length ? `${diverged.length} Hairness material(s) diverged.` : 'All tracked Hairness materials are intact.', status: diverged.length ? 'review-required' : 'ready', checks, limits: diverged.map((item) => `${item.path} diverged from its source-owned base`), routes: [] }
}

async function materializeSource(root, source) {
  const scratch = join(workspacePaths(root).scratch, 'hairness-distribution')
  await mkdir(scratch, { recursive: true })
  if (source.kind === 'path') return { path: await realpath(resolve(root, source.spec)), cleanup: async () => {} }
  const temporary = await mkdtemp(join(scratch, 'source-'))
  let tarball = source.kind === 'tarball' ? resolve(root, source.spec) : null
  if (!tarball) {
    const packed = await exec('npm', ['pack', source.spec, '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', timeout: 120_000 })
    tarball = join(temporary, JSON.parse(packed.stdout)[0].filename)
  }
  await exec('tar', ['-xzf', tarball, '-C', temporary], { encoding: 'utf8', timeout: 30_000 })
  const packageRoot = join(temporary, 'package')
  return { path: await lstat(packageRoot).then(() => packageRoot).catch(() => temporary), cleanup: async () => rm(temporary, { recursive: true, force: true }) }
}

function parseSource(lock, override) {
  if (!override) return lock.updateSource
  if (override.endsWith('.tgz')) return { kind: 'tarball', spec: override }
  if (override.startsWith('.') || override.startsWith('/')) return { kind: 'path', spec: override }
  return { kind: 'npm', spec: override, channel: lock.updateSource.channel }
}

function scopeMatches(material, scope) {
  return !scope || scope === 'all' || material.scope === scope
}

export async function checkDistributionUpdate(root) {
  const lock = await inspectDistribution(root)
  if (lock.updateSource.kind !== 'npm') return { summary: `Update source is ${lock.updateSource.kind}:${lock.updateSource.spec}.`, status: 'configured', source: lock.updateSource, limits: ['No network request was made.'], routes: ['hairness update plan'] }
  const { stdout } = await exec('npm', ['view', lock.updateSource.spec, 'version', '--json'], { cwd: root, encoding: 'utf8', timeout: 30_000 })
  return { summary: `Latest configured version is ${JSON.parse(stdout)}.`, status: 'checked', source: lock.updateSource, limits: [], routes: ['hairness update plan'] }
}

export async function planDistributionUpdate(root, options = {}) {
  const lock = await inspectDistribution(root)
  const source = parseSource(lock, options.to)
  const materialized = await materializeSource(root, source)
  const id = `update-${randomUUID()}`
  const candidateRoot = join(workspacePaths(root).scratch, 'hairness-distribution', id, 'candidate')
  await mkdir(candidateRoot, { recursive: true })
  for (const material of lock.materials.filter((item) => scopeMatches(item, options.scope))) {
    const sourcePath = safePath(materialized.path, material.sourcePath)
    const targetPath = safePath(candidateRoot, material.sourcePath)
    const exists = await lstat(sourcePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (exists) { await mkdir(dirname(targetPath), { recursive: true }); await cp(sourcePath, targetPath, { recursive: true }) }
  }
  await materialized.cleanup()
  const changes = []
  for (const material of lock.materials.filter((item) => scopeMatches(item, options.scope))) {
    const currentDigest = await digestPath(safePath(root, material.path))
    const nextDigest = await digestPath(safePath(candidateRoot, material.sourcePath))
    const currentIntact = currentDigest === material.baseDigest
    const status = nextDigest === currentDigest ? 'unchanged' : currentIntact ? 'safe' : 'review-required'
    changes.push({ materialId: material.id, owner: material.owner, path: material.path, sourcePath: material.sourcePath, scope: material.scope, policy: material.policy, baseDigest: material.baseDigest, currentDigest, nextDigest, status })
  }
  const ambiguous = changes.filter((change) => change.status === 'review-required')
  const plan = { schemaVersion: 2, protocolVersion: '0.2', id, source, scope: options.scope ?? 'all', candidateRoot, changes, status: ambiguous.length ? 'review-required' : 'ready', checkpointId: `update-${createHash('sha256').update(JSON.stringify({ source, changes })).digest('hex').slice(0, 16)}`, createdAt: new Date().toISOString(), limits: ambiguous.map((change) => `${change.path} contains consumer divergence`) }
  await writeJsonAtomic(join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'plans', `${id}.json`), plan)
  return plan
}

export async function applyDistributionUpdate(root, planId, checkpointId) {
  const planPath = join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'plans', `${planId}.json`)
  const plan = await readJson(planPath, null)
  if (!plan) throw new HairnessError('update_plan_missing', `Unknown update plan: ${planId}`, { exitCode: 4 })
  if (plan.checkpointId !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Update checkpoint does not match the accepted plan.', { exitCode: 2 })
  if (plan.status !== 'ready' || plan.changes.some((change) => change.status === 'review-required')) throw new HairnessError('update_review_required', 'Update contains consumer divergence and cannot be applied automatically.', { exitCode: 4 })
  const lock = await inspectDistribution(root)
  const updated = new Map()
  try {
    for (const change of plan.changes.filter((item) => item.status === 'safe')) {
      const target = safePath(root, change.path)
      const source = safePath(plan.candidateRoot, change.sourcePath)
      const temporary = `${target}.${process.pid}.hairness-update`
      await rm(temporary, { recursive: true, force: true })
      const exists = await lstat(source).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (exists) {
        await mkdir(dirname(temporary), { recursive: true })
        await cp(source, temporary, { recursive: true })
        await rm(target, { recursive: true, force: true })
        await rename(temporary, target)
      } else await rm(target, { recursive: true, force: true })
      updated.set(change.materialId, change.nextDigest)
    }
    lock.materials = lock.materials.map((material) => updated.has(material.id) ? { ...material, baseDigest: updated.get(material.id) } : material)
    lock.generatedFrom = { ...lock.generatedFrom, ...(plan.source.kind === 'path' ? {} : { source: plan.source.spec }), createdAt: new Date().toISOString() }
    await validateContract('DistributionLock', lock)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), lock)
    const { buildProviders } = await import('../providers/compiler.mjs')
    await buildProviders(root)
    const receipt = { schemaVersion: 2, protocolVersion: '0.2', planId, status: 'succeeded', materials: [...updated.keys()], checkpointId, completedAt: new Date().toISOString(), limits: [] }
    await writeJsonAtomic(join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'receipts', `${planId}.json`), receipt)
    return receipt
  } catch (error) {
    await writeJsonAtomic(join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'receipts', `${planId}.json`), { schemaVersion: 2, protocolVersion: '0.2', planId, status: 'unknown', completedAt: new Date().toISOString(), limits: [error.message], routes: [`hairness update doctor`, `hairness update plan --scope ${plan.scope}`] })
    throw new HairnessError('update_unknown', 'Update stopped without a validated final receipt.', { exitCode: 5, details: { cause: error.message }, routes: ['hairness update doctor'] })
  }
}

export async function digestMaterial(path) { return digestPath(path) }
