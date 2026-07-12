import test from 'node:test'
import assert from 'node:assert/strict'
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
