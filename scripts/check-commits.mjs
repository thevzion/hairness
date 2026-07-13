import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const range = process.env.GITHUB_BASE_REF ? [`origin/${process.env.GITHUB_BASE_REF}..HEAD`] : ['-20']
const { stdout } = await exec('git', ['-C', root, 'log', '--no-merges', ...range, '--format=%s'], { encoding: 'utf8' })
const pattern = /^(?:feat|fix|docs|refactor|test|chore|build|ci|perf|release|revert)(?:\([a-z0-9-]+\))?!?: .+$/
const subjects = stdout.trim().split('\n').filter(Boolean)
if (process.env.GITHUB_BASE_REF) assert.ok(subjects.length > 0, 'pull request commit range is empty')
for (const subject of subjects) assert.match(subject, pattern, `non-conventional commit: ${subject}`)
console.log('Conventional Commit gate passed')
