import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  acquireLocks,
  assertEffectAllowed,
  createRun,
  grantCheckpoint,
  listLocks,
  quarantineLocks,
  releaseLocks,
  resolveLock,
} from '../src/core/index.mjs'
import { assignment, temporaryWorkspace } from './helpers.mjs'

test('effect grant is scoped to declared target and effect', async () => {
  const root = await temporaryWorkspace()
  await createRun(root, { id: 'run-exec', planId: 'plan-1', assignment: assignment({ profile: 'executor', targets: ['/target'], requestedEffects: ['filesystem:write'] }) })
  await assert.rejects(assertEffectAllowed(root, 'run-exec', 'filesystem:write', '/target'), (error) => error.code === 'authority_missing')
  await grantCheckpoint(root, {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'checkpoint-1',
    runId: 'run-exec',
    mode: 'mutation',
    intent: 'Implement the ticket.',
    targets: ['/target'],
    effects: ['filesystem:write'],
    exclusions: ['git:commit'],
    risk: 'Working tree mutation.',
    proof: ['tests'],
    approved: true,
  })
  assert.equal((await assertEffectAllowed(root, 'run-exec', 'filesystem:write', '/target')).id, 'grant-checkpoint-1')
  await assert.rejects(assertEffectAllowed(root, 'run-exec', 'git:commit', '/target'), (error) => error.code === 'authority_exceeded')
  const denied = async (effects) => ({ owner: 'test/policy', requestedEffects: effects, allowedEffects: [], deniedEffects: effects, reasons: ['test policy'], digest: 'sha256:denied', observedAt: new Date().toISOString() })
  await assert.rejects(grantCheckpoint(root, {
    schemaVersion: 2, protocolVersion: '0.2', id: 'checkpoint-denied', runId: 'run-exec', mode: 'mutation', intent: 'Mutate while denied.', targets: ['/target'], effects: ['filesystem:write'], exclusions: [], risk: 'Denied.', proof: [], approved: true,
  }, denied), (error) => error.code === 'effect_policy_denied')
  await assert.rejects(assertEffectAllowed(root, 'run-exec', 'filesystem:write', '/target', denied), (error) => error.code === 'authority_revoked')
})

test('locks serialize targets and quarantine ambiguous state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hairness-home-'))
  const target = join(home, 'target')
  await mkdir(target)
  process.env.HAIRNESS_HOME = join(home, 'state')
  await acquireLocks([target], 'run-1')
  await assert.rejects(acquireLocks([target], 'run-2'), (error) => error.code === 'target_locked')
  await quarantineLocks([target], 'run-1', 'worker crashed')
  await assert.rejects(releaseLocks([target], 'run-1'), (error) => error.code === 'target_quarantined')
  assert.equal((await listLocks())[0].state, 'unknown')
  await resolveLock(target)
  assert.deepEqual(await listLocks(), [])
})
