import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  artifactHistory,
  artifactGraph,
  buildWorkerCapsule,
  createRun,
  promoteArtifact,
  readArtifact,
  listArtifacts,
  readRun,
  stageArtifact,
  submitRunResult,
  transitionRun,
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
  assert.equal(events.trim().split('\n').length, 4)
})

test('invalid run transitions are rejected', async () => {
  const root = await temporaryWorkspace()
  await createRun(root, { id: 'run-2', planId: 'plan-1', assignment: assignment() })
  await assert.rejects(transitionRun(root, 'run-2', 'succeeded'), (error) => error.code === 'invalid_transition')
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
