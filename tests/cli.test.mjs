import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/cli.mjs'
import { temporaryWorkspace } from './helpers.mjs'

function stream() {
  let value = ''
  return {
    write(chunk) { value += chunk },
    read() { return value },
  }
}

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
