import test from 'node:test'
import assert from 'node:assert/strict'
import { validateContract, validateSchemaSet } from '../src/core/contracts.mjs'
import { intent } from './helpers.mjs'

test('schema set compiles in strict draft 2020-12 mode', async () => {
  assert.equal(await validateSchemaSet(), true)
})

test('contract validation accepts a versioned intent', async () => {
  assert.deepEqual(await validateContract('Intent', intent()), intent())
})

test('contract validation rejects unexpected fields', async () => {
  await assert.rejects(
    validateContract('Intent', { ...intent(), surprise: true }),
    (error) => error.code === 'contract_invalid' && error.details.length > 0,
  )
})

test('change receipts may bind proof to an exact repository head', async () => {
  const receipt = { schemaVersion: 2, protocolVersion: '0.2', runId: 'delivery-run', status: 'succeeded', summary: 'Published the pull request.', targets: ['github://example/widget/pulls/fix/release'], files: [], effects: ['github:pull-request'], tests: [], proof: ['pr:42'], head: 'abc1234', limits: [], routes: [] }
  assert.equal((await validateContract('ChangeReceipt', receipt)).head, 'abc1234')
})

test('checkout receipts bind a worktree effect to its exact authority boundary', async () => {
  const receipt = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'checkout-receipt-open-1',
    proposalId: 'checkout-proposal-open-1',
    action: 'open',
    runId: 'run-open-worktree',
    checkpointId: 'checkpoint-open-worktree',
    status: 'succeeded',
    summary: 'Managed worktree opened.',
    targets: ['git-worktree://local/repository/worktree-1'],
    effects: ['git:worktree'],
    proof: ['git:head:abc1234'],
    head: 'abc1234',
    policyDigest: 'sha256:policy',
    observedAt: '2026-07-14T10:00:00.000Z',
    limits: [],
    context: { handleRef: { id: 'worktree-1', digest: 'sha256:handle' } },
  }
  assert.equal((await validateContract('CheckoutReceipt', receipt)).action, 'open')
})

test('host capability reports the honest provider intent path', async () => {
  const value = await validateContract('HostCapabilities', { schemaVersion: 2, protocolVersion: '0.2', host: 'codex', level: 'guarded', intentPath: 'agent-first-call', capabilities: { sessionStart: true }, limits: ['no native command hook'] })
  assert.equal(value.intentPath, 'agent-first-call')
})

test('capability operations enforce class, route and result semantics', async () => {
  const capability = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'fixture/proof',
    owner: 'fixture/proof',
    version: '0.2.0-alpha.0',
    summary: 'Fixture proof capability.',
    operations: [{ id: 'inspect', class: 'observe', summary: 'Inspect fixture proof.', results: [{ id: 'default', contract: { schema: 'ContextPacket', disposition: 'response' } }], defaultResult: 'default', sources: [], effects: [], routes: ['deterministic', 'worker'], acceptsModifiers: [] }],
  }
  assert.deepEqual(await validateContract('CapabilitySpec', capability), capability)
  await assert.rejects(validateContract('CapabilitySpec', { ...capability, operations: [{ ...capability.operations[0], class: 'effect', effects: [] }] }), (error) => error.code === 'contract_invalid')
  await assert.rejects(validateContract('RouteSpec', { schemaVersion: 2, protocolVersion: '0.2', id: 'route-1', operation: { capability: 'fixture/proof', id: 'inspect' }, kind: 'worker', requirement: 'required', resultSchema: 'ContextPacket', fanIn: 'fan-in-1' }), (error) => error.code === 'contract_invalid')
  await assert.rejects(validateContract('RouteSpec', { schemaVersion: 2, protocolVersion: '0.2', id: 'route-1', operation: { capability: 'fixture/proof', id: 'inspect' }, kind: 'inline', profile: 'producer', requirement: 'required', resultSchema: 'ContextPacket', fanIn: 'fan-in-1' }), (error) => error.code === 'contract_invalid')
})
