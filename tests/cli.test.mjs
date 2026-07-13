import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/cli.mjs'
import { aggregateAuthorityPolicy } from '../src/distribution/registry.mjs'
import { createRun, proposeCheckpoint, readRun, transitionRun } from '../src/core/index.mjs'
import { assignment, temporaryWorkspace } from './helpers.mjs'

function stream() {
  let value = ''
  return {
    write(chunk) { value += chunk },
    read() { return value },
  }
}

test('CLI reserves a bare --version for the top-level command only', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  const versionOut = stream(); const versionErr = stream()
  assert.equal(await runCli(['--version'], { stdout: versionOut, stderr: versionErr }), 0)
  assert.match(versionOut.read(), /^hairness 0\.2\.0-alpha\.0\nprotocol 0\.2\n$/)
  assert.equal(versionErr.read(), '')

  const nestedOut = stream(); const nestedErr = stream()
  assert.equal(await runCli(['onboarding', 'status', '--version', '0.2.0-alpha.0', '--json'], { stdout: nestedOut, stderr: nestedErr }), 0)
  const nested = JSON.parse(nestedOut.read())
  assert.equal(nested.ok, true)
  assert.equal(nested.data.state, 'new')
  assert.equal(nestedErr.read(), '')
})

test('CLI returns a versioned JSON envelope', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  const stdout = stream()
  const stderr = stream()
  assert.equal(await runCli(['onboarding', 'status', '--json'], { stdout, stderr }), 0)
  const output = JSON.parse(stdout.read())
  assert.equal(output.protocolVersion, '0.2')
  assert.equal(output.ok, true)
  assert.equal(output.data.state, 'new')
  assert.equal(stderr.read(), '')
})

test('CLI reports structured usage errors', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  const stdout = stream()
  const stderr = stream()
  assert.equal(await runCli(['unknown', '--json'], { stdout, stderr }), 2)
  assert.equal(JSON.parse(stderr.read()).error.code, 'unknown_command')
})

test('CLI starts a direct auto invocation through the canonical route', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  process.env.HAIRNESS_HOME = join(root, 'home')
  const draft = join(root, 'draft.json')
  await writeFile(draft, JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', summary: 'Produce fixture data.', inputs: { topic: 'billing' }, controls: {} }))
  const stdout = stream()
  const stderr = stream()
  assert.equal(await runCli(['invoke', 'start', '--operation', 'fixture/artifacts:produce', '--draft-json', draft, '--direct', '--auto', '--json'], { stdout, stderr }), 0)
  const output = JSON.parse(stdout.read())
  assert.equal(output.data.state, 'needs-agent')
  assert.equal(output.data.next.action, 'dispatch-agent')
  assert.equal(stderr.read(), '')
})

test('CLI approves only the stored checkpoint and returns a granted executor capsule', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  process.env.HAIRNESS_HOME = join(root, 'home')
  const runId = 'approve-executor'
  await createRun(root, { id: runId, planId: 'approve-plan', assignment: assignment({ id: 'approve-assignment', operation: { capability: 'fixture/artifacts', id: 'mutate' }, profile: 'executor', targets: [root], requestedEffects: ['filesystem:write'], result: { schema: 'ChangeReceipt', disposition: 'effect' } }) })
  await transitionRun(root, runId, 'ready')
  await transitionRun(root, runId, 'needs-authority')
  const checkpoint = await proposeCheckpoint(root, { schemaVersion: 2, protocolVersion: '0.2', id: 'approve-checkpoint', runId, mode: 'mutation', intent: 'Mutate the fixture.', targets: [root], effects: ['filesystem:write'], exclusions: [], risk: 'Workspace mutation.', proof: ['diff:fixture'], approved: false }, (effects) => aggregateAuthorityPolicy(root, effects, { runId }))
  const stdout = stream(); const stderr = stream()
  assert.equal(await runCli(['run', runId, 'approve', '--checkpoint', checkpoint.id, '--json'], { stdout, stderr }), 0)
  const output = JSON.parse(stdout.read())
  assert.equal(output.data.status, 'ready')
  assert.deepEqual(output.data.capsule.allowedEffects, ['filesystem:write'])
  assert.equal((await readRun(root, runId)).state, 'ready')
  assert.equal(stderr.read(), '')
})
