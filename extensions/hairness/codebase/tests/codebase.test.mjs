import test from 'node:test'
import assert from 'node:assert/strict'
import { access, lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleCommand as codebaseCommand, services } from '../index.mjs'
import { validateContract } from '../../../../src/core/contracts.mjs'

test('required codebase absence blocks while recommended absence stays partial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-codebase-'))
  const manifestPath = join(root, 'hairness.json')
  const base = { codebases: [] }
  const contract = (id, requirement) => ({
    schemaVersion: 2,
    protocolVersion: '0.2',
    id,
    displayName: id,
    requirement,
    repository: { provider: 'git', host: 'example.test', namespace: 'team', name: id, webUrl: `https://example.test/team/${id}`, acceptedRemotes: [`git@example.test:team/${id}.git`] },
    testCommands: [],
  })
  base.codebases = [contract('required-app', 'required'), contract('recommended-docs', 'recommended')]
  await writeFile(manifestPath, JSON.stringify(base))
  await mkdir(join(root, '.overlay'), { recursive: true })
  const runtime = { distribution: { read: async () => base }, extensions: { call: async () => { throw new Error('not mounted') } } }
  const required = await codebaseCommand({ root, target: 'required-app', action: 'doctor', rest: [], flags: {}, runtime })
  const recommended = await codebaseCommand({ root, target: 'recommended-docs', action: 'doctor', rest: [], flags: {}, runtime })
  assert.equal(required.status, 'blocked')
  assert.equal(recommended.status, 'partial')
})

test('local codebase contracts mount and unmount without touching the checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-local-codebase-'))
  const checkout = join(root, 'checkout')
  await mkdir(checkout)
  const distribution = { codebases: [] }
  const remote = 'git@example.test:team/private-repo.git'
  const runtime = {
    contracts: { validate: validateContract },
    distribution: { read: async () => distribution },
    extensions: { call: async (_owner, _service, request) => ({ data: request.operation === 'identity' ? { path: request.input.path, remote } : { path: request.input.path, branch: 'main', dirty: 0 } }) },
  }
  const flags = { local: 'private-repo', path: checkout, remote }
  const plan = await codebaseCommand({ root, target: 'add', action: undefined, rest: [], flags, runtime })
  const mounted = await codebaseCommand({ root, target: 'add', action: undefined, rest: [], flags: { ...flags, checkpoint: plan.checkpointId }, runtime })
  assert.equal(mounted.status, 'mounted')
  assert.equal((await lstat(join(root, '.overlay/codebases/private-repo/default'))).isSymbolicLink(), true)
  const secondCheckout = join(root, 'checkout-fix')
  await mkdir(secondCheckout)
  const secondPlan = await codebaseCommand({ root, target: 'mount', action: 'private-repo', rest: [secondCheckout], flags: { as: 'fix-123' }, runtime })
  await codebaseCommand({ root, target: 'mount', action: 'private-repo', rest: [secondCheckout], flags: { as: 'fix-123', checkpoint: secondPlan.checkpointId }, runtime })
  const named = await codebaseCommand({ root, target: 'private-repo', action: 'show', rest: [], flags: { checkout: 'fix-123' }, runtime })
  assert.equal(named.checkout, 'fix-123')
  assert.equal(named.baseline.realpath, await realpath(secondCheckout))
  const listed = await codebaseCommand({ root, target: 'list', action: undefined, rest: [], flags: {}, runtime })
  assert.equal(listed.codebases[0].scope, 'local')
  runtime.extensions.call = async (_owner, _service, request) => {
    if (request.operation === 'identity') throw new Error('origin missing')
    return { data: { path: request.input.path, branch: 'main', dirty: 0 } }
  }
  const pending = await codebaseCommand({ root, target: 'private-repo', action: 'doctor', rest: [], flags: {}, runtime })
  assert.equal(pending.status, 'partial')
  assert.ok(pending.limits.includes('remote-pending'))
  const unmountNamed = await codebaseCommand({ root, target: 'unmount', action: 'private-repo', rest: [], flags: { as: 'fix-123' }, runtime })
  await codebaseCommand({ root, target: 'unmount', action: 'private-repo', rest: [], flags: { as: 'fix-123', checkpoint: unmountNamed.checkpointId }, runtime })
  const removal = await codebaseCommand({ root, target: 'remove', action: undefined, rest: [], flags: { local: 'private-repo' }, runtime })
  await codebaseCommand({ root, target: 'remove', action: undefined, rest: [], flags: { local: 'private-repo', checkpoint: removal.checkpointId }, runtime })
  await assert.rejects(access(join(root, '.overlay/codebases/private-repo/default')))
  await access(checkout)
})

test('managed mounts require and preserve the exact calling Run grant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-managed-codebase-'))
  const checkout = join(root, 'external-checkout')
  await mkdir(checkout)
  const remote = 'git@example.test:team/external.git'
  const contract = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'external',
    displayName: 'External',
    requirement: 'optional',
    repository: { provider: 'git', host: 'example.test', namespace: 'team', name: 'external', webUrl: 'https://example.test/team/external', acceptedRemotes: [remote] },
    testCommands: [],
  }
  const assertions = []
  const runtime = {
    authority: { assert: async (...args) => { assertions.push(args); return { id: 'grant-managed' } } },
    distribution: { read: async () => ({ codebases: [contract] }) },
    extensions: { call: async (_owner, _service, request) => ({ data: request.operation === 'identity' ? { path: checkout, remote } : { path: checkout, branch: 'feat/test', head: 'abc123', dirty: 0 } }) },
  }
  const target = 'codebase://external/checkouts/wt-123'
  const input = { runId: 'run-managed', effect: 'filesystem:write', target, codebaseId: 'external', checkout: 'wt-123', path: checkout }
  const mounted = await services['mount-managed']({ root, input, runtime })
  assert.equal(mounted.grantId, 'grant-managed')
  assert.equal((await lstat(join(root, '.overlay/codebases/external/wt-123'))).isSymbolicLink(), true)
  assert.deepEqual(assertions, [['run-managed', 'filesystem:write', target]])
  const unmounted = await services['unmount-managed']({ root, input, runtime })
  assert.equal(unmounted.status, 'unmounted')
  await assert.rejects(access(join(root, '.overlay/codebases/external/wt-123')))
  await access(checkout)
  assert.deepEqual(assertions, [['run-managed', 'filesystem:write', target], ['run-managed', 'filesystem:write', target]])
})
