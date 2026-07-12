import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answerInvocation, cancelInvocation, resumeInvocation, showInvocation, startInvocation } from '../src/distribution/invocation.mjs'
import { temporaryWorkspace } from './helpers.mjs'

function draft(operation = 'produce', inputs = {}) {
  return { schemaVersion: 2, protocolVersion: '0.2', operation: { capability: 'fixture/artifacts', id: operation }, summary: `${operation} fixture data.`, inputs, controls: {} }
}

test('intent and direct modes resolve to the same operation contract', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const intent = await startInvocation(root, draft('produce', { topic: 'billing' }), { mode: 'intent' })
  const direct = await startInvocation(root, draft('produce', { topic: 'billing' }), { mode: 'direct' })
  const left = (await showInvocation(root, intent.id)).invocation.request
  const right = (await showInvocation(root, direct.id)).invocation.request
  assert.deepEqual(left.operation, right.operation)
  assert.deepEqual(left.inputs, right.inputs)
  assert.deepEqual(left.controls, right.controls)
  assert.deepEqual(left.expectedResult, right.expectedResult)
  assert.equal(left.route, right.route)
  assert.equal(left.mode, 'intent')
  assert.equal(right.mode, 'direct')
})

test('invocation returns one deterministic gap and resumes without transcript state', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const pending = await startInvocation(root, draft(), { mode: 'intent' })
  assert.equal(pending.state, 'needs-input')
  assert.deepEqual(pending.gaps.map((gap) => gap.field), ['topic'])
  const resolved = await answerInvocation(root, pending.id, { topic: 'runtime' })
  assert.equal(resolved.state, 'resolved')
  const automatic = await resumeInvocation(root, pending.id, { auto: true })
  assert.equal(automatic.state, 'needs-agent')
  assert.equal(automatic.next.action, 'dispatch-agent')
  const events = await readFile(join(root, '.overlay/invocations', pending.id, 'events.jsonl'), 'utf8')
  assert.doesNotMatch(events, /transcript|reasoning|conversation/i)
})

test('invocation state is rebuilt from its append-only event stream', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const preview = await startInvocation(root, draft('produce', { topic: 'billing' }), { mode: 'direct' })
  const before = (await showInvocation(root, preview.id)).invocation
  await rm(join(root, '.overlay/invocations', preview.id, 'state.json'))
  const after = (await showInvocation(root, preview.id)).invocation
  assert.deepEqual(after.draft, before.draft)
  assert.deepEqual(after.request, before.request)
  assert.deepEqual(after.preview, before.preview)
  assert.equal(after.state, before.state)
})

test('named result controls persistence and --auto only advances progress', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const response = await startInvocation(root, { ...draft('produce', { topic: 'billing' }), result: 'response' }, { mode: 'direct', auto: true })
  assert.equal(response.expectedResult.id, 'response')
  assert.equal(response.expectedResult.persistence, 'none')
  assert.equal(response.state, 'needs-agent')
  const artifact = await startInvocation(root, { ...draft('produce', { topic: 'billing' }), result: 'artifact' }, { mode: 'direct', auto: true })
  assert.equal(artifact.expectedResult.id, 'artifact')
  assert.equal(artifact.expectedResult.persistence, 'local')
  assert.equal(artifact.state, 'needs-agent')
})

test('--auto never bypasses effect authority and cancellation is terminal', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const preview = await startInvocation(root, draft('mutate'), { mode: 'direct', auto: true })
  assert.equal(preview.state, 'needs-authority')
  assert.equal(preview.next.action, 'checkpoint')
  const receipt = await cancelInvocation(root, preview.id)
  assert.equal(receipt.status, 'cancelled')
  await assert.rejects(resumeInvocation(root, preview.id, { auto: true }), (error) => error.code === 'invocation_terminal')
})

test('extension-owned scoped controls resolve before explicit operation controls', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const extension = join(root, 'extensions/fixture/artifacts')
  const manifest = JSON.parse(await readFile(join(extension, 'extension.json'), 'utf8'))
  manifest.contributes = ['invocation-controls']
  await writeFile(join(extension, 'extension.json'), JSON.stringify(manifest))
  await writeFile(join(extension, 'index.mjs'), "export async function invocationControls({ manifest }) { return [{ owner: manifest.id, scope: 'session', priority: 50, values: { mode: 'inline', present: 'compact' }, proof: [], limits: [] }] }\n")
  await mkdir(join(root, 'home'), { recursive: true })
  await writeFile(join(root, 'home/trust.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', workspaces: { [root]: { trusted: true } }, extensions: {} }))
  const preview = await startInvocation(root, { ...draft('produce', { topic: 'billing' }), controls: { present: 'visual' } })
  assert.deepEqual(preview.resolved.controls, { mode: 'inline', present: 'visual' })
  assert.deepEqual(preview.resolved.resolverOwners, ['fixture/artifacts'])
})
