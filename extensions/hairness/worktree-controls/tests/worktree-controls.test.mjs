import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { authorityPolicy, handleCommand, services } from '../index.mjs'

const exec = promisify(execFile)
const policyDigest = 'sha256:delivery-policy'

async function git(path, args, options = {}) {
  return exec('git', ['-C', path, ...args], { encoding: 'utf8', ...options })
}

function parseWorktrees(raw) {
  const entries = []
  let current = null
  for (const field of raw.split('\0')) {
    if (!field) continue
    const separator = field.indexOf(' ')
    const key = separator < 0 ? field : field.slice(0, separator)
    const value = separator < 0 ? true : field.slice(separator + 1)
    if (key === 'worktree') {
      if (current) entries.push(current)
      current = { path: value, head: null, branch: null, detached: false, locked: false, lockReason: null, prunable: false, prunableReason: null, moved: false }
    } else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace('refs/heads/', '')
    else if (key === 'detached') current.detached = true
    else if (key === 'locked') { current.locked = true; current.lockReason = value === true ? null : value }
    else if (key === 'prunable') { current.prunable = true; current.prunableReason = value === true ? null : value }
  }
  if (current) entries.push(current)
  return entries
}

async function sourceEvidence(operation, input) {
  const path = input.path
  if (operation === 'worktrees') {
    const [{ stdout }, common, top] = await Promise.all([
      git(path, ['worktree', 'list', '--porcelain', '-z']),
      git(path, ['rev-parse', '--git-common-dir']).then(({ stdout }) => resolve(path, stdout.trim())),
      git(path, ['rev-parse', '--show-toplevel']).then(({ stdout }) => stdout.trim()),
    ])
    const entries = parseWorktrees(stdout)
    return { repositoryRoot: entries[0]?.path ?? top, commonDir: common, worktrees: entries }
  }
  if (operation === 'refs') {
    const head = await git(path, ['rev-parse', 'HEAD']).then(({ stdout }) => stdout.trim())
    const branch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(({ stdout }) => stdout.trim()).catch(() => null)
    const base = input.base ?? 'main'
    const baseHead = await git(path, ['rev-parse', base]).then(({ stdout }) => stdout.trim()).catch(() => null)
    const mergeBase = baseHead ? await git(path, ['merge-base', head, baseHead]).then(({ stdout }) => stdout.trim()) : null
    return { path, head, branch, base, baseHead, mergeBase }
  }
  if (operation === 'status') {
    const dirty = await git(path, ['status', '--porcelain']).then(({ stdout }) => stdout.split('\n').filter(Boolean).length)
    const branch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(({ stdout }) => stdout.trim()).catch(() => null)
    const head = await git(path, ['rev-parse', 'HEAD']).then(({ stdout }) => stdout.trim())
    const upstream = await git(path, ['rev-parse', '--abbrev-ref', '@{upstream}']).then(({ stdout }) => stdout.trim()).catch(() => null)
    const ahead = upstream ? await git(path, ['rev-list', '--count', `${upstream}..HEAD`]).then(({ stdout }) => Number(stdout.trim())) : 0
    return { path, branch, head, upstream, ahead, behind: 0, dirty }
  }
  if (operation === 'merge-proof') {
    const head = await git(path, ['rev-parse', 'HEAD']).then(({ stdout }) => stdout.trim())
    const base = input.base ?? 'main'
    const baseHead = await git(path, ['rev-parse', base]).then(({ stdout }) => stdout.trim())
    const mergeBase = await git(path, ['merge-base', head, baseHead]).then(({ stdout }) => stdout.trim())
    const isAncestor = await git(path, ['merge-base', '--is-ancestor', head, baseHead]).then(() => true).catch(() => false)
    return { head, base, mergeBase, isAncestor, isIntegrated: isAncestor }
  }
  throw new Error(`Unsupported source operation: ${operation}`)
}

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-worktree-controls-'))
  await git(root, ['init', '-b', 'main'])
  await git(root, ['config', 'user.email', 'test@example.test'])
  await git(root, ['config', 'user.name', 'Worktree Test'])
  await writeFile(join(root, '.gitignore'), '.overlay\n')
  await writeFile(join(root, 'README.md'), '# fixture\n')
  await mkdir(join(root, '.overlay'), { recursive: true })
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(root, 'bin', 'hairness.mjs'), '')
  await git(root, ['add', '.gitignore', 'README.md', 'bin/hairness.mjs'])
  await git(root, ['commit', '-m', 'init'])
  const stored = new Map()
  const assertions = []
  const runs = new Map()
  const runtime = {
    contracts: { validateSchema: async (_schema, value) => value },
    distribution: {
      read: async () => ({ defaults: { worktrees: { placement: 'sibling', directorySuffix: '-worktrees', layout: '{type}/{slug}', enforcement: 'required', hooks: 'required', cleanup: 'checkpoint' } } }),
      preferences: async () => ({ worktrees: options.overrideRoot ? { root: options.overrideRoot } : {} }),
    },
    overlay: {
      read: async (key, fallback) => stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback),
      write: async (key, value) => (stored.set(key, structuredClone(value)), value),
      append: async () => null,
    },
    extensions: {
      call: async (owner, service, input) => {
        if (owner === 'hairness/session-intelligence' && service === 'current') return { id: 'session-one', limits: [] }
        if (owner === 'hairness/sources' && service === 'read') return { data: await sourceEvidence(input.operation, input.input) }
        throw new Error(`Unexpected service: ${owner}.${service}`)
      },
    },
    authority: { assert: async (runId, effect, target) => assertions.push({ runId, effect, target }) },
    runs: { read: async (id) => runs.get(id) ?? null },
  }
  return { root, runtime, stored, assertions, runs, cleanup: async () => rm(dirname(root).includes('hairness-worktree-controls-') ? root : root, { recursive: true, force: true }) }
}

function request(root, overrides = {}) {
  return { repository: { kind: 'workspace', root }, planId: 'change-one', sessionId: 'session-one', policyDigest, branch: 'feat/parallel-work', base: 'main', mode: 'branch', ...overrides }
}

test('open is idempotently proposed at sibling placement and creates one writer lease', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const first = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root) }, runtime: env.runtime })
  const same = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root) }, runtime: env.runtime })
  assert.equal(first.id, same.id)
  assert.match(first.targets.find((item) => !item.includes('://')), /hairness-worktree-controls-.*-worktrees\/feat\/parallel-work$/)
  assert.deepEqual(first.effects, ['filesystem:write', 'git:worktree', 'git:branch'])
  assert.deepEqual(first.limits, [])

  const executed = await services.execute({ root: env.root, input: { proposal: first.id, runId: 'run-open', checkpointId: 'checkpoint-open' }, runtime: env.runtime })
  assert.equal(executed.status, 'succeeded')
  assert.equal(executed.context.handleRef.id, first.request.worktreeId)
  assert.equal(executed.context.leaseRef.id.startsWith('lease-'), true)
  assert.equal((await realpath(join(executed.context.path, '.overlay'))), await realpath(join(env.root, '.overlay')))
  assert.equal(env.assertions.length, 3)

  const resolved = await services.resolve({ root: env.root, input: { ...request(env.root), worktreeId: first.request.worktreeId, requireWriter: true }, runtime: env.runtime })
  assert.equal(resolved.status, 'ready')
  assert.equal(resolved.handle.kind, 'branch')
  assert.equal(resolved.lease.state, 'active')
  assert.equal(resolved.digest, executed.context.handleRef.digest)

  await writeFile(join(resolved.context.path, 'change.txt'), 'changed\n')
  await git(resolved.context.path, ['add', 'change.txt'])
  await git(resolved.context.path, ['commit', '-m', 'test: change managed head'])
  const changed = await services.resolve({ root: env.root, input: { ...request(env.root), worktreeId: first.request.worktreeId, requireWriter: true }, runtime: env.runtime })
  assert.equal(changed.status, 'ready')
  assert.notEqual(changed.digest, executed.context.handleRef.digest)
  env.runs.set('run-managed-change', { assignment: { operation: { capability: 'example/delivery' }, targets: [changed.context.path], inputs: [{ checkoutContext: changed.context }] } })
  const [allowed] = await authorityPolicy({ root: env.root, input: { runId: 'run-managed-change', requestedEffects: ['filesystem:write', 'git:commit'] }, runtime: env.runtime, manifest: { id: 'hairness/worktree-controls' } })
  assert.deepEqual(allowed.deniedEffects, [])
  env.runs.get('run-managed-change').assignment.inputs = [{ checkoutContext: executed.context }]
  const [stale] = await authorityPolicy({ root: env.root, input: { runId: 'run-managed-change', requestedEffects: ['git:commit'] }, runtime: env.runtime, manifest: { id: 'hairness/worktree-controls' } })
  assert.deepEqual(stale.deniedEffects, ['git:commit'])

  const collision = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root) }, runtime: env.runtime })
  assert.ok(collision.limits.includes('plan-already-has-worktree'))
})

test('machine-local root override controls placement without entering shared state', async (context) => {
  const overrideRoot = await mkdtemp(join(tmpdir(), 'hairness-custom-worktrees-'))
  const env = await fixture({ overrideRoot }); context.after(async () => { await env.cleanup(); await rm(overrideRoot, { recursive: true, force: true }) })
  const proposal = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root, { branch: 'fix/custom-root' }) }, runtime: env.runtime })
  assert.equal(proposal.targets.find((item) => !item.includes('://')), join(overrideRoot, 'fix', 'custom-root'))
  assert.equal(JSON.stringify(env.stored.get('state.json')).includes(overrideRoot), true)
  assert.equal(proposal.request.repository.root, await realpath(env.root))
})

test('bootstrap adoption requests only target-mutation and supports explicit handoff and takeover', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const target = join(dirname(env.root), `${env.root.split('/').at(-1)}-bootstrap`)
  await git(env.root, ['worktree', 'add', '--lock', '--reason', 'hairness:run-bootstrap:bootstrap-plan', '-b', 'feat/bootstrap', target, 'main'])
  const adoptRequest = request(env.root, { planId: 'bootstrap-plan', branch: 'feat/bootstrap', path: target, bootstrap: true })
  const proposal = await services.propose({ root: env.root, input: { action: 'adopt', request: adoptRequest }, runtime: env.runtime })
  assert.deepEqual(proposal.effects, ['target-mutation'])
  assert.deepEqual(proposal.limits, [], JSON.stringify(await sourceEvidence('worktrees', { path: env.root })))
  const adopted = await services.execute({ root: env.root, input: { proposal: proposal.id, runId: 'run-bootstrap', checkpointId: 'checkpoint-bootstrap' }, runtime: env.runtime })
  assert.equal(adopted.status, 'succeeded')
  assert.equal(env.assertions[0].effect, 'target-mutation')

  const handoffRequest = { ...adoptRequest, worktreeId: adopted.context.handleRef.id, targetSessionId: 'session-two' }
  const handoff = await services.propose({ root: env.root, input: { action: 'handoff', request: handoffRequest }, runtime: env.runtime })
  const handed = await services.execute({ root: env.root, input: { proposal: handoff.id, runId: 'run-handoff', checkpointId: 'checkpoint-handoff' }, runtime: env.runtime })
  assert.equal(handed.status, 'succeeded')
  assert.notEqual(handed.context.leaseRef.id, adopted.context.leaseRef.id)

  const takeoverRequest = { ...adoptRequest, worktreeId: adopted.context.handleRef.id, sessionId: 'session-three', reason: 'The prior provider session is stale.', proof: ['session:stale'] }
  const takeover = await services.propose({ root: env.root, input: { action: 'takeover', request: takeoverRequest }, runtime: env.runtime })
  assert.deepEqual(takeover.limits, [])
  const taken = await services.execute({ root: env.root, input: { proposal: takeover.id, runId: 'run-takeover', checkpointId: 'checkpoint-takeover' }, runtime: env.runtime })
  assert.equal(taken.status, 'succeeded')
  const resolved = await services.resolve({ root: env.root, input: { ...takeoverRequest, requireWriter: true }, runtime: env.runtime })
  assert.equal(resolved.lease.sessionId, 'session-three')

  const normalTarget = join(dirname(env.root), `${env.root.split('/').at(-1)}-normal-adopt`)
  await git(env.root, ['worktree', 'add', '-b', 'fix/normal-adopt', normalTarget, 'main'])
  const normal = await services.propose({ root: env.root, input: { action: 'adopt', request: request(env.root, { planId: 'normal-adopt', branch: 'fix/normal-adopt', path: normalTarget }) }, runtime: env.runtime })
  assert.deepEqual(normal.effects, ['filesystem:write', 'git:worktree'])
  assert.ok(!normal.proof.includes('bootstrap:explicit-target-mutation-compatibility'))
})

test('close never force-removes a dirty checkout and succeeds after fresh clean proof', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const opened = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root) }, runtime: env.runtime })
  const created = await services.execute({ root: env.root, input: { proposal: opened.id, runId: 'run-open', checkpointId: 'checkpoint-open' }, runtime: env.runtime })
  await writeFile(join(created.context.path, 'dirty.txt'), 'dirty\n')

  const closeRequest = request(env.root, { worktreeId: created.context.handleRef.id, expectedHead: created.context.head })
  const closing = await services.propose({ root: env.root, input: { action: 'close', request: closeRequest }, runtime: env.runtime })
  const refused = await services.execute({ root: env.root, input: { proposal: closing.id, runId: 'run-close-dirty', checkpointId: 'checkpoint-close-dirty' }, runtime: env.runtime })
  assert.equal(refused.status, 'failed')
  assert.match(refused.summary, /dirty/)
  await realpath(created.context.path)

  await unlink(join(created.context.path, 'dirty.txt'))
  const retry = await services.propose({ root: env.root, input: { action: 'close', request: closeRequest }, runtime: env.runtime })
  assert.deepEqual(retry.limits, [])
  const closed = await services.execute({ root: env.root, input: { proposal: retry.id, runId: 'run-close-clean', checkpointId: 'checkpoint-close-clean' }, runtime: env.runtime })
  assert.equal(closed.status, 'succeeded')
  await assert.rejects(realpath(created.context.path))
})

test('authority policy denies Git effects without a managed checkout context', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  env.runs.set('run-unmanaged', { assignment: { operation: { capability: 'example/delivery' }, targets: [env.root], inputs: [] } })
  const [policy] = await authorityPolicy({ root: env.root, input: { runId: 'run-unmanaged', requestedEffects: ['git:push', 'filesystem:write'] }, runtime: env.runtime, manifest: { id: 'hairness/worktree-controls' } })
  assert.deepEqual(policy.deniedEffects, ['git:push', 'filesystem:write'])
  assert.deepEqual(policy.allowedEffects, [])
  assert.ok(policy.reasons.includes('managed-worktree-context-missing'))
})

test('authority policy permits only the exact locked bootstrap target', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const target = join(dirname(env.root), `${env.root.split('/').at(-1)}-policy-bootstrap`)
  await git(env.root, ['worktree', 'add', '--lock', '--reason', 'hairness:run-bootstrap:bootstrap-plan', '-b', 'feat/policy-bootstrap', target, 'main'])
  env.runs.set('run-bootstrap', {
    id: 'run-bootstrap',
    planId: 'bootstrap-plan',
    assignment: {
      operation: { capability: 'hairness/work' },
      targets: [await realpath(target), 'github://example/widget/branches/feat/policy-bootstrap'],
      inputs: [{ branch: 'feat/policy-bootstrap' }],
    },
  })
  const [allowed] = await authorityPolicy({ root: env.root, input: { runId: 'run-bootstrap', requestedEffects: ['target-mutation'] }, runtime: env.runtime, manifest: { id: 'hairness/worktree-controls' } })
  assert.deepEqual(allowed.deniedEffects, [])
  assert.ok(allowed.reasons.includes('exact-locked-bootstrap-worktree'))

  env.runs.get('run-bootstrap').assignment.inputs[0].branch = 'feat/other'
  const [denied] = await authorityPolicy({ root: env.root, input: { runId: 'run-bootstrap', requestedEffects: ['target-mutation'] }, runtime: env.runtime, manifest: { id: 'hairness/worktree-controls' } })
  assert.deepEqual(denied.deniedEffects, ['target-mutation'])
})

test('unknown effects require live reconciliation before a safe retry', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const opened = await services.propose({ root: env.root, input: { action: 'open', request: request(env.root) }, runtime: env.runtime })
  const created = await services.execute({ root: env.root, input: { proposal: opened.id, runId: 'run-open', checkpointId: 'checkpoint-open' }, runtime: env.runtime })
  const value = env.stored.get('state.json')
  value.receipts.push({ ...created, id: 'receipt-sync-unknown', proposalId: 'proposal-sync-unknown', action: 'sync', status: 'unknown', summary: 'Sync result unknown.', runId: 'run-sync', checkpointId: 'checkpoint-sync', effects: ['git:rebase'], proof: ['transport:timeout'], limits: ['reconciliation-required-before-retry'], observedAt: new Date().toISOString(), checkoutContext: undefined })
  env.stored.set('state.json', value)
  const syncRequest = request(env.root, { worktreeId: created.context.handleRef.id, expectedHead: created.context.head })
  const blocked = await services.propose({ root: env.root, input: { action: 'sync', request: syncRequest }, runtime: env.runtime })
  assert.ok(blocked.limits.includes('reconciliation-required:receipt-sync-unknown'))

  const reconciled = await handleCommand({ root: env.root, target: 'reconcile', flags: { id: created.context.handleRef.id, plan: 'change-one', session: 'session-one', policy: policyDigest, reason: 'The rebase did not start.', proof: 'effect:not-applied' }, runtime: env.runtime })
  assert.equal(reconciled.status, 'ready')
  assert.equal(reconciled.reconciliation.decision, 'safe-retry')
  const retry = await services.propose({ root: env.root, input: { action: 'sync', request: syncRequest }, runtime: env.runtime })
  assert.ok(!retry.limits.some((item) => item.startsWith('reconciliation-required:')))
})

test('doctor classifies unknown registered checkouts without adopting them', async (context) => {
  const env = await fixture(); context.after(env.cleanup)
  const target = join(dirname(env.root), `${env.root.split('/').at(-1)}-unknown`)
  await git(env.root, ['worktree', 'add', '-b', 'fix/unknown', target, 'main'])
  const dashboard = await services.inspect({ root: env.root, input: {}, runtime: env.runtime })
  const canonicalTarget = await realpath(target)
  const unknown = dashboard.worktrees.find((item) => resolve(item.path) === canonicalTarget)
  assert.ok(unknown, JSON.stringify(dashboard.worktrees))
  assert.equal(unknown.classification, 'unmanaged')
  assert.equal(dashboard.handles.length, 0)
})
