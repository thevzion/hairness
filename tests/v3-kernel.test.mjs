import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { API, compileSchemas, validateDocument } from '../src/contracts/index.mjs'
import { homeDocument } from '../src/home/index.mjs'
import { writeJsonAtomic } from '../src/lib/io.mjs'
import { applyEffect, effectOutcome, prepareEffect } from '../src/operations/index.mjs'
import { bindTargetLink, targetBinding } from '../src/targets/index.mjs'
import { initializeOverlay } from '../src/overlay/index.mjs'
import { git } from '../src/runtime/git.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-kernel-'))
  const state = join(root, 'state')
  const home = join(root, 'home')
  process.env.HAIRNESS_STATE_HOME = state
  const document = homeDocument({
    id: 'test-home',
    providers: ['codex', 'claude'],
    extensions: ['hairness/cockpit', 'hairness/work'],
    targets: [{ id: 'product', summary: 'Product', requirement: 'required', remotes: [] }],
    config: {},
    overlayGit: Boolean(options.overlayGit),
  })
  await writeJsonAtomic(join(home, 'hairness.json'), document)
  await initializeOverlay(home, { git: Boolean(options.overlayGit), profile: { language: 'fr' } })
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, state, home, document }
}

test('v0.3 type-specific schema registry compiles without a global protocol version', async () => {
  const keys = await compileSchemas()
  assert.equal(keys.length, 8)
  assert.ok(keys.includes(`${API.home}:Home`))
  assert.ok(keys.every((key) => !key.includes('0.2')))
})

test('Home tracks target identity while an ignored local link owns its path binding', async (t) => {
  const { root, home, document } = await fixture(t)
  await validateDocument(document, 'Home')
  const product = join(root, 'product')
  await mkdir(product, { recursive: true })
  await git(['init', '--quiet'], { cwd: product })
  await writeFile(join(product, 'README.md'), '# Product\n')
  await git(['add', 'README.md'], { cwd: product })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd: product })
  await bindTargetLink(home, 'product', product)

  const tracked = await readFile(join(home, 'hairness.json'), 'utf8')
  const binding = await targetBinding(home, 'product')
  assert.equal(tracked.includes(product), false)
  assert.equal(binding.path, await realpath(product))
})

test('effect checkpoints bind exact inputs, target evidence and policy', async (t) => {
  const { home } = await fixture(t, { overlayGit: true })
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
  assert.match(await git(['log', '-1', '--pretty=%s'], { cwd: join(home, '.overlay') }), /effect: delivery\.publish-pr succeeded/)

  const partial = await prepareEffect(home, {
    operation: 'delivery.publish-pr', adapter: 'hairness/delivery:publish-pr', ...current,
  })
  await assert.rejects(
    applyEffect(home, partial.metadata.id, current, async () => effectOutcome('partial', { created: true, url: null })),
    (error) => error.code === 'effect_partial' && error.details.receipt.spec.outcome === 'partial',
  )
  await assert.rejects(
    applyEffect(home, partial.metadata.id, current, async () => ({ retry: true })),
    (error) => error.code === 'checkpoint_consumed',
  )
})
