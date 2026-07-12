import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'

test('understanding controls preserve focus and explicit modifiers', async () => {
  const result = await handleCommand({ namespace: 'compare', target: 'Codex', action: 'Claude', rest: [], flags: { present: 'matrix', sources: 'prove' } })
  assert.deepEqual(result.operation, { capability: 'hairness/understanding', id: 'compare' })
  assert.equal(result.presentation, 'matrix')
  assert.equal(result.sourcePolicy, 'prove')
})
