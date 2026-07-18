import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { HairnessError } from './lib/errors.mjs'

const exec = promisify(execFile)

export async function git(args, options = {}) {
  try {
    const result = await exec('git', args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    })
    return options.trim === false ? result.stdout : result.stdout.trim()
  } catch (error) {
    throw new HairnessError('git_failed', `git ${args.join(' ')} failed: ${error.stderr?.trim() || error.message}`, {
      exitCode: 4,
      details: { args, cwd: options.cwd, stderr: error.stderr?.trim() },
      cause: error,
    })
  }
}

export async function inspectRepository(path) {
  const root = await git(['rev-parse', '--show-toplevel'], { cwd: path })
  const [head, branch, status, remoteOutput] = await Promise.all([
    git(['rev-parse', 'HEAD'], { cwd: root }),
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root }).catch(() => null),
    git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], { cwd: root, trim: false }),
    git(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: root }).catch(() => ''),
  ])
  const remotes = remoteOutput.split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf(' ')
    const name = line.slice(0, separator).replace(/^remote\./, '').replace(/\.url$/, '')
    const url = line.slice(separator + 1).trim()
    return { name, url, repository: normalizeRepository(url) }
  })
  const changes = status.split('\n').filter((line) => /^(1 |2 |u |\? )/.test(line))
  return { root, head, branch, detached: !branch, clean: changes.length === 0, changes, remotes }
}

export function normalizeRepository(value) {
  let source = String(value).trim()
  const scp = source.match(/^(?:[^@]+@)?([^:/]+):(.+)$/)
  if (scp && !source.includes('://')) source = `ssh://${scp[1]}/${scp[2]}`
  try {
    const url = new URL(source)
    return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase()}`
  } catch {
    return source.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase()
  }
}
