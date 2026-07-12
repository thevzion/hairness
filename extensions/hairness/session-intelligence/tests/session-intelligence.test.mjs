import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionSignals } from '../index.mjs'

test('session intelligence contributes handoff attention from its own state', async () => {
  const runtime = { overlay: { list: async () => [] } }
  assert.equal((await attentionSignals({ runtime }))[0].route, 'hairness session digest')
})
