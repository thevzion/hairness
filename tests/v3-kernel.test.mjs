import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { API, compileSchemas, validateDocument } from '../src/contracts/index.mjs'
import { homeDocument } from '../src/home/index.mjs'
import { writeJsonAtomic } from '../src/lib/io.mjs'
import { applyEffect, prepareEffect } from '../src/operations/index.mjs'
import { bindTarget, runtimePaths } from '../src/runtime/index.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-kernel-'))
  const state = join(root, 'state')
  const home = join(root, 'home')
  process.env.HAIRNESS_STATE_HOME = state
  const document = homeDocument({
    id: 'test-home',
    language: 'fr',
    providers: ['codex', 'claude'],
    extensions: ['hairness/cockpit', 'hairness/work'],
    targets: [{ id: 'product' }],
    overlayGit: false,
  })
  await writeJsonAtomic(join(home, 'hairness.json'), document)
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, state, home, document }
}

test('v0.3 type-specific schema registry compiles without a global protocol version', async () => {
  const keys = await compileSchemas()
  assert.equal(keys.length, 7)
  assert.ok(keys.includes(`${API.home}:Home`))
  assert.ok(keys.every((key) => !key.includes('0.2')))
})

test('Home tracks target identity while runtime owns its local path binding', async (t) => {
  const { home, document } = await fixture(t)
  await validateDocument(document, 'Home')
  await bindTarget(home, 'product', join(home, '..', 'product'))

  const tracked = await readFile(join(home, 'hairness.json'), 'utf8')
  const bindings = JSON.parse(await readFile(runtimePaths('test-home').targetBindings, 'utf8'))
  assert.equal(tracked.includes(join(home, '..', 'product')), false)
  assert.equal(bindings.targets.product.path, join(home, '..', 'product'))
})

test('effect checkpoints bind exact inputs, target evidence and policy', async (t) => {
  const { home } = await fixture(t)
  const current = {
    inputs: { title: 'Ship reset' },
    evidence: { head: 'abc123' },
    policy: { stage: 'before-publish-pr' },
    target: { id: 'product', head: 'abc123' },
  }
  const checkpoint = await prepareEffect(home, {
    operation: 'delivery.publish-pr',
    adapter: 'hairness/delivery:publish-pr',
    ...current,
  })

  await assert.rejects(
    applyEffect(home, checkpoint.metadata.id, { ...current, evidence: { head: 'changed' } }, async () => ({ ok: true })),
    (error) => error.code === 'checkpoint_stale',
  )
  const receipt = await applyEffect(home, checkpoint.metadata.id, current, async () => ({ url: 'https://example.test/pr/1' }))
  assert.equal(receipt.kind, 'Receipt')
  assert.equal(receipt.spec.outcome, 'succeeded')
})
