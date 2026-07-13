import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const policy = JSON.parse(await readFile(new URL('hairness.json', root), 'utf8')).defaults.delivery

export function validateDeliveryPullRequest({ title, head, base }, value = policy) {
  assert.equal(base, value.baseBranch, `pull request base must be ${value.baseBranch}`)
  assert.ok(!head.startsWith('codex/'), 'provider-prefixed branches are not part of the delivery policy')
  assert.match(head, new RegExp(value.branchPattern), `invalid delivery branch: ${head}`)
  const match = /^(feat|fix|docs|refactor|perf|test|build|ci|chore|release)(?:\(([a-z0-9-]+)\))?!?:\s+.+$/.exec(title)
  assert.ok(match, `non-conventional pull request title: ${title}`)
  assert.ok(value.branchTypes.includes(match[1]), `unsupported pull request type: ${match[1]}`)
  const branchType = head.split('/')[0]
  assert.ok(match[1] === branchType || (branchType === 'release' && match[1] === 'chore' && match[2] === 'release'), `pull request type ${match[1]} does not match branch type ${branchType}`)
  return { title, head, base, type: match[1], scope: match[2] ?? null }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDeliveryPullRequest({ title: process.env.PR_TITLE ?? '', head: process.env.PR_HEAD_REF ?? '', base: process.env.PR_BASE_REF ?? '' })
  console.log('Delivery policy gate passed')
}
