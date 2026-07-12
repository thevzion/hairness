import test from 'node:test'
import assert from 'node:assert/strict'
import { command as testCommand } from '../extensions/hairness/maintainer/testing/runner.mjs'
import { validateJsonSchema } from '../src/core/contracts.mjs'

const repositoryRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const runtime = {
  contracts: { validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../extensions/hairness/maintainer/${schema.slice(2)}`, import.meta.url), value, label) },
  overlay: { write: async (_path, value) => value },
}

for (const suite of ['provider-discussion-recap', 'provider-codebase-map', 'provider-plan-effect-gate']) {
  test(`${suite} follows the provider invocation contract`, async () => {
    const result = await testCommand({ repositoryRoot, runtime, action: 'run', rest: [suite], flags: {} })
    assert.equal(result.status, 'succeeded', result.limits.join('; '))
    assert.ok(result.measurements.every((measurement) => measurement.exitCode === 0))
    assert.ok(result.checks.every((check) => check.ok))
  })
}
