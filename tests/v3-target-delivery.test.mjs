import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHome } from '../src/home/create.mjs'
import { mapTarget } from '../src/maps/index.mjs'
import { createScratch } from '../src/scratch/index.mjs'
import { applyTargetPlan, listTargets, prepareTargetAdd } from '../src/targets/index.mjs'
import {
  acceptDeliveryBrief,
  preparePullRequest,
  proveMerged,
  releaseCheckout,
  runDeliveryGates,
  selectCheckout,
} from '../src/delivery/index.mjs'
import { git } from '../src/runtime/git.mjs'

async function fixture(t, withTarget = true) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-delivery-'))
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  const target = join(root, 'product')
  await mkdir(join(target, 'src'), { recursive: true })
  await git(['init', '--quiet', '--initial-branch=main'], { cwd: target })
  await writeFile(join(target, 'src/base.txt'), 'base\n')
  await git(['add', '--all'], { cwd: target })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd: target })
  const home = join(root, 'home')
  await createHome(home, {
    preset: 'standard', language: 'en', providers: ['codex'], target: withTarget ? target : null,
    overlayGit: false, install: false,
  })
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, home, target, base: await git(['rev-parse', 'HEAD'], { cwd: target }) }
}

test('Target registration stores live path only in Runtime and maps remain chat-first', async (t) => {
  const { home, target } = await fixture(t, false)
  const prepared = await prepareTargetAdd(home, target, 'product')
  const receipt = await applyTargetPlan(home, prepared.checkpoint.metadata.id)
  assert.equal(receipt.spec.result.grantsAuthority, false)
  const registered = (await listTargets(home))[0]
  assert.equal(registered.id, 'product')
  assert.equal(registered.evidence.clean, true)
  assert.equal((await readFile(join(home, 'hairness.json'), 'utf8')).includes(target), false)

  const map = await mapTarget(home, 'product', { focus: 'base', scope: 'src', view: 'tree' })
  assert.deepEqual(map.files, ['src/base.txt'])
  assert.equal(map.persistence, 'none')
})

test('DeliveryBrief acceptance leads to an adaptive worktree and exact PR checkpoint', async (t) => {
  const { home, target, base } = await fixture(t)
  await createScratch(home, { id: 'reset', title: 'Reset' })
  await acceptDeliveryBrief(home, {
    accepted: true, id: 'reset', outcome: 'Ship one coherent feature',
    acceptanceCriteria: ['Feature file is committed'], scope: ['src/'], nonGoals: ['No release'],
    target: 'product', base, releaseImpact: 'none', requiredChecks: ['test'],
  })
  const checkout = await selectCheckout(home, { scratch: 'reset', target: 'product', base, parallel: true })
  assert.equal(checkout.strategy, 'isolate')
  assert.equal(checkout.worktree, true)
  await writeFile(join(checkout.path, 'src/feature.txt'), 'feature\n')
  await git(['add', 'src/feature.txt'], { cwd: checkout.path })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'feat: add feature'], { cwd: checkout.path })
  assert.equal((await runDeliveryGates(home, 'after-implementation', { scratch: 'reset' })).status, 'passed')

  const checkpoint = await preparePullRequest(home, {
    brief: 'reset', checkout: checkout.path, title: 'feat: add feature', body: 'Implements the accepted brief.', checks: { test: 'passed' },
  })
  assert.equal(checkpoint.spec.operation, 'delivery.publish-pr')
  assert.equal(checkpoint.spec.target.head, await git(['rev-parse', 'HEAD'], { cwd: checkout.path }))

  await git(['merge', '--quiet', '--no-ff', checkout.branch, '-m', 'merge feature'], { cwd: target })
  const mergeCommit = await git(['rev-parse', 'HEAD'], { cwd: target })
  assert.equal((await proveMerged(target, { prHead: checkpoint.spec.target.head, mergeCommit })).status, 'proved')
  assert.equal((await releaseCheckout(home, 'product', 'reset')).status, 'released')
})

test('adaptive checkout isolates dirty and occupied repositories and refuses unsafe cleanup', async (t) => {
  const { home, target, base } = await fixture(t)
  const first = await selectCheckout(home, { scratch: 'first', target: 'product', base })
  assert.equal(first.strategy, 'reuse')
  const occupied = await selectCheckout(home, { scratch: 'second', target: 'product', base })
  assert.equal(occupied.strategy, 'isolate')
  assert.equal(occupied.reason.occupied, true)
  await writeFile(join(occupied.path, 'dirty.txt'), 'dirty\n')
  await assert.rejects(releaseCheckout(home, 'product', 'second'), (error) => error.code === 'checkout_dirty')
  await rm(join(occupied.path, 'dirty.txt'))
  await git(['merge', '--ff-only', occupied.branch], { cwd: target })
  await releaseCheckout(home, 'product', 'second')
  await releaseCheckout(home, 'product', 'first')

  await writeFile(join(target, 'uncommitted.txt'), 'dirty source\n')
  const dirty = await selectCheckout(home, { scratch: 'third', target: 'product', base: 'HEAD' })
  assert.equal(dirty.strategy, 'isolate')
  assert.equal(dirty.reason.dirty, true)
  await releaseCheckout(home, 'product', 'third')
  await rm(join(target, 'uncommitted.txt'))

  await writeFile(join(target, 'src/new-base.txt'), 'new base\n')
  await git(['add', 'src/new-base.txt'], { cwd: target })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'chore: move base'], { cwd: target })
  const incompatible = await selectCheckout(home, { scratch: 'fourth', target: 'product', base })
  assert.equal(incompatible.strategy, 'isolate')
  assert.equal(incompatible.reason.incompatible, true)
  await releaseCheckout(home, 'product', 'fourth')
})

test('scope drift blocks publication before a PR effect can be prepared', async (t) => {
  const { home, base } = await fixture(t)
  await createScratch(home, { id: 'scope', title: 'Scope' })
  await acceptDeliveryBrief(home, {
    accepted: true, id: 'scope', outcome: 'Change source', acceptanceCriteria: ['Source changes'],
    scope: ['src/'], target: 'product', base, requiredChecks: [],
  })
  const checkout = await selectCheckout(home, { scratch: 'scope', target: 'product', base, parallel: true })
  await writeFile(join(checkout.path, 'README.md'), 'outside scope\n')
  await git(['add', 'README.md'], { cwd: checkout.path })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'docs: drift'], { cwd: checkout.path })
  await assert.rejects(
    preparePullRequest(home, { brief: 'scope', checkout: checkout.path, title: 'docs: drift', body: 'Drift.', checks: {} }),
    (error) => error.code === 'delivery_scope_drift',
  )
})
