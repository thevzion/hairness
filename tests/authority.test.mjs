import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  acquireLocks,
  approveCheckpoint,
  assertEffectAllowed,
  createRun,
  grantCheckpoint,
  listLocks,
  quarantineLocks,
  proposeCheckpoint,
  readRun,
  releaseLocks,
  resolveLock,
  transitionRun,
} from '../src/core/index.mjs'
import { assignment, temporaryWorkspace } from './helpers.mjs'

test('effect grant is scoped to declared target and effect', async () => {
  const root = await temporaryWorkspace()
  await createRun(root, { id: 'run-exec', planId: 'plan-1', assignment: assignment({ operation: { capability: 'fixture/artifacts', id: 'mutate' }, profile: 'executor', targets: ['/target'], requestedEffects: ['filesystem:write'] }) })
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

test('stored checkpoints bind one URI target before approval', async () => {
  const root = await temporaryWorkspace()
  const home = await mkdtemp(join(tmpdir(), 'hairness-home-'))
  process.env.HAIRNESS_HOME = home
  const target = 'github://example/project/branches/feat-delivery'
  await createRun(root, { id: 'run-uri', planId: 'plan-uri', assignment: assignment({ operation: { capability: 'fixture/artifacts', id: 'mutate' }, profile: 'executor', targets: [target], requestedEffects: ['filesystem:write'] }) })
  await transitionRun(root, 'run-uri', 'ready')
  await transitionRun(root, 'run-uri', 'needs-authority')
  const proposal = await proposeCheckpoint(root, {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'checkpoint-uri',
    runId: 'run-uri',
    mode: 'external',
    intent: 'Update one exact remote branch.',
    targets: [target],
    effects: ['filesystem:write'],
    exclusions: ['merge'],
    risk: 'Remote mutation.',
    proof: ['diff:sha256:test'],
    approved: false,
  })
  assert.match(proposal.policyDigest, /^sha256:/)
  const grant = await approveCheckpoint(root, 'run-uri', proposal.id)
  assert.equal(grant.targets[0], target)
  assert.equal((await readRun(root, 'run-uri')).state, 'ready')
  assert.equal((await assertEffectAllowed(root, 'run-uri', 'filesystem:write', target)).id, 'grant-checkpoint-uri')
  await assert.rejects(acquireLocks([target], 'run-uri-competitor'), (error) => error.code === 'target_locked')
  await releaseLocks([target], 'run-uri')
  await assert.rejects(acquireLocks(['github://user:secret@example/project'], 'bad'), (error) => error.code === 'target_credentials_forbidden')
  await assert.rejects(acquireLocks(['github://example/project#token'], 'bad-fragment'), (error) => error.code === 'target_fragment_forbidden')
})

test('approval rejects a checkpoint when authority policy changed', async () => {
  const root = await temporaryWorkspace()
  const home = await mkdtemp(join(tmpdir(), 'hairness-home-'))
  process.env.HAIRNESS_HOME = home
  const target = 'npm://registry.npmjs.org/%40example%2Fcli/1.0.0'
  await createRun(root, { id: 'run-stale-policy', planId: 'plan-stale', assignment: assignment({ operation: { capability: 'fixture/artifacts', id: 'mutate' }, profile: 'executor', targets: [target], requestedEffects: ['filesystem:write'] }) })
  await transitionRun(root, 'run-stale-policy', 'ready')
  await transitionRun(root, 'run-stale-policy', 'needs-authority')
  let revision = 'one'
  const policy = async (effects) => ({ owner: 'test/policy', requestedEffects: effects, allowedEffects: effects, deniedEffects: [], reasons: [], digest: `sha256:${revision}`, observedAt: new Date().toISOString() })
  const proposal = await proposeCheckpoint(root, { schemaVersion: 2, protocolVersion: '0.2', id: 'checkpoint-stale', runId: 'run-stale-policy', mode: 'external', intent: 'Publish exact version.', targets: [target], effects: ['filesystem:write'], exclusions: [], risk: 'Registry mutation.', proof: ['candidate:one'], approved: false }, policy)
  revision = 'two'
  await assert.rejects(approveCheckpoint(root, 'run-stale-policy', proposal.id, policy), (error) => error.code === 'checkpoint_stale')
  assert.deepEqual(await listLocks(), [])
})
