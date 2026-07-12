import assert from 'node:assert/strict'
import { validateContract, validateSchemaSet } from '../src/core/contracts.mjs'
import { reducePlan, validateContextPlan } from '../src/core/fan-in.mjs'

await validateSchemaSet()

const intent = {
  schemaVersion: 2,
  protocolVersion: '0.2',
  id: 'conformance-intent',
  summary: 'Prove protocol fan-in.',
  outcome: 'A bounded ContextPacket.',
  targets: [],
  limits: [],
}
const route = {
  schemaVersion: 2,
  protocolVersion: '0.2',
  id: 'conformance-route',
  kind: 'deterministic',
  requirement: 'required',
  resultSchema: 'RunResult',
  fanIn: 'conformance-fan-in',
}
const plan = {
  schemaVersion: 2,
  protocolVersion: '0.2',
  id: 'conformance-plan',
  intent,
  routes: [route],
  fanIn: { id: 'conformance-fan-in', mode: 'mechanical' },
}
const result = {
  schemaVersion: 2,
  protocolVersion: '0.2',
  runId: route.id,
  status: 'succeeded',
  summary: 'Conformance route completed.',
  outcome: {},
  proof: ['schema:validated'],
  limits: [],
  routes: [],
}

await validateContextPlan(plan)
await validateContract('RunResult', result)
const packet = await reducePlan(plan, [result])
assert.equal(packet.status, 'succeeded')
assert.ok(packet.byteSize <= 8192)
console.log(`protocol 0.2 conformance passed (${packet.byteSize} byte ContextPacket)`)
