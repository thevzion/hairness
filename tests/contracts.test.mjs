import test from 'node:test'
import assert from 'node:assert/strict'
import { validateContract, validateSchemaSet } from '../src/core/contracts.mjs'
import { intent } from './helpers.mjs'

test('schema set compiles in strict draft 2020-12 mode', async () => {
  assert.equal(await validateSchemaSet(), true)
})

test('contract validation accepts a versioned intent', async () => {
  assert.deepEqual(await validateContract('Intent', intent()), intent())
})

test('contract validation rejects unexpected fields', async () => {
  await assert.rejects(
    validateContract('Intent', { ...intent(), surprise: true }),
    (error) => error.code === 'contract_invalid' && error.details.length > 0,
  )
})
