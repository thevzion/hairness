import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDeliveryPullRequest } from '../scripts/check-delivery-policy.mjs'

test('delivery policy accepts coherent feature and release pull requests', () => {
  assert.equal(validateDeliveryPullRequest({ title: 'feat(delivery): add agentic GitHub Flow', head: 'feat/agentic-delivery', base: 'main' }).type, 'feat')
  assert.equal(validateDeliveryPullRequest({ title: 'chore(release): prepare 0.2.0-alpha.0', head: 'release/0.2.0-alpha.0', base: 'main' }).scope, 'release')
})

test('delivery policy rejects provider branches and incoherent titles', () => {
  assert.throws(() => validateDeliveryPullRequest({ title: 'feat: add flow', head: 'codex/add-flow', base: 'main' }))
  assert.throws(() => validateDeliveryPullRequest({ title: 'fix: add flow', head: 'feat/add-flow', base: 'main' }))
  assert.throws(() => validateDeliveryPullRequest({ title: 'Add flow', head: 'feat/add-flow', base: 'main' }))
})
