import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function gh(args) {
  const { stdout } = await exec('gh', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout) : null
}

function repository(input) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository ?? '')) throw new Error('repository must be owner/name')
  return input.repository
}

async function pullRequest(input, fields) {
  const repo = repository(input)
  const selector = input.number ? String(input.number) : input.head
  if (!selector) throw new Error('pull-request evidence requires number or head')
  return gh(['pr', 'view', selector, '--repo', repo, '--json', fields])
}

export const operations = {
  identity: () => gh(['api', 'user', '--jq', '{login:.login,id:.id,name:.name,url:.html_url}']),
  repository: ({ input }) => gh(['repo', 'view', repository(input), '--json', 'nameWithOwner,url,defaultBranchRef,deleteBranchOnMerge,mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed']),
  'pull-request': ({ input }) => pullRequest(input, 'number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,mergeStateStatus,reviewDecision,mergedAt,mergeCommit'),
  checks: ({ input }) => pullRequest(input, 'number,url,headRefOid,statusCheckRollup'),
  protections: async ({ input }) => {
    const repo = repository(input)
    const branch = input.branch ?? 'main'
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('invalid branch')
    const value = await gh(['api', `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`])
    return { repository: repo, branch, protection: value }
  },
  'merged-pull-requests': async ({ input }) => {
    const repo = repository(input)
    const values = await gh(['pr', 'list', '--repo', repo, '--state', 'merged', '--base', input.base ?? 'main', '--limit', String(input.limit ?? 100), '--json', 'number,title,body,url,mergedAt,mergeCommit,headRefName,labels'])
    let since = input.since ?? null
    if (!since && input.baseline) since = (await gh(['api', `repos/${repo}/commits/${encodeURIComponent(input.baseline)}`, '--jq', '{date:.commit.committer.date}'])).date
    const pullRequests = (since ? values.filter((item) => Date.parse(item.mergedAt) > Date.parse(since)) : values).map((item) => {
      const releaseImpact = /(?:^|\n)releaseImpact:\s*(user|internal|none)(?:\n|$)/i.exec(item.body ?? '')?.[1]?.toLowerCase() ?? null
      const { body, ...proof } = item
      return { ...proof, releaseImpact }
    })
    return { repository: repo, baseline: input.baseline ?? null, since, pullRequests }
  },
}
