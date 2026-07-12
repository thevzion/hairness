import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'

test('presentation leaves view choice to the main session and caps it', async () => {
  const result = await handleCommand({ target: 'request', action: null, flags: { mode: 'auto' }, runtime: { contracts: { validateSchema: async (_schema, value) => value } } })
  assert.equal(result.mode, 'auto')
  assert.equal(result.maxViews, 3)
})
