import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  artifactHistory,
  artifactGraph,
  acceptInvocationResult,
  buildWorkerCapsule,
  createRun,
  createSyntheticInvocation,
  promoteArtifact,
  readArtifact,
  listArtifacts,
  readRun,
  stageArtifact,
  submitRunResult,
  transitionRun,
  writePlan,
  reduceStoredPlan,
} from '../src/core/index.mjs'
import { artifactMetadata, assignment, runResult, temporaryWorkspace } from './helpers.mjs'

test('run transitions persist task, events, result, and a bounded capsule', async () => {
  const root = await temporaryWorkspace()
  await createRun(root, { id: 'run-1', planId: 'plan-1', assignment: assignment() })
  await transitionRun(root, 'run-1', 'ready')
  const capsule = await buildWorkerCapsule(root, 'run-1')
  assert.equal(capsule.profile, 'producer')
  assert.deepEqual(capsule.allowedEffects, [])
  await transitionRun(root, 'run-1', 'running')
  await submitRunResult(root, runResult('run-1'))
  assert.equal((await readRun(root, 'run-1')).state, 'succeeded')
  const events = await readFile(join(root, '.overlay/runs/run-1/events.jsonl'), 'utf8')
  assert.equal(events.trim().split('\n').length, 7)
  const run = await readRun(root, 'run-1')
  assert.equal(run.parentInvocationId, 'inv-run-run-1')
  const invocationResult = JSON.parse(await readFile(join(root, '.overlay/invocations', run.parentInvocationId, 'result.json'), 'utf8'))
  assert.equal(invocationResult.payload.runId, 'run-1')
})

test('invalid run transitions are rejected', async () => {
  const root = await temporaryWorkspace()
  await createRun(root, { id: 'run-2', planId: 'plan-1', assignment: assignment() })
  await assert.rejects(transitionRun(root, 'run-2', 'succeeded'), (error) => error.code === 'invalid_transition')
})

test('one ContextPlan roots child Runs and completes its Invocation at fan-in', async () => {
  const root = await temporaryWorkspace()
  const routes = ['route-a', 'route-b'].map((id) => ({ schemaVersion: 2, protocolVersion: '0.2', id, operation: { capability: 'fixture/artifacts', id: 'produce' }, kind: 'worker', profile: 'producer', requirement: 'required', resultSchema: 'RunResult', fanIn: 'fan-in' }))
  const plan = await writePlan(root, { schemaVersion: 2, protocolVersion: '0.2', id: 'shared-plan', intent: { schemaVersion: 2, protocolVersion: '0.2', id: 'shared-intent', summary: 'Run two bounded routes.', outcome: 'One reduced result.', targets: [], limits: [] }, routes, fanIn: { id: 'fan-in', mode: 'mechanical' } })
  for (const route of routes) {
    const run = await createRun(root, { id: route.id, planId: plan.id, assignment: assignment({ id: route.id }) })
    assert.equal(run.parentInvocationId, plan.parentInvocationId)
    await transitionRun(root, route.id, 'ready')
    await transitionRun(root, route.id, 'running')
    await submitRunResult(root, runResult(route.id))
  }
  const packet = await reduceStoredPlan(root, plan.id)
  assert.equal(packet.status, 'succeeded')
  const invocationResult = JSON.parse(await readFile(join(root, '.overlay/invocations', plan.parentInvocationId, 'result.json'), 'utf8'))
  assert.equal(invocationResult.payload.planId, plan.id)
  assert.equal(invocationResult.payload.results.length, 2)
})

test('the semantic ledger rejects transcript and reasoning payloads', async () => {
  const root = await temporaryWorkspace()
  const parent = await createSyntheticInvocation(root, 'sensitive-run', assignment())
  const payload = runResult('sensitive-run', { outcome: { transcript: 'provider text' } })
  await assert.rejects(acceptInvocationResult(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: parent, resultId: 'run', summary: 'Unsafe.', payload, proof: [], limits: [], routes: [] }, { schema: 'RunResult', disposition: 'response' }), (error) => error.code === 'semantic_payload_forbidden')
})

test('artifact promotion is atomic and revisioned', async () => {
  const root = await temporaryWorkspace()
  const envelope = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'ticket/plat-1',
    type: 'gate-result',
    owner: 'fixture/artifacts',
    metadata: artifactMetadata(),
    revision: 'r1',
    runId: 'run-1',
    summary: 'Ticket map.',
    payload: { key: 'PLAT-1' },
    createdAt: new Date(0).toISOString(),
  }
  await stageArtifact(root, 'run-1', envelope)
  const markdown = await readFile(join(root, '.overlay/artifacts/.staging/run-1/artifact.md'), 'utf8')
  assert.ok(markdown.indexOf('## Summary') < markdown.indexOf('## Payload JSON'))
  assert.match(markdown, /## Dashboard/)
  assert.match(markdown, /Ticket map\./)
  await promoteArtifact(root, 'run-1')
  assert.deepEqual(await readArtifact(root, envelope.id), envelope)
  assert.deepEqual(await artifactHistory(root, envelope.id), { id: envelope.id, current: 'r1', revisions: ['r1'] })
  await assert.rejects(promoteArtifact(root, 'run-1'), (error) => error.code === 'artifact_not_staged')
  const related = { ...envelope, id: 'ticket/plat-2', revision: 'r2', runId: 'run-2', metadata: artifactMetadata({ labels: ['ticket'], signals: ['plat-2'], relations: [{ type: 'related-to', target: { kind: 'artifact', id: envelope.id } }] }) }
  await stageArtifact(root, 'run-2', related)
  await promoteArtifact(root, 'run-2')
  assert.equal((await listArtifacts(root, { label: 'ticket' }))[0].id, related.id)
  assert.equal((await artifactGraph(root, envelope.id)).incoming[0].from.id, related.id)
})
