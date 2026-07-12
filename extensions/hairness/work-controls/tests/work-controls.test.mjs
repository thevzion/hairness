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

test('save-recap creates one bounded producer for its declared operation', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const result = await handleCommand({ target: 'save-recap', rest: [], flags: {}, runtime: rt })
  assert.equal(result.status, 'ready')
  assert.deepEqual(rt.planRecords[0].routes[0].operation, { capability: 'hairness/work', id: 'recap' })
  assert.equal(rt.runsCreated[0].assignment.inputs.at(-1).artifactContract.owner, 'hairness/work-controls')
})

test('show-work and show-method return compact response dashboards', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const work = await handleCommand({ target: 'show-work', rest: [], flags: {}, runtime: rt })
  assert.equal(work.status, 'succeeded')
  assert.equal(work.results[0].view, 'work')
  assert.equal(work.results[0].activeWork.id, 'providers')
  const method = await handleCommand({ target: 'show-method', rest: [], flags: {}, runtime: rt })
  assert.equal(method.results[0].view, 'method')
  assert.deepEqual(method.results[0].methodShape, ['mission', 'work segment', 'frame', 'recap', 'work-plan', 'checkpoint'])
})

test('plan-system-shape carries reshape-system target controls', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const result = await handleCommand({ target: 'plan-system-shape', rest: [], flags: { scope: 'provider,work', 'old-owner': 'legacy', 'target-owner': 'work-controls', compatibility: 'codex,claude', proof: 'tests', checkpoint: 'cp-1' }, runtime: rt })
  const plan = result.results[0]
  assert.equal(plan.targetShape.oldOwner, 'legacy')
  assert.equal(plan.targetShape.targetOwner, 'work-controls')
  assert.deepEqual(plan.targetShape.compatibility, ['codex', 'claude'])
  assert.deepEqual(plan.targetShape.proof, ['tests'])
  assert.deepEqual(plan.checkpoints, ['cp-1'])
})

test('save-plan prepares an enriched work-plan artifact payload', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const result = await handleCommand({ target: 'save-plan', rest: [], flags: { planKind: 'system-shape', scope: 'provider', validation: 'npm-test' }, runtime: rt })
  assert.equal(result.status, 'ready')
  const payload = rt.runsCreated[0].assignment.inputs.at(-1).artifactContract.requiredPayload
  await validateJsonSchema(new URL('../schemas/work-plan.schema.json', import.meta.url), payload, 'work-plan')
  assert.equal(payload.executionBoundary, 'segment:providers')
  assert.deepEqual(payload.scope, ['provider'])
  assert.deepEqual(payload.validation, ['npm-test'])
  assert.ok(payload.targetShape)
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
