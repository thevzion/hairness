import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'

test('ideation controls keep creative strategy explicit', async () => {
  const result = await handleCommand({ namespace: 'propose', target: 'combat-loop', action: null, rest: [], flags: { creative: 'lateral', present: 'matrix' } })
  assert.deepEqual(result.operation, { capability: 'hairness/ideation', id: 'propose' })
  assert.equal(result.creative, 'lateral')
  assert.match(result.limits[0], /recommendation/)
})
