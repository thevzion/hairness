import test from 'node:test'
import assert from 'node:assert/strict'
import { reducePlan, validateContextPlan } from '../src/core/fan-in.mjs'
import { intent, runResult } from './helpers.mjs'

function plan(routes) {
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'plan-1',
    intent: intent(),
    routes,
    fanIn: { id: 'reduce-1', mode: 'mechanical' },
  }
}

const required = {
  schemaVersion: 2,
  protocolVersion: '0.2',
  id: 'route-required',
  operation: { capability: 'fixture/work', id: 'produce' },
  kind: 'worker',
  profile: 'producer',
  requirement: 'required',
  resultSchema: 'ticket-map',
  fanIn: 'reduce-1',
}

test('every route must return to the declared fan-in', async () => {
  await assert.rejects(
    validateContextPlan(plan([{ ...required, fanIn: 'somewhere-else' }])),
    (error) => error.code === 'fan_in_missing',
  )
})

test('required route failure blocks the compact context packet', async () => {
  const packet = await reducePlan(plan([required]), [runResult(required.id, { status: 'failed', summary: 'Could not map.' })])
  assert.equal(packet.status, 'blocked')
  assert.ok(packet.byteSize <= 8192)
})

test('optional route failure is returned as an explicit limit', async () => {
  const optional = { ...required, id: 'route-optional', requirement: 'optional' }
  const packet = await reducePlan(plan([optional]), [runResult(optional.id, { status: 'failed' })])
  assert.equal(packet.status, 'succeeded')
  assert.ok(packet.limits.some((limit) => limit.includes('optional route failed')))
})
