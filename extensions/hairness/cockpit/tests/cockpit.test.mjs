import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionSignals, handleCommand } from '../index.mjs'

test('cockpit renders collected attention without owning its producers', async () => {
  const runtime = { distribution: { read: async () => ({ displayName: 'Fixture' }) }, extensions: { list: async () => [{ providerCommands: [{ name: 'fixture', summary: 'Fixture.', owner: 'fixture/ext', route: 'hairness fixture' }] }], collect: async () => [{ state: 'blocked', priority: 90, summary: 'Fixture blocked.', route: 'hairness fixture' }] } }
  const wake = await handleCommand({ namespace: 'wake-up', runtime })
  assert.equal(wake.status, 'blocked')
  assert.equal(wake.next, 'hairness fixture')
  assert.match((await handleCommand({ namespace: 'help', runtime })).summary, /1 provider command/)
})

test('cockpit surfaces incompatible local runs without interpreting legacy payloads', async () => {
  const runtime = { runs: { list: async () => [{ id: 'legacy', state: 'unknown', incompatible: true, limits: ['run-protocol-incompatible'] }] } }
  const signals = await attentionSignals({ root: '/nonexistent', runtime })
  assert.equal(signals[0].priority, 100)
  assert.equal(signals[1].route, 'hairness run legacy show')
})
