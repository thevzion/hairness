import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { services } from '../index.mjs'

const manifest = JSON.parse(await readFile(new URL('../extension.json', import.meta.url), 'utf8'))
const runtime = {
  contracts: { validate: async (_name, value) => value },
  distribution: { read: async () => ({ sources: [{ id: 'git', requirement: 'required' }] }) },
}

test('sources expose only drivers selected by the distribution', async () => {
  const values = await services.list({ manifest, runtime })
  assert.deepEqual(values.map((value) => value.id), ['git'])
  assert.ok(values[0].operations.some((operation) => operation.id === 'status'))
})
