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
