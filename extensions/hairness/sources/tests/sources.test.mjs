import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { services } from '../index.mjs'
import { operations as gitOperations, parseWorktreePorcelain } from '../drivers/git/index.mjs'

const exec = promisify(execFile)

const manifest = JSON.parse(await readFile(new URL('../extension.json', import.meta.url), 'utf8'))
const runtime = {
  contracts: { validate: async (_name, value) => value },
  distribution: { read: async () => ({ sources: [{ id: 'git', requirement: 'required' }] }) },
}

test('sources expose only drivers selected by the distribution', async () => {
  const values = await services.list({ manifest, runtime })
  assert.deepEqual(values.map((value) => value.id), ['git'])
  assert.ok(values[0].operations.some((operation) => operation.id === 'status'))
  assert.ok(values[0].operations.some((operation) => operation.id === 'worktrees'))
  assert.ok(values[0].operations.some((operation) => operation.id === 'merge-proof'))
})

test('git worktree porcelain parser preserves locked, detached, prunable and moved evidence', () => {
  const output = [
    'worktree /repo',
    `HEAD ${'1'.repeat(40)}`,
    'branch refs/heads/feat/one',
    'locked hairness:worktree-1:plan-1',
    '',
    'worktree /repo-detached',
    `HEAD ${'2'.repeat(40)}`,
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /repo-moved',
    `HEAD ${'3'.repeat(40)}`,
    'detached',
    'moved',
    '',
  ].join('\0')

  const values = parseWorktreePorcelain(output)
  assert.equal(values.length, 3)
  assert.deepEqual(values[0], {
    path: '/repo',
    head: '1'.repeat(40),
    branch: 'feat/one',
    branchRef: 'refs/heads/feat/one',
    detached: false,
    bare: false,
    locked: true,
    lockReason: 'hairness:worktree-1:plan-1',
    prunable: false,
    prunableReason: null,
    moved: false,
  })
  assert.equal(values[1].detached, true)
  assert.equal(values[1].prunable, true)
  assert.equal(values[1].moved, true)
  assert.equal(values[2].moved, true)
})

test('git status gives a detached checkout a stable branch label', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-git-source-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await exec('git', ['init', root])
  await writeFile(join(root, 'README.md'), 'fixture\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture'])
  await exec('git', ['-C', root, 'checkout', '--detach'])

  const value = await gitOperations.status({ root, input: {} })
  assert.equal(value.branch, 'HEAD')
})

test('git worktree evidence is NUL-safe and resolves the shared common directory', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-git-worktrees-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await exec('git', ['init', root])
  await writeFile(join(root, 'README.md'), 'fixture\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture'])

  const evidence = await services.read({ root, manifest, runtime, input: { source: 'git', operation: 'worktrees' } })
  const canonicalRoot = await realpath(root)
  assert.equal(evidence.source, 'git')
  assert.equal(evidence.operation, 'worktrees')
  assert.equal(evidence.data.repositoryRoot, canonicalRoot)
  assert.equal(evidence.data.commonDir, join(canonicalRoot, '.git'))
  assert.equal(evidence.data.worktrees.length, 1)
  assert.equal(evidence.data.worktrees[0].path, canonicalRoot)
  assert.equal(evidence.data.worktrees[0].detached, false)
})

test('git worktree evidence keeps the primary checkout as repository root from a linked checkout', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-git-linked-root-'))
  const linked = `${root}-linked`
  context.after(() => Promise.all([
    rm(linked, { recursive: true, force: true }),
    rm(root, { recursive: true, force: true }),
  ]))
  await exec('git', ['init', root])
  await writeFile(join(root, 'README.md'), 'fixture\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture'])
  await exec('git', ['-C', root, 'worktree', 'add', '-b', 'feat/linked-root', linked])

  const evidence = await gitOperations.worktrees({ root: linked, input: {} })
  assert.equal(evidence.repositoryRoot, await realpath(root))
  assert.equal(evidence.path, linked)
  assert.equal(evidence.worktrees[1].path, await realpath(linked))
})

test('git refs and merge proofs use exact resolved commits', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-git-refs-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await exec('git', ['init', root])
  await writeFile(join(root, 'README.md'), 'one\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'one'])
  await writeFile(join(root, 'README.md'), 'two\n')
  await exec('git', ['-C', root, 'add', '.'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'two'])

  const refs = await gitOperations.refs({ root, input: { base: 'HEAD~1' } })
  assert.match(refs.head, /^[0-9a-f]{40}$/)
  assert.match(refs.base, /^[0-9a-f]{40}$/)
  assert.equal(refs.mergeBase, refs.base)

  const ahead = await gitOperations['merge-proof']({ root, input: { base: 'HEAD~1' } })
  assert.equal(ahead.baseIsAncestorOfHead, true)
  assert.equal(ahead.headIsAncestorOfBase, false)
  assert.equal(ahead.isIntegrated, false)

  const integrated = await gitOperations['merge-proof']({ root, input: { head: 'HEAD~1', base: 'HEAD' } })
  assert.equal(integrated.baseIsAncestorOfHead, false)
  assert.equal(integrated.headIsAncestorOfBase, true)
  assert.equal(integrated.isIntegrated, true)
})
