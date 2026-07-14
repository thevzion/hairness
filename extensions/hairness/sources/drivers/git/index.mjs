import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const exec = promisify(execFile)
async function run(args, { trim = true } = {}) {
  const output = (await exec('git', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })).stdout
  return trim ? output.trim() : output
}

function field(value) {
  const separator = value.indexOf(' ')
  return separator === -1 ? [value, ''] : [value.slice(0, separator), value.slice(separator + 1)]
}

function isMovedReason(reason) {
  return /(?:non-existent location|worktree.*moved|moved.*worktree)/i.test(reason ?? '')
}

export function parseWorktreePorcelain(output) {
  const worktrees = []
  let value = null
  const finish = () => {
    if (!value) return
    if (!value.path || !value.head) throw new Error('Incomplete Git worktree evidence.')
    value.moved ||= isMovedReason(value.prunableReason)
    worktrees.push(value)
    value = null
  }

  for (const raw of output.split('\0')) {
    if (!raw) {
      finish()
      continue
    }
    const [name, detail] = field(raw)
    if (name === 'worktree') {
      finish()
      value = {
        path: detail,
        head: null,
        branch: null,
        branchRef: null,
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
        moved: false,
      }
      continue
    }
    if (!value) throw new Error(`Git worktree field ${name} appeared before worktree.`)
    if (name === 'HEAD') value.head = detail
    else if (name === 'branch') {
      value.branchRef = detail
      value.branch = detail.startsWith('refs/heads/') ? detail.slice('refs/heads/'.length) : detail
    } else if (name === 'detached') value.detached = true
    else if (name === 'bare') value.bare = true
    else if (name === 'locked') {
      value.locked = true
      value.lockReason = detail || null
    } else if (name === 'prunable') {
      value.prunable = true
      value.prunableReason = detail || null
    } else if (name === 'moved') value.moved = true
  }
  finish()
  return worktrees
}

async function resolveCommit(path, revision) {
  return run(['-C', path, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
}

async function isAncestor(path, ancestor, descendant) {
  try {
    await exec('git', ['-C', path, 'merge-base', '--is-ancestor', ancestor, descendant], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
    return true
  } catch (error) {
    if (error.code === 1) return false
    throw error
  }
}
async function status(root, input) {
  const path = resolve(input.path ?? root)
  const [branch, upstream, porcelain, divergence] = await Promise.all([
    run(['-C', path, 'branch', '--show-current']),
    run(['-C', path, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => null),
    run(['-C', path, 'status', '--porcelain=v1']),
    run(['-C', path, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).catch(() => null),
  ])
  const changes = porcelain ? porcelain.split('\n').filter(Boolean) : []
  const [ahead = null, behind = null] = divergence?.split(/\s+/).map(Number) ?? []
  return { path, branch: branch || 'HEAD', upstream, ahead, behind, dirty: changes.length, changes }
}

export const operations = {
  async identity({ root, input }) {
    const path = resolve(input.path ?? root)
    return { path, root: await run(['-C', path, 'rev-parse', '--show-toplevel']), remote: await run(['-C', path, 'remote', 'get-url', 'origin']) }
  },
  status: ({ root, input }) => status(root, input),
  async overlap({ root, input }) {
    const value = await status(root, input)
    const targets = input.targets ?? []
    return { ...value, targets, overlap: value.changes.filter((line) => targets.some((target) => line.slice(3).startsWith(target))) }
  },
  async worktrees({ root, input }) {
    const path = resolve(input.path ?? root)
    const [commonDir, porcelain] = await Promise.all([
      run(['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir']),
      run(['-C', path, 'worktree', 'list', '--porcelain', '-z'], { trim: false }),
    ])
    const worktrees = parseWorktreePorcelain(porcelain)
    const repositoryRoot = worktrees[0]?.path
    if (!repositoryRoot) throw new Error('Git returned no primary worktree evidence.')
    return { path, repositoryRoot, commonDir, worktrees }
  },
  async refs({ root, input }) {
    const path = resolve(input.path ?? root)
    const headRef = input.head ?? 'HEAD'
    const baseRef = input.base ?? 'origin/main'
    const [head, base, branch] = await Promise.all([
      resolveCommit(path, headRef),
      resolveCommit(path, baseRef),
      run(['-C', path, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null),
    ])
    const mergeBase = await run(['-C', path, 'merge-base', head, base])
    return { path, headRef, head, branch, baseRef, base, mergeBase }
  },
  async 'merge-proof'({ root, input }) {
    const path = resolve(input.path ?? root)
    const headRef = input.head ?? 'HEAD'
    const baseRef = input.base ?? 'origin/main'
    const [head, base] = await Promise.all([resolveCommit(path, headRef), resolveCommit(path, baseRef)])
    const mergeBase = await run(['-C', path, 'merge-base', head, base])
    const [baseIsAncestorOfHead, headIsAncestorOfBase] = await Promise.all([
      isAncestor(path, base, head),
      isAncestor(path, head, base),
    ])
    return {
      path,
      headRef,
      head,
      baseRef,
      base,
      mergeBase,
      baseIsAncestorOfHead,
      headIsAncestorOfBase,
      isIntegrated: headIsAncestorOfBase,
    }
  },
}
