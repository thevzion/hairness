import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand, services } from '../index.mjs'

test('constraints inherit from session to active segment', async () => {
  let stored = null
  const work = { activeSegmentId: 's1', frames: [] }
  const runtime = { overlay: { read: async (_key, fallback) => stored ?? structuredClone(fallback), write: async (_key, value) => (stored = value) }, extensions: { call: async (_id, service) => service === 'state' ? work : work } }
  await handleCommand({ target: 'set', action: 'readonly', flags: { scope: 'session' }, runtime })
  await handleCommand({ target: 'set', action: 'no-git', flags: { scope: 'segment' }, runtime })
  assert.deepEqual(await services.effective({ input: {}, runtime }), ['readonly', 'no-git'])
})
