import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { HairnessError } from '../lib/errors.mjs'

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

export async function inspectGit(path) {
  const [root, head, branch, status] = await Promise.all([
    git(['rev-parse', '--show-toplevel'], { cwd: path }),
    git(['rev-parse', 'HEAD'], { cwd: path }),
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: path }).catch(() => null),
    git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], { cwd: path, trim: false }),
  ])
  const changes = status.split('\n').filter((line) => /^(1 |2 |u |\? )/.test(line))
  return { root, head, branch, detached: !branch, clean: changes.length === 0, changes, porcelain: status }
}

