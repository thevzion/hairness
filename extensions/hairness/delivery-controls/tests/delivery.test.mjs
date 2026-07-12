import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'
import { validateJsonSchema } from '../../../../src/core/contracts.mjs'

function runtime() {
  const values = new Map(); const plans = []; const runs = []
  return {
    contracts: { validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../${schema.slice(2)}`, import.meta.url), value, label) },
    overlay: { read: async (key, fallback) => values.get(key) ?? fallback, write: async (key, value) => (values.set(key, value), value), append: async () => null },
    extensions: { call: async () => ({ id: 'npm-alpha' }) },
    plans: { write: async (value) => (plans.push(value), value) },
    runs: { create: async (value) => (runs.push(value), value), transition: async () => null, capsule: async (id) => ({ runId: id, profile: 'producer' }) },
    plansWritten: plans,
    runsCreated: runs,
  }
}

test('delivery controls plan sequential work without performing Git effects', async () => {
  const rt = runtime()
  const plan = await handleCommand({ target: 'plan', flags: {}, runtime: rt })
  assert.deepEqual(plan.steps, ['check', 'commit', 'push', 'pull-request', 'ci', 'release-candidate'])
  const checkpoint = await handleCommand({ target: 'checkpoint', action: plan.id, flags: { step: 'commit', targets: 'main' }, runtime: rt })
  assert.equal(checkpoint.status, 'needs-authority')
  assert.deepEqual(checkpoint.checkpoint.effects, ['git:write', 'remote:write'])
  assert.equal(rt.runsCreated.length, 0)
})

test('delivery receipt unlocks one bounded release-candidate producer', async () => {
  const rt = runtime()
  const plan = await handleCommand({ target: 'plan', action: 'npm-alpha', flags: {}, runtime: rt })
  await handleCommand({ target: 'receipt', action: plan.id, flags: { summary: 'check: passed', proof: 'npm test,npm run check' }, runtime: rt })
  const candidate = await handleCommand({ target: 'release-candidate', action: plan.id, flags: {}, runtime: rt })
  assert.equal(candidate.status, 'ready')
  assert.equal(candidate.capsule.profile, 'producer')
  assert.equal(rt.runsCreated[0].assignment.requestedEffects.length, 0)
})
