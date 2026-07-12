import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'
import { validateJsonSchema } from '../../../../src/core/contracts.mjs'

function runtime() {
  const values = new Map(); const events = []
  return {
    contracts: { validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../${schema.slice(2)}`, import.meta.url), value, label) },
    overlay: { read: async (key, fallback) => values.get(key) ?? fallback, write: async (key, value) => (values.set(key, value), value), append: async (_key, value) => events.push(value) },
    events,
  }
}

test('initiative controls keep one active outcome and checkpoint publication', async () => {
  const rt = runtime()
  const initiative = await handleCommand({ target: 'open', action: 'npm-alpha', flags: { outcome: 'Prepare the alpha.', gate: 'Package checks pass.', links: 'ROADMAP.md' }, runtime: rt })
  assert.equal(initiative.state, 'active')
  await assert.rejects(handleCommand({ target: 'open', action: 'other', flags: { outcome: 'Other.', gate: 'Done.' }, runtime: rt }), /active initiative/)
  const publication = await handleCommand({ target: 'publish', flags: {}, runtime: rt })
  assert.equal(publication.status, 'needs-authority')
  const ready = await handleCommand({ target: 'publish', flags: { checkpoint: publication.checkpoint.id }, runtime: rt })
  assert.equal(ready.status, 'ready')
  assert.match(ready.operation.content, /npm-alpha/)
  assert.equal(rt.events.length, 1)
})

test('initiative close requires evidence', async () => {
  const rt = runtime()
  await handleCommand({ target: 'open', action: 'foundation', flags: { outcome: 'Foundation.', gate: 'Tests.' }, runtime: rt })
  await assert.rejects(handleCommand({ target: 'close', action: 'foundation', flags: {}, runtime: rt }), /evidence/)
  const closed = await handleCommand({ target: 'close', action: 'foundation', flags: { evidence: 'PR #1,CI' }, runtime: rt })
  assert.equal(closed.state, 'closed')
  assert.deepEqual(closed.evidence, ['PR #1', 'CI'])
})
