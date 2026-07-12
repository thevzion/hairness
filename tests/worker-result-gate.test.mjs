import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { runCli } from '../src/cli.mjs'
import { createRun, readArtifact, readRun, transitionRun } from '../src/core/index.mjs'
import { artifactMetadata, assignment, temporaryWorkspace } from './helpers.mjs'

function stream() {
  let value = ''
  return { write(chunk) { value += chunk }, read() { return value } }
}

test('invalid producer result is rejected before promotion and can be corrected', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  const runId = 'worker-result-gate'
  await createRun(root, { id: runId, planId: 'gate-plan', assignment: assignment({ id: 'gate-producer' }) })
  await transitionRun(root, runId, 'ready')
  await transitionRun(root, runId, 'running')
  const artifact = { schemaVersion: 2, protocolVersion: '0.2', id: 'gate/result', type: 'gate-result', owner: 'fixture/artifacts', metadata: artifactMetadata(), revision: 'revision-1', runId, summary: 'Validated gate result.', payload: { value: 'valid' }, createdAt: new Date(0).toISOString() }
  const result = { schemaVersion: 2, protocolVersion: '0.2', runId, status: 'succeeded', summary: 'Producer completed.', outcome: { artifact }, proof: ['fixture'], limits: [], routes: [] }
  const invalid = join(root, 'invalid.json')
  await writeFile(invalid, JSON.stringify({ ...result, unexpected: true }))
  let stdout = stream()
  let stderr = stream()
  assert.equal(await runCli(['worker', runId, 'submit', '--file', invalid, '--json'], { stdout, stderr }), 2)
  assert.equal(JSON.parse(stderr.read()).error.code, 'contract_invalid')
  await assert.rejects(readArtifact(root, 'gate/result'), (error) => error.code === 'artifact_not_found')
  assert.equal((await readRun(root, runId)).state, 'running')

  const invalidPayload = join(root, 'invalid-payload.json')
  await writeFile(invalidPayload, JSON.stringify({ ...result, outcome: { artifact: { ...artifact, payload: {} } } }))
  stdout = stream()
  stderr = stream()
  assert.equal(await runCli(['worker', runId, 'submit', '--file', invalidPayload, '--json'], { stdout, stderr }), 2)
  assert.equal(JSON.parse(stderr.read()).error.code, 'artifact_payload_invalid')
  assert.equal((await readRun(root, runId)).state, 'running')

  const corrected = join(root, 'corrected.json')
  await writeFile(corrected, JSON.stringify(result))
  stdout = stream()
  stderr = stream()
  assert.equal(await runCli(['worker', runId, 'submit', '--file', corrected, '--json'], { stdout, stderr }), 0, stderr.read())
  assert.equal((await readArtifact(root, 'gate/result')).revision, 'revision-1')
  assert.equal((await readRun(root, runId)).state, 'succeeded')
})
