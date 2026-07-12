import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCommand } from '../index.mjs'

test('source controls delegates generically to the runtime registry', async () => {
  const calls = []
  const runtime = { sources: { list: async () => [{ id: 'fixture' }], doctor: async (id) => ({ id }), read: async (...args) => { calls.push(args); return { source: args[0] } } } }
  assert.equal((await handleCommand({ target: 'list', runtime })).sources[0].id, 'fixture')
  assert.equal((await handleCommand({ target: 'read', action: 'fixture', rest: ['show'], flags: { input: '{"id":1}' }, runtime })).source, 'fixture')
  assert.deepEqual(calls[0], ['fixture', 'show', { id: 1 }])
})
