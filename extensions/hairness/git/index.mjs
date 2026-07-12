import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const exec = promisify(execFile)

async function run(args) {
  const result = await exec('git', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
  return result.stdout.trim()
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
  return { path, branch, upstream, ahead, behind, dirty: changes.length, changes }
}

export const sourceOperations = {
  async identity({ root, input }) {
    const path = resolve(input.path ?? root)
    return { path, root: await run(['-C', path, 'rev-parse', '--show-toplevel']), remote: await run(['-C', path, 'remote', 'get-url', 'origin']) }
  },
  status: ({ root, input }) => status(root, input),
  async overlap({ root, input }) {
    const state = await status(root, input)
    const targets = input.targets ?? []
    return { ...state, targets, overlap: state.changes.filter((line) => targets.some((target) => line.slice(3).startsWith(target))) }
  },
}

export async function sessionContributions({ root, manifest }) {
  const value = await status(root, {}).catch(() => null)
  const data = value ? { branch: value.branch, upstream: value.upstream, ahead: value.ahead, behind: value.behind, dirty: value.dirty } : {}
  return [{ owner: manifest.id, section: 'git', priority: 70, summary: value ? `${value.branch}${value.dirty ? ` · ${value.dirty} dirty` : ''}${value.ahead ? ` · ${value.ahead} ahead` : ''}` : 'Git status unavailable.', data, routes: [], limits: value ? [] : ['git-status-unavailable'], freshness: new Date().toISOString(), byteSize: 0 }]
}
