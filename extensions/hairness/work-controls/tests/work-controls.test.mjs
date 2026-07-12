import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'

function runtime() {
  const values = new Map()
  const events = []
  const planRecords = []
  const runs = []
  return {
    overlay: { read: async (key, fallback) => values.has(key) ? values.get(key) : fallback, write: async (key, value) => (values.set(key, value), value), append: async (_key, value) => events.push(value), lines: async () => events },
    contracts: { validate: async (_name, value) => value, validateSchema: async (_schema, value) => value },
    artifacts: { read: async () => null },
    plans: { write: async (value) => (planRecords.push(value), value) },
    runs: { create: async (value) => (runs.push(value), value), transition: async () => null, capsule: async (id) => ({ runId: id }) },
    planRecords,
    runsCreated: runs,
    events,
  }
}

test('work controls persist one mission, segment and frame', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  await handleCommand({ target: 'frame', action: 'open', rest: [], flags: { id: 'codex', summary: 'Codex projection.', posture: 'discuss' }, runtime: rt })
  const state = await handleCommand({ target: 'status', rest: [], flags: {}, runtime: rt })
  assert.equal(state.activeSegmentId, 'providers')
  assert.equal(state.frames[0].posture, 'discuss')
  assert.equal(rt.events.length, 3)
})

test('recap creates one bounded producer for its declared operation', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const result = await handleCommand({ target: 'recap', rest: [], flags: {}, runtime: rt })
  assert.equal(result.status, 'ready')
  assert.deepEqual(rt.planRecords[0].routes[0].operation, { capability: 'hairness/work', id: 'recap' })
  assert.equal(rt.runsCreated[0].assignment.inputs.at(-1).artifactContract.owner, 'hairness/work-controls')
})

test('closing a segment requires a typed digest', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const result = await handleCommand({ target: 'segment', action: 'close', rest: [], flags: {}, runtime: rt })
  assert.equal(result.status, 'needs-artifact')
})
