import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionSignals, services } from '../index.mjs'

test('session intelligence contributes handoff attention from its own state', async () => {
  const runtime = { overlay: { list: async () => [] } }
  assert.equal((await attentionSignals({ runtime }))[0].route, 'hairness session digest')
})

test('current session service gives dependent extensions one stable identity', async () => {
  const state = new Map()
  const runtime = {
    overlay: {
      read: async (key, fallback = null) => state.get(key) ?? fallback,
      write: async (key, value) => { state.set(key, value); return value },
    },
    contracts: { validate: async (_schema, value) => value },
  }
  const first = await services.current({ root: '/fixture', input: {}, runtime })
  const second = await services.current({ root: '/fixture', input: {}, runtime })
  assert.equal(first.id, second.id)
  assert.match(first.id, /^session-/)
})
