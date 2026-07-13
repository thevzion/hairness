import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleCommand } from '../index.mjs'
import { validateJsonSchema } from '../../../../src/core/contracts.mjs'

const basePolicy = {
  profile: 'github-flow',
  repository: 'example/widget',
  baseBranch: 'main',
  branchTypes: ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'release'],
  branchPattern: '^(?:(feat|fix|docs|refactor|perf|test|build|ci|chore)/[a-z0-9]+(?:-[a-z0-9]+)*|release/[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)$',
  merge: { method: 'squash', deleteBranch: true, linearHistory: true, resolveConversations: true },
  requiredChecks: ['test (22)', 'test (24)', 'delivery policy'],
  evidenceMaxAgeMinutes: 30,
  release: { package: '@example/cli', registry: 'https://registry.npmjs.org/', versionSource: 'package.json', prereleaseTag: 'next', gitTagFormat: 'v{version}', githubRelease: 'prerelease', bootstrapBaseline: null },
}

async function fixture(policy = basePolicy) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-delivery-'))
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: policy.release.package, version: '1.2.0-alpha.0' })}\n`)
  const values = new Map()
  const pendingArtifacts = new Map()
  const artifacts = new Map()
  const latestArtifacts = new Map()
  const plans = []
  const runs = new Map()
  const checkpoints = []
  let activePolicy = structuredClone(policy)
  const rt = {
    contracts: { validateSchema: (schema, value, label) => validateJsonSchema(new URL(`../${schema.slice(2)}`, import.meta.url), value, label) },
    distribution: { read: async () => ({ defaults: { delivery: activePolicy } }) },
    overlay: { read: async (key, fallback) => values.get(key) ?? structuredClone(fallback), write: async (key, value) => (values.set(key, structuredClone(value)), value), append: async () => null },
    extensions: { call: async () => ({ id: 'initiative-one' }) },
    artifacts: {
      read: async (id, revision) => {
        const value = revision ? artifacts.get(`${id}@${revision}`) : latestArtifacts.get(id)
        if (!value) { const error = new Error(`Missing ${id}`); error.code = 'artifact_not_found'; throw error }
        return structuredClone(value)
      },
      stage: async (runId, value) => (pendingArtifacts.set(runId, structuredClone(value)), value),
      promote: async (runId) => {
        const value = pendingArtifacts.get(runId)
        artifacts.set(`${value.id}@${value.revision}`, structuredClone(value))
        latestArtifacts.set(value.id, structuredClone(value))
        return value
      },
    },
    plans: { write: async (value) => (plans.push(structuredClone(value)), value) },
    runs: {
      create: async (value) => (runs.set(value.id, { ...structuredClone(value), state: 'planned' }), value),
      transition: async (id, state) => (runs.get(id).state = state),
      capsule: async (id) => ({ runId: id, profile: 'executor', assignment: structuredClone(runs.get(id).assignment) }),
      result: async (id) => runs.get(id).result ?? null,
      proposeCheckpoint: async (value) => {
        const stored = { ...structuredClone(value), policyDigest: 'sha256:authority-policy' }
        checkpoints.push(stored)
        return stored
      },
    },
  }
  return { root, rt, values, artifacts, plans, runs, checkpoints, setPolicy: (value) => { activePolicy = structuredClone(value) }, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function draftAndAccept(env, subject = 'Add safe delivery', type = 'feat') {
  const draft = await handleCommand({ root: env.root, target: 'want', action: subject, flags: { type }, runtime: env.rt })
  return handleCommand({ root: env.root, target: 'accept', action: draft.results[0].id, flags: {}, runtime: env.rt })
}

async function completeEffect(env, plan, stage, flags = {}) {
  const { receiptHead, ...checkpointFlags } = flags
  const prepared = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage, ...checkpointFlags }, runtime: env.rt })
  env.runs.get(prepared.runId).result = { status: 'succeeded', summary: `${stage} completed`, proof: [`receipt:${stage}`], outcome: { receipt: { status: 'succeeded', summary: `${stage} completed`, effects: prepared.checkpoint.effects, targets: prepared.checkpoint.targets, proof: [`receipt:${stage}`], head: receiptHead ?? checkpointFlags.head ?? null } } }
  const receipt = await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage, run: prepared.runId }, runtime: env.rt })
  return { prepared, receipt }
}

async function completePartialEffect(env, plan, stage, status = 'partial', flags = {}) {
  const prepared = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage, ...flags }, runtime: env.rt })
  env.runs.get(prepared.runId).result = { status: 'succeeded', summary: `${stage} ${status}`, proof: [`receipt:${stage}:${status}`], outcome: { receipt: { status, summary: `${stage} ${status}`, effects: prepared.checkpoint.effects, targets: prepared.checkpoint.targets, proof: [`receipt:${stage}:${status}`], head: flags.head ?? null } } }
  const receipt = await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage, run: prepared.runId }, runtime: env.rt })
  return { prepared, receipt }
}

test('accepted briefs are idempotent and allow parallel change plans', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const first = await draftAndAccept(env, 'Add safe delivery')
  const same = await handleCommand({ root: env.root, target: 'accept', action: first.plan.briefArtifact.split('/').at(-1), flags: {}, runtime: env.rt })
  const second = await draftAndAccept(env, 'Fix release proof', 'fix')
  const state = await handleCommand({ root: env.root, target: 'status', flags: {}, runtime: env.rt })
  assert.equal(first.plan.id, same.plan.id)
  assert.notEqual(first.plan.id, second.plan.id)
  assert.equal(state.plans.length, 2)
  assert.ok(state.plans.every((plan) => plan.initiativeId === 'initiative-one'))
})

test('ship-it and auto stay effect-free until one exact checkpoint', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env)
  const preview = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: { auto: true }, runtime: env.rt })
  assert.equal(preview.results[0].stage, 'prepare')
  assert.equal(env.runs.size, 0)
  const prepared = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'prepare' }, runtime: env.rt })
  assert.equal(prepared.status, 'needs-authority')
  assert.deepEqual(prepared.checkpoint.effects, ['git:branch'])
  assert.equal(env.checkpoints.length, 1)
  assert.equal(env.runs.get(prepared.runId).state, 'needs-authority')
})

test('pull-request proposal binds inspected files, head and diff to the executor capsule', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env)
  await completeEffect(env, plan, 'prepare')
  await completeEffect(env, plan, 'implement')
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'qualify', proof: 'checks:test-22,checks:test-24', head: 'abc1234' }, runtime: env.rt })
  const specialized = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: { boundary: 'publish-pr' }, runtime: env.rt })
  assert.equal(specialized.results[0].stage, 'publish-pr')
  const prepared = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'publish-pr', head: 'abc1234', 'diff-digest': 'sha256:abcd', files: 'src/a.mjs,tests/a.test.mjs' }, runtime: env.rt })
  const proposalInput = env.runs.get(prepared.runId).assignment.inputs.find((item) => item.pullRequestProposal)
  const proposal = [...env.artifacts.values()].find((item) => item.type === 'pull-request-proposal')
  assert.equal(proposal.payload.head, 'abc1234')
  assert.equal(proposal.payload.diffDigest, 'sha256:abcd')
  assert.deepEqual(proposal.payload.files, ['src/a.mjs', 'tests/a.test.mjs'])
  assert.match(proposal.payload.body, /releaseImpact: user/)
  assert.equal(proposalInput.pullRequestProposal.diffDigest, proposal.payload.diffDigest)
  const stale = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'publish-pr', head: 'abc1234', 'diff-digest': 'sha256:changed', files: 'src/a.mjs,tests/a.test.mjs' }, runtime: env.rt })
  assert.equal(stale.status, 'blocked')
  assert.match(stale.limits[0], /existing Run/)
})

test('pull-request proposal rejects a title incoherent with its branch', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env)
  await completeEffect(env, plan, 'prepare')
  await completeEffect(env, plan, 'implement')
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'qualify', proof: 'checks:ready', head: 'abc1234' }, runtime: env.rt })
  await assert.rejects(handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'publish-pr', head: 'abc1234', title: 'fix: wrong type', 'diff-digest': 'sha256:abcd', files: 'src/a.mjs' }, runtime: env.rt }), /does not match branch type/)
})

test('change merge keeps pre-commit qualification and requires matching PR and CI heads', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env, 'Fix exact merge head', 'fix')
  await completeEffect(env, plan, 'prepare')
  await completeEffect(env, plan, 'implement')
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'qualify', proof: 'checks:ready', head: 'base-head' }, runtime: env.rt })
  const { receipt: published } = await completeEffect(env, plan, 'publish-pr', { head: 'base-head', receiptHead: 'pull-request-head', 'diff-digest': 'sha256:abcd', files: 'src/a.mjs,tests/a.test.mjs' })
  assert.equal(published.head, 'pull-request-head')
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'ci', proof: 'checks:ready', head: 'pull-request-head' }, runtime: env.rt })

  const next = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: { boundary: 'merge', head: 'pull-request-head' }, runtime: env.rt })
  assert.equal(next.results[0].stage, 'merge')
  const wrongHead = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'merge', head: 'different-head' }, runtime: env.rt })
  assert.equal(wrongHead.status, 'blocked')
  assert.match(wrongHead.summary, /does not match/)
  const prepared = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'merge', head: 'pull-request-head' }, runtime: env.rt })
  assert.equal(prepared.status, 'needs-authority')
  assert.deepEqual(prepared.checkpoint.effects, ['github:merge'])
})

test('release planning aggregates only conventional release-impacting changes', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const changes = [
    { number: 10, title: 'feat(cli): add delivery', releaseImpact: 'user' },
    { number: 11, title: 'fix(ci): stabilize checks', releaseImpact: 'none' },
    { number: 12, title: 'release: 1.2.0-alpha.0', releaseImpact: 'user' },
    { number: 13, title: 'misc notes', releaseImpact: 'user' },
  ]
  const plan = await handleCommand({ root: env.root, target: 'plan', flags: { kind: 'release', version: '1.2.0-alpha.0' }, runtime: env.rt })
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'collect', proof: 'github:merged-pull-requests', head: 'def5678', 'changes-json': JSON.stringify(changes) }, runtime: env.rt })
  const collected = (await handleCommand({ root: env.root, target: 'status', flags: {}, runtime: env.rt })).plans.find((item) => item.id === plan.id)
  assert.deepEqual(collected.changes, ['#10 feat(cli): add delivery'])
  assert.equal(collected.versionRecommendation, 'minor')

  const specialized = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: { boundary: 'publish-pr' }, runtime: env.rt })
  assert.equal(specialized.results[0].stage, 'release-pr')
  const premature = await handleCommand({ root: env.root, target: 'release-candidate', action: plan.id, flags: { commit: 'release-main-head' }, runtime: env.rt })
  assert.equal(premature.status, 'blocked')
  assert.match(premature.limits[0], /release-pr/)

  await completeEffect(env, plan, 'release-pr', { head: 'release-pr-head', 'diff-digest': 'sha256:release', files: 'CHANGELOG.md,docs/releases/1.2.0-alpha.0.md' })
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'ci', proof: 'checks:test-22,checks:test-24', head: 'release-pr-head' }, runtime: env.rt })
  const wrongMerge = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'merge', head: 'different-pr-head' }, runtime: env.rt })
  assert.equal(wrongMerge.status, 'blocked')
  await completeEffect(env, plan, 'merge', { head: 'release-pr-head' })
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'verify-main', proof: 'github:main-contains-release', head: 'release-main-head' }, runtime: env.rt })
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'qualify', proof: 'tarball:qualified', head: 'release-main-head' }, runtime: env.rt })

  const wrongCommit = await handleCommand({ root: env.root, target: 'release-candidate', action: plan.id, flags: { commit: 'different-main-head', tarball: '/tmp/example-cli.tgz', sha256: 'sha256:1234', integrity: 'sha512-example', 'dry-run': 'passed' }, runtime: env.rt })
  assert.equal(wrongCommit.status, 'blocked')
  assert.match(wrongCommit.limits[0], /exact commit/)
  const candidate = await handleCommand({ root: env.root, target: 'release-candidate', action: plan.id, flags: { commit: 'release-main-head', tarball: '/tmp/example-cli.tgz', sha256: 'sha256:1234', integrity: 'sha512-example', 'dry-run': 'passed' }, runtime: env.rt })
  assert.equal(candidate.payload.package.name, '@example/cli')
  const preview = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: { auto: true }, runtime: env.rt })
  assert.equal(preview.results[0].stage, 'npm-publish')
  assert.equal(env.runs.size, 2)
  const mismatchedPublish = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'npm-publish', head: 'different-main-head' }, runtime: env.rt })
  assert.equal(mismatchedPublish.status, 'blocked')
  assert.match(mismatchedPublish.limits[0], /exact public commit/)

  await completeEffect(env, plan, 'npm-publish', { head: 'release-main-head' })
  const tagCreate = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'git-tag-create', head: 'release-main-head' }, runtime: env.rt })
  assert.deepEqual(tagCreate.checkpoint.effects, ['git:tag'])
  assert.deepEqual(tagCreate.checkpoint.targets, [env.root])
  env.runs.get(tagCreate.runId).result = { status: 'succeeded', summary: 'tag created', proof: ['tag:local'], outcome: { receipt: { status: 'succeeded', summary: 'tag created', effects: ['git:tag'], targets: [env.root], proof: ['tag:local'], head: 'release-main-head' } } }
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'git-tag-create', run: tagCreate.runId }, runtime: env.rt })
  const tagPush = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'git-tag-push', head: 'release-main-head' }, runtime: env.rt })
  assert.deepEqual(tagPush.checkpoint.effects, ['git:push'])
  assert.match(tagPush.checkpoint.targets[0], /^github:\/\/example\/widget\/tags\//)
  env.runs.get(tagPush.runId).result = { status: 'succeeded', summary: 'tag pushed', proof: ['tag:remote'], outcome: { receipt: { status: 'succeeded', summary: 'tag pushed', effects: ['git:push'], targets: tagPush.checkpoint.targets, proof: ['tag:remote'], head: 'release-main-head' } } }
  await handleCommand({ root: env.root, target: 'receipt', action: plan.id, flags: { stage: 'git-tag-push', run: tagPush.runId }, runtime: env.rt })
  const afterTag = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: {}, runtime: env.rt })
  assert.equal(afterTag.results[0].stage, 'github-release')

  const releaseState = env.values.get('state.json')
  const ciReceipt = releaseState.receipts.find((receipt) => receipt.planId === plan.id && receipt.stage === 'ci')
  ciReceipt.status = 'partial'
  const partial = await handleCommand({ root: env.root, target: 'release-candidate', action: plan.id, flags: { commit: 'release-main-head', tarball: '/tmp/example-cli.tgz', sha256: 'sha256:changed', integrity: 'sha512-example', 'dry-run': 'passed' }, runtime: env.rt })
  assert.equal(partial.status, 'blocked')
  assert.match(partial.limits[0], /ci/)
  ciReceipt.status = 'succeeded'
  ciReceipt.observedAt = '2000-01-01T00:00:00.000Z'
  const stale = await handleCommand({ root: env.root, target: 'release-candidate', action: plan.id, flags: { commit: 'release-main-head', tarball: '/tmp/example-cli.tgz', sha256: 'sha256:changed', integrity: 'sha512-example', 'dry-run': 'passed' }, runtime: env.rt })
  assert.equal(stale.status, 'blocked')
  assert.match(stale.limits[0], /ci/)
})

test('changed policy and partial evidence block progression', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env)
  env.setPolicy({ ...basePolicy, requiredChecks: [...basePolicy.requiredChecks, 'security'] })
  const blocked = await handleCommand({ root: env.root, target: 'checkpoint', action: plan.id, flags: { stage: 'prepare' }, runtime: env.rt })
  assert.equal(blocked.status, 'blocked')
  env.setPolicy(basePolicy)
  const { receipt } = await completePartialEffect(env, plan, 'prepare')
  const next = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: {}, runtime: env.rt })
  assert.equal(next.results[0].stage, 'prepare')
  assert.equal(next.results[0].status, 'needs-reconciliation')
  assert.deepEqual(next.results[0].decisions, ['accept-deviation', 'retry', 'abort'])

  const prepared = await handleCommand({ root: env.root, target: 'reconcile', action: plan.id, flags: { stage: 'prepare', receipt: receipt.id, decision: 'accept-deviation', reason: 'The observed branch is usable.', proof: 'git:branch-present,head:abc1234' }, runtime: env.rt })
  assert.equal(prepared.status, 'needs-authority')
  assert.equal(prepared.checkpoint.receiptId, receipt.id)
  assert.deepEqual(prepared.effects, [])
  const automatic = await handleCommand({ root: env.root, target: 'reconcile', action: plan.id, flags: { checkpoint: prepared.checkpoint.id, auto: true }, runtime: env.rt })
  assert.equal(automatic.status, 'blocked')

  env.setPolicy({ ...basePolicy, requiredChecks: [...basePolicy.requiredChecks, 'security'] })
  const stalePolicy = await handleCommand({ root: env.root, target: 'reconcile', action: plan.id, flags: { checkpoint: prepared.checkpoint.id }, runtime: env.rt })
  assert.equal(stalePolicy.status, 'blocked')
  env.setPolicy(basePolicy)
  const accepted = await handleCommand({ root: env.root, target: 'reconcile', action: plan.id, flags: { checkpoint: prepared.checkpoint.id }, runtime: env.rt })
  assert.equal(accepted.status, 'ready')
  const state = await handleCommand({ root: env.root, target: 'status', flags: {}, runtime: env.rt })
  assert.equal(state.receipts.find((item) => item.id === receipt.id).status, 'partial')
  assert.equal(state.reconciliations[0].receiptId, receipt.id)
  assert.equal(state.reconciliations[0].decision, 'accept-deviation')
  const after = await handleCommand({ root: env.root, target: 'next', action: plan.id, flags: {}, runtime: env.rt })
  assert.equal(after.results[0].stage, 'implement')
})

test('retry and abort remain explicit append-only reconciliation outcomes', async (context) => {
  const retryEnv = await fixture(); context.after(retryEnv.cleanup)
  const { plan: retryPlan } = await draftAndAccept(retryEnv, 'Retry one effect')
  const { receipt: retryReceipt } = await completePartialEffect(retryEnv, retryPlan, 'prepare', 'unknown')
  const retryCheckpoint = await handleCommand({ root: retryEnv.root, target: 'reconcile', action: retryPlan.id, flags: { stage: 'prepare', receipt: retryReceipt.id, decision: 'retry', reason: 'Live proof shows no branch was created.', proof: 'git:branch-absent' }, runtime: retryEnv.rt })
  const storedCheckpoint = retryEnv.values.get('state.json').reconciliationCheckpoints.find((item) => item.id === retryCheckpoint.checkpoint.id)
  storedCheckpoint.createdAt = '2000-01-01T00:00:00.000Z'
  const stale = await handleCommand({ root: retryEnv.root, target: 'reconcile', action: retryPlan.id, flags: { checkpoint: retryCheckpoint.checkpoint.id }, runtime: retryEnv.rt })
  assert.equal(stale.status, 'blocked')
  storedCheckpoint.createdAt = new Date().toISOString()
  await handleCommand({ root: retryEnv.root, target: 'reconcile', action: retryPlan.id, flags: { checkpoint: retryCheckpoint.checkpoint.id }, runtime: retryEnv.rt })
  const retryState = await handleCommand({ root: retryEnv.root, target: 'status', flags: {}, runtime: retryEnv.rt })
  const storedRetryPlan = retryState.plans.find((item) => item.id === retryPlan.id)
  assert.equal(storedRetryPlan.runs.prepare, undefined)
  assert.equal(retryState.receipts.find((item) => item.id === retryReceipt.id).status, 'unknown')
  assert.equal(retryState.reconciliations[0].decision, 'retry')
  assert.equal((await handleCommand({ root: retryEnv.root, target: 'next', action: retryPlan.id, flags: {}, runtime: retryEnv.rt })).results[0].status, 'needs-checkpoint')

  const abortEnv = await fixture(); context.after(abortEnv.cleanup)
  const { plan: abortPlan } = await draftAndAccept(abortEnv, 'Abort one effect')
  const { receipt: abortReceipt } = await completePartialEffect(abortEnv, abortPlan, 'prepare')
  const abortCheckpoint = await handleCommand({ root: abortEnv.root, target: 'reconcile', action: abortPlan.id, flags: { stage: 'prepare', receipt: abortReceipt.id, decision: 'abort', reason: 'The deviation is not acceptable.', proof: 'operator:stop' }, runtime: abortEnv.rt })
  const aborted = await handleCommand({ root: abortEnv.root, target: 'reconcile', action: abortPlan.id, flags: { checkpoint: abortCheckpoint.checkpoint.id }, runtime: abortEnv.rt })
  assert.equal(aborted.status, 'blocked')
  const abortNext = await handleCommand({ root: abortEnv.root, target: 'next', action: abortPlan.id, flags: {}, runtime: abortEnv.rt })
  assert.equal(abortNext.results[0].status, 'blocked')
  assert.equal(abortNext.results[0].reconciliation.decision, 'abort')
})

test('unstarted legacy Git tag stages migrate without rewriting historical evidence', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const plan = await handleCommand({ root: env.root, target: 'plan', flags: { kind: 'release', version: '1.2.0-alpha.0' }, runtime: env.rt })
  const state = env.values.get('state.json')
  state.plans.find((item) => item.id === plan.id).stages = state.plans.find((item) => item.id === plan.id).stages.flatMap((stage) => ['git-tag-create', 'git-tag-push'].includes(stage) ? [] : stage === 'github-release' ? ['git-tag', stage] : [stage])
  const migrated = await handleCommand({ root: env.root, target: 'status', flags: {}, runtime: env.rt })
  const stages = migrated.plans.find((item) => item.id === plan.id).stages
  assert.deepEqual(stages.slice(-3), ['git-tag-create', 'git-tag-push', 'github-release'])
})

test('a neutral policy proves Delivery Controls do not hardcode Hairness', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const { plan } = await draftAndAccept(env, 'Ship neutral fixture')
  assert.equal(plan.repository, 'example/widget')
  assert.doesNotMatch(JSON.stringify(plan), /thevzion|@hairness\/cli/)
})
