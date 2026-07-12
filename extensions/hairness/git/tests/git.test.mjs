import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceOperations } from '../index.mjs'

const root = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '')

test('Git source owns live status and overlap operations', async () => {
  const status = await sourceOperations.status({ root, input: {} })
  assert.equal(typeof status.branch, 'string')
  const overlap = await sourceOperations.overlap({ root, input: { targets: ['src/'] } })
  assert.ok(Array.isArray(overlap.overlap))
})
