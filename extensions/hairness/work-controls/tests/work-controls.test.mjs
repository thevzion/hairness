import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand, invocationControls } from '../index.mjs'
import { validateJsonSchema } from '../../../../src/core/contracts.mjs'

function runtime() {
  const values = new Map()
  const events = []
  const planRecords = []
  const runs = []
  const invocationRecords = []
  const invocationResults = new Map()
  const promotedArtifacts = []
  return {
    overlay: { read: async (key, fallback) => values.has(key) ? values.get(key) : fallback, write: async (key, value) => (values.set(key, value), value), append: async (_key, value) => events.push(value), lines: async () => events },
    contracts: { validate: async (_name, value) => value, validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../${schema.slice(2)}`, import.meta.url), value, label) },
    artifacts: { read: async () => null, stage: async (_runId, value) => (promotedArtifacts.push(value), value), promote: async () => null },
    invocations: { list: async () => invocationRecords, result: async (id) => invocationResults.get(id) },
    plans: { write: async (value) => (planRecords.push(value), value) },
    runs: { create: async (value) => (runs.push(value), value), list: async () => runs, transition: async () => null, capsule: async (id) => ({ runId: id }) },
    planRecords,
    runsCreated: runs,
    invocationRecords,
    invocationResults,
    promotedArtifacts,
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

test('save-recap promotes the latest compatible make-recap result without resynthesis', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const made = await handleCommand({ target: 'make-recap', rest: [], flags: {}, runtime: rt })
  rt.invocationRecords.push({ id: 'inv-recap', legacy: false, state: 'completed', updatedAt: '2026-07-12T10:00:00.000Z', request: { operation: { capability: 'hairness/work', id: 'recap' }, expectedResult: { contract: { disposition: 'response' } }, work: { segmentId: 'providers' }, origin: { host: 'codex' } } })
  rt.invocationResults.set('inv-recap', { summary: made.summary, payload: made })
  const result = await handleCommand({ target: 'save-recap', rest: [], flags: {}, runtime: rt })
  assert.equal(result.revision, 'inv-recap')
  assert.deepEqual(result.payload, made.results[0])
  assert.equal(rt.runsCreated.length, 0)
  assert.equal(rt.promotedArtifacts.length, 1)
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

test('show-trace links the active invocation to child Runs and work trace defaults to the active segment', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  rt.invocationRecords.push({ id: 'inv-root', legacy: false, state: 'needs-agent', updatedAt: '2026-07-12T10:00:00.000Z', request: { summary: 'Map providers.', work: { segmentId: 'providers' } } })
  rt.runsCreated.push({ id: 'run-child', parentInvocationId: 'inv-root', routeId: 'map', state: 'running' })
  const trace = await handleCommand({ target: 'show-trace', rest: [], flags: {}, runtime: rt })
  assert.equal(trace.results[0].trace[0].runs[0].id, 'run-child')
  const raw = await handleCommand({ target: 'trace', rest: [], flags: {}, runtime: rt })
  assert.equal(raw.segment.id, 'providers')
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

test('save-plan promotes the exact typed make-plan payload', async () => {
  const rt = runtime()
  await handleCommand({ target: 'mission', action: 'set', rest: [], flags: { id: 'hairness', summary: 'Build Hairness.' }, runtime: rt })
  await handleCommand({ target: 'segment', action: 'open', rest: [], flags: { id: 'providers', summary: 'Build providers.' }, runtime: rt })
  const made = await handleCommand({ target: 'make-plan', rest: [], flags: { planKind: 'system-shape', scope: 'provider', validation: 'npm-test' }, runtime: rt })
  rt.invocationRecords.push({ id: 'inv-plan', legacy: false, state: 'completed', updatedAt: '2026-07-12T10:00:00.000Z', request: { operation: { capability: 'hairness/work', id: 'plan' }, expectedResult: { contract: { disposition: 'response' } }, work: { segmentId: 'providers' }, origin: { host: 'claude' } } })
  rt.invocationResults.set('inv-plan', { summary: made.summary, payload: made })
  const result = await handleCommand({ target: 'save-plan', rest: [], flags: {}, runtime: rt })
  await validateJsonSchema(new URL('../schemas/work-plan.schema.json', import.meta.url), result.payload, 'work-plan')
  assert.deepEqual(result.payload, made.results[0])
  assert.equal(result.revision, 'inv-plan')
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
