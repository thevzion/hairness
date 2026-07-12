import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand, invocationControls } from '../index.mjs'
import { validateJsonSchema } from '../../../../src/core/contracts.mjs'

function runtime() {
  const values = new Map()
  const events = []
  const planRecords = []
  const runs = []
  return {
    overlay: { read: async (key, fallback) => values.has(key) ? values.get(key) : fallback, write: async (key, value) => (values.set(key, value), value), append: async (_key, value) => events.push(value), lines: async () => events },
    contracts: { validate: async (_name, value) => value, validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../${schema.slice(2)}`, import.meta.url), value, label) },
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

test('closing a segment accepts the canonical string artifact revision', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  rt.artifacts.read = async () => ({ id: 'work/providers-recap', owner: 'hairness/work-controls', type: 'segment-digest', revision: 'r1', payload: { segmentId: 'providers' } })
  const result = await handleCommand({ target: 'segment', action: 'close', rest: [], flags: { digest: 'work/providers-recap' }, runtime: rt })
  assert.equal(result.activeSegmentId, null)
  assert.equal(result.segments[0].digestArtifact.revision, 'r1')
})

test('controls inherit from session to segment and frame without becoming constraints', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'control', action: 'set', rest: ['mode', 'inline'], flags: { scope: 'session' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  await handleCommand({ target: 'control', action: 'set', rest: ['budget', 'balanced'], flags: { scope: 'segment' }, runtime: rt })
  await handleCommand({ target: 'frame', action: 'open', rest: [], flags: { id: 'codex', summary: 'Codex.', posture: 'discuss' }, runtime: rt })
  await handleCommand({ target: 'control', action: 'set', rest: ['present', 'compact'], flags: { scope: 'frame' }, runtime: rt })
  const result = await handleCommand({ target: 'control', action: 'show', rest: [], flags: { scope: 'frame' }, runtime: rt })
  assert.deepEqual(result.effective, { mode: 'inline', budget: 'balanced', present: 'compact' })
  const contributions = await invocationControls({ runtime: rt, manifest: { id: 'hairness/work-controls' } })
  assert.deepEqual(contributions.map((item) => item.scope), ['session', 'segment', 'frame'])
})
