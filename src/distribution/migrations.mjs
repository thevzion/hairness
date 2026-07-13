import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { ensureInvocationEpoch } from '../core/invocations.mjs'
import { readJson, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract, validateSchemaSet } from '../core/contracts.mjs'

function safePath(root, path) {
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new HairnessError('migration_path_escape', `Migration path escapes its candidate: ${path}`, { exitCode: 2 })
  return target
}

function safeCandidateRoot(root, value) {
  const base = resolve(workspacePaths(root).scratch, 'hairness-migrations')
  const target = resolve(value)
  if (relative(base, target).startsWith('..')) throw new HairnessError('migration_path_escape', `Migration candidate escapes scratch: ${value}`, { exitCode: 2 })
  return target
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

async function packageVersion(root) {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
}

async function descriptors(sourceRoot) {
  const root = join(sourceRoot, 'migrations')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const values = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const value = await readJson(join(root, entry.name, 'migration.json'))
    await validateContract('MigrationDescriptor', value)
    values.push(value)
  }
  return values
}

function migrationChain(values, fromVersion, toVersion, applied) {
  const pending = values.filter((item) => !applied.has(item.id))
  const same = pending.filter((item) => item.fromVersion === item.toVersion)
  const edges = pending.filter((item) => item.fromVersion !== item.toVersion)
  const queue = [{ version: fromVersion, path: [] }]
  const seen = new Set([fromVersion])
  let path = null
  while (queue.length) {
    const current = queue.shift()
    if (current.version === toVersion) { path = current.path; break }
    for (const edge of edges.filter((item) => item.fromVersion === current.version).sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(edge.toVersion)) continue
      seen.add(edge.toVersion)
      queue.push({ version: edge.toVersion, path: [...current.path, edge] })
    }
  }
  if (!path) return { migrations: [], complete: false }
  const migrations = []
  let version = fromVersion
  for (const edge of path) {
    migrations.push(...same.filter((item) => item.fromVersion === version).sort((a, b) => a.id.localeCompare(b.id)), edge)
    version = edge.toVersion
  }
  migrations.push(...same.filter((item) => item.fromVersion === toVersion).sort((a, b) => a.id.localeCompare(b.id)))
  return { migrations, complete: true }
}

async function rewritePersistence(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  let changed = 0
  for (const entry of entries) {
    const target = join(path, entry.name)
    if (entry.isDirectory()) changed += await rewritePersistence(target)
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const value = await readJson(target)
      const serialized = JSON.stringify(value)
      if (!serialized.includes('persistence')) continue
      const transform = (input) => {
        if (Array.isArray(input)) return input.map(transform)
        if (!input || typeof input !== 'object') return input
        const output = {}
        for (const [key, item] of Object.entries(input)) {
          const nextKey = key === 'persistence' ? 'promotion' : key
          const nextValue = key === 'persistence'
            ? ({ offer: 'none', none: 'none', artifact: 'artifact', checkpoint: 'effect', effect: 'effect' }[item] ?? item)
            : transform(item)
          output[nextKey] = nextValue
        }
        return output
      }
      await writeJsonAtomic(target, transform(value))
      changed += 1
    }
  }
  return changed
}

async function localExtensionChanges(root) {
  const config = await readJson(workspacePaths(root).config, {})
  const changes = []
  for (const extension of config.extensions?.local ?? []) {
    const path = resolve(root, extension.path)
    const manifest = await readJson(join(path, 'extension.json'), null)
    if (manifest?.providerCommands) changes.push({
      scope: 'extensions',
      path: relative(root, join(path, 'extension.json')) || join(path, 'extension.json'),
      status: 'review-required',
      summary: `${extension.id} owns providerCommands and requires an explicit CommandSurfaceSpec review.`,
    })
  }
  return changes
}

async function applyTransform(candidateRoot, descriptor) {
  if (descriptor.transform !== 'command-language-0-2') throw new HairnessError('migration_transform_unknown', `Unknown structured transform: ${descriptor.transform}`, { exitCode: 2 })
  const overlay = safePath(candidateRoot, '.overlay')
  const changed = await rewritePersistence(join(overlay, 'extensions-state', 'hairness', 'work-controls'))
  await ensureInvocationEpoch(candidateRoot)
  return [
    { scope: 'overlay', path: '.overlay/invocations/epoch.json', status: 'safe', summary: 'Start the local invocation epoch and classify older ledger entries as legacy.' },
    ...(changed ? [{ scope: 'overlay', path: '.overlay/extensions-state/hairness/work-controls', status: 'safe', summary: `Replace persistence with promotion in ${changed} work-state file(s).` }] : []),
    { scope: 'providers', path: '.agents/skills and .claude/skills', status: 'safe', summary: 'Rebuild generated x-* projections as cmd-* projections after migration.' },
  ]
}

function plansPath(root, id) {
  return join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'migration-plans', `${id}.json`)
}

export async function migrationStatus(root, options = {}) {
  const lock = await readJson(join(root, 'hairness.lock.json'))
  await validateContract('DistributionLock', lock)
  const sourceRoot = options.sourceRoot ?? root
  const target = options.to && options.to !== 'current' ? options.to : await packageVersion(sourceRoot)
  const applied = new Set((lock.migrations ?? []).map((item) => item.id))
  const chain = migrationChain(await descriptors(sourceRoot), lock.generatedFrom.implementationVersion, target, applied)
  const missing = !chain.complete
  return { summary: missing ? `No complete migration chain reaches ${target}.` : chain.migrations.length ? `${chain.migrations.length} migration(s) pending for ${target}.` : `Distribution is migrated to ${target}.`, status: missing ? 'blocked' : chain.migrations.length ? 'pending' : 'up-to-date', fromVersion: lock.generatedFrom.implementationVersion, toVersion: target, pending: chain.migrations.map((item) => item.id), applied: [...applied], limits: missing ? [`migration-chain-missing:${lock.generatedFrom.implementationVersion}->${target}`] : [], routes: chain.migrations.length || missing ? [`hairness migrate plan --to ${target}`] : [] }
}

export async function planMigration(root, options = {}) {
  const lock = await readJson(join(root, 'hairness.lock.json'))
  await validateContract('DistributionLock', lock)
  const sourceRoot = options.sourceRoot ?? root
  const toVersion = options.to && options.to !== 'current' ? options.to : await packageVersion(sourceRoot)
  const applied = new Set((lock.migrations ?? []).map((item) => item.id))
  const chain = migrationChain(await descriptors(sourceRoot), lock.generatedFrom.implementationVersion, toVersion, applied)
  const migrations = chain.migrations
  const id = `migration-${randomUUID()}`
  const candidateRoot = join(workspacePaths(root).scratch, 'hairness-migrations', id, 'candidate')
  await mkdir(candidateRoot, { recursive: true })
  for (const path of ['invocations', 'extensions-state/hairness/work-controls']) {
    const source = join(workspacePaths(root).overlay, path)
    if (await lstat(source).catch(() => null)) {
      const target = join(candidateRoot, '.overlay', path)
      await mkdir(dirname(target), { recursive: true })
      await cp(source, target, { recursive: true })
    }
  }
  const changes = []
  for (const descriptor of migrations) changes.push(...await applyTransform(candidateRoot, descriptor))
  changes.push(...await localExtensionChanges(root))
  if (!chain.complete) changes.push({ scope: 'lock', path: 'hairness.lock.json', status: 'review-required', summary: `No migration chain reaches ${toVersion} from ${lock.generatedFrom.implementationVersion}.` })
  const limits = changes.filter((item) => item.status === 'review-required').map((item) => item.summary)
  const status = !chain.complete || limits.length ? 'review-required' : migrations.length === 0 ? 'up-to-date' : 'ready'
  const checkpointId = `migration-${digest({ from: lock.generatedFrom.implementationVersion, toVersion, migrations, changes }).slice(7, 23)}`
  const plan = { schemaVersion: 2, protocolVersion: '0.2', id, fromVersion: lock.generatedFrom.implementationVersion, toVersion, candidateRoot, migrations, changes, status, checkpointId, createdAt: new Date().toISOString(), limits }
  await validateContract('MigrationPlan', plan)
  await writeJsonAtomic(plansPath(root, id), plan)
  return plan
}

export async function applyMigration(root, planId, checkpointId) {
  const plan = await readJson(plansPath(root, planId), null)
  if (!plan) throw new HairnessError('migration_plan_missing', `Unknown migration plan: ${planId}`, { exitCode: 4 })
  await validateContract('MigrationPlan', plan)
  if (plan.checkpointId !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Migration checkpoint does not match the accepted plan.', { exitCode: 2 })
  if (plan.status === 'review-required') throw new HairnessError('migration_review_required', 'Migration contains consumer-owned changes that require review.', { exitCode: 4 })
  const receiptPath = join(workspacePaths(root).overlay, 'extensions-state', 'hairness', 'distribution', 'migration-receipts', `${planId}.json`)
  const existing = await readJson(receiptPath, null)
  if (existing?.status === 'succeeded') return existing
  try {
    await validateSchemaSet()
    if (plan.migrations.length) {
      const candidateRoot = safeCandidateRoot(root, plan.candidateRoot)
      for (const path of ['invocations', 'extensions-state/hairness/work-controls']) {
        const source = safePath(candidateRoot, `.overlay/${path}`)
        if (!await lstat(source).catch(() => null)) continue
        const target = join(workspacePaths(root).overlay, path)
        const temporary = `${target}.${process.pid}.hairness-migration`
        await rm(temporary, { recursive: true, force: true })
        await mkdir(dirname(temporary), { recursive: true })
        await cp(source, temporary, { recursive: true })
        await rm(target, { recursive: true, force: true })
        await rename(temporary, target)
      }
    }
    const lock = await readJson(join(root, 'hairness.lock.json'))
    const appliedAt = new Date().toISOString()
    const current = new Map((lock.migrations ?? []).map((item) => [item.id, item]))
    for (const descriptor of plan.migrations) current.set(descriptor.id, { id: descriptor.id, fromVersion: descriptor.fromVersion, toVersion: descriptor.toVersion, digest: digest(descriptor), appliedAt })
    lock.migrations = [...current.values()]
    lock.generatedFrom.implementationVersion = plan.toVersion
    lock.generatedFrom.createdAt = appliedAt
    await validateContract('DistributionLock', lock)
    await writeJsonAtomic(join(root, 'hairness.lock.json'), lock)
    const { buildProviders } = await import('../providers/compiler.mjs')
    await buildProviders(root)
    const receipt = { schemaVersion: 2, protocolVersion: '0.2', planId, status: 'succeeded', migrations: plan.migrations.map((item) => item.id), checkpointId, completedAt: appliedAt, limits: [] }
    await validateContract('MigrationReceipt', receipt)
    await writeJsonAtomic(receiptPath, receipt)
    return receipt
  } catch (error) {
    const receipt = { schemaVersion: 2, protocolVersion: '0.2', planId, status: 'unknown', migrations: plan.migrations.map((item) => item.id), checkpointId, completedAt: new Date().toISOString(), limits: [error.message] }
    await writeJsonAtomic(receiptPath, receipt)
    throw new HairnessError('migration_unknown', 'Migration stopped without a validated final receipt.', { exitCode: 5, details: { cause: error.message }, routes: ['hairness migrate status'] })
  }
}
