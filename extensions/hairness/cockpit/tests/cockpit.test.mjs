import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionSignals, handleCommand } from '../index.mjs'
import { validateContract } from '../../../../src/core/contracts.mjs'

test('cockpit renders collected attention without owning its producers', async () => {
  const runtime = { contracts: { validate: validateContract }, invocations: { list: async () => [] }, runs: { list: async () => [] }, distribution: { read: async () => ({ displayName: 'Fixture' }) }, extensions: { list: async () => [{ commandSurfaces: [{ id: 'fixture.command', name: 'fixture', summary: 'Fixture.', owner: 'fixture/ext', route: 'hairness fixture', surface: 'specialized' }] }], collect: async () => [{ state: 'blocked', priority: 90, summary: 'Fixture blocked.', route: 'hairness fixture' }] } }
  const wake = await handleCommand({ namespace: 'wake-up', runtime })
  assert.equal(wake.status, 'blocked')
  assert.equal(wake.results[0].next, 'hairness fixture')
  assert.match((await handleCommand({ namespace: 'help', runtime })).summary, /1 command surface/)
})

test('cockpit surfaces incompatible local runs without interpreting legacy payloads', async () => {
  const runtime = { invocations: { list: async () => [] }, runs: { list: async () => [{ id: 'legacy', state: 'unknown', incompatible: true, limits: ['run-protocol-incompatible'] }] } }
  const signals = await attentionSignals({ root: '/nonexistent', runtime })
  assert.equal(signals[0].priority, 100)
  assert.equal(signals[1].route, 'hairness maintain metrics')
  assert.match(signals[1].summary, /1 incompatible legacy Run/)
})

test('topics are deduplicated, deterministically ranked and capped at twenty', async () => {
  const items = Array.from({ length: 24 }, (_, index) => ({ id: `topic-${index}`, kind: 'extension', state: index === 21 ? 'blocked' : 'ready', priority: index === 21 ? 100 : index, summary: `Topic ${index}`, route: `hairness topic ${index}`, lastActivityAt: `2026-07-12T10:${String(index).padStart(2, '0')}:00.000Z`, limits: [] }))
  items.push({ ...items[5], priority: 99, summary: 'Topic 5 newer priority' })
  const runtime = { contracts: { validate: validateContract }, extensions: { collect: async () => items } }
  const topics = await handleCommand({ namespace: 'topics', runtime })
  assert.equal(topics.results[0].attention.length, 20)
  assert.equal(topics.results[0].attention[0].id, 'topic-21')
  assert.equal(topics.results[0].attention.filter((item) => item.id === 'topic-5').length, 1)
  assert.equal(topics.results[0].attention.find((item) => item.id === 'topic-5').priority, 99)
})
