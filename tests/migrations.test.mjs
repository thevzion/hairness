import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyMigration, migrationStatus, planMigration } from '../src/distribution/migrations.mjs'
import { temporaryWorkspace } from './helpers.mjs'

const repositoryRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

async function migrationFixture() {
  const root = await temporaryWorkspace()
  await cp(join(repositoryRoot, 'migrations'), join(root, 'migrations'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'migration-fixture', version: '0.2.0-alpha.0', type: 'module' }))
  await writeFile(join(root, 'hairness.lock.json'), JSON.stringify({
    schemaVersion: 2,
    protocolVersion: '0.2',
    role: 'distribution',
    recipe: { id: 'standard', digest: 'sha256:fixture' },
    generatedFrom: { source: '@hairness/cli', implementationVersion: '0.2.0-alpha.0', protocolVersion: '0.2' },
    updateSource: { kind: 'path', spec: repositoryRoot },
    materials: [],
  }))
  return root
}

test('migration plans and applies work-state promotion, ledger epoch and lock metadata exactly once', async () => {
  const root = await migrationFixture()
  const statePath = join(root, '.overlay/extensions-state/hairness/work-controls/state.json')
  await mkdir(join(root, '.overlay/extensions-state/hairness/work-controls'), { recursive: true })
  await writeFile(statePath, JSON.stringify({ controls: { persistence: 'artifact' }, nested: [{ persistence: 'checkpoint' }] }))
  assert.deepEqual((await migrationStatus(root)).pending, ['command-language-0-2'])
  const plan = await planMigration(root, { to: 'current' })
  assert.equal(plan.status, 'ready')
  assert.ok(plan.changes.some((item) => item.path === '.overlay/invocations/epoch.json'))
  const receipt = await applyMigration(root, plan.id, plan.checkpointId)
  assert.equal(receipt.status, 'succeeded')
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { controls: { promotion: 'artifact' }, nested: [{ promotion: 'effect' }] })
  assert.equal(JSON.parse(await readFile(join(root, '.overlay/invocations/epoch.json'), 'utf8')).protocolVersion, '0.2')
  const lock = JSON.parse(await readFile(join(root, 'hairness.lock.json'), 'utf8'))
  assert.equal(lock.migrations[0].id, 'command-language-0-2')
  assert.equal(lock.migrations[0].digest.startsWith('sha256:'), true)
  assert.deepEqual(await applyMigration(root, plan.id, plan.checkpointId), receipt)
  assert.equal((await migrationStatus(root)).status, 'up-to-date')
})

test('consumer-owned providerCommands produce review-required without mutation', async () => {
  const root = await migrationFixture()
  const local = join(root, 'local/example')
  await mkdir(local, { recursive: true })
  const manifest = { id: 'local/example', providerCommands: [{ id: 'legacy' }] }
  await writeFile(join(local, 'extension.json'), JSON.stringify(manifest))
  await mkdir(join(root, '.overlay'), { recursive: true })
  await writeFile(join(root, '.overlay/config.json'), JSON.stringify({ extensions: { local: [{ id: 'local/example', path: './local/example', enabled: true }] } }))
  const plan = await planMigration(root)
  assert.equal(plan.status, 'review-required')
  assert.equal(plan.changes.find((item) => item.scope === 'extensions').status, 'review-required')
  await assert.rejects(applyMigration(root, plan.id, plan.checkpointId), (error) => error.code === 'migration_review_required')
  assert.deepEqual(JSON.parse(await readFile(join(local, 'extension.json'), 'utf8')), manifest)
})

test('unknown structured migration transforms are rejected before a checkpoint', async () => {
  const root = await migrationFixture()
  const descriptorPath = join(root, 'migrations/command-language-0-2/migration.json')
  const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
  descriptor.transform = 'arbitrary-code'
  await writeFile(descriptorPath, JSON.stringify(descriptor))
  await assert.rejects(planMigration(root), (error) => error.code === 'migration_transform_unknown')
})

test('a missing version chain blocks planning explicitly', async () => {
  const root = await migrationFixture()
  const status = await migrationStatus(root, { to: '0.2.0-alpha.9' })
  assert.equal(status.status, 'blocked')
  const plan = await planMigration(root, { to: '0.2.0-alpha.9' })
  assert.equal(plan.status, 'review-required')
  assert.match(plan.limits[0], /No migration chain/)
})

test('candidate path escape stops with an explicit unknown receipt', async () => {
  const root = await migrationFixture()
  const plan = await planMigration(root)
  const planPath = join(root, '.overlay/extensions-state/hairness/distribution/migration-plans', `${plan.id}.json`)
  const stored = JSON.parse(await readFile(planPath, 'utf8'))
  stored.candidateRoot = join(root, '..', 'escaped-candidate')
  await writeFile(planPath, JSON.stringify(stored))
  await assert.rejects(applyMigration(root, plan.id, plan.checkpointId), (error) => error.code === 'migration_unknown' && /escapes/.test(error.details.cause))
  const receipt = JSON.parse(await readFile(join(root, '.overlay/extensions-state/hairness/distribution/migration-receipts', `${plan.id}.json`), 'utf8'))
  assert.equal(receipt.status, 'unknown')
})
