import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
async function run(path, extra = []) {
  const value = (await exec(process.env.HAIRNESS_GITLAB_BIN ?? 'glab', ['api', path, ...extra], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim()
  try { return JSON.parse(value) } catch { return value }
}

function mrPath(input, suffix = '') {
  return `projects/${encodeURIComponent(input.project)}/merge_requests/${input.iid}${suffix}`
}

export const sourceOperations = {
  identity: () => run('user'),
  project: ({ input }) => run(`projects/${encodeURIComponent(input.project)}`),
  mr: ({ input }) => run(mrPath(input)),
  discussions: ({ input }) => run(mrPath(input, '/discussions')),
  approvals: ({ input }) => run(mrPath(input, '/approvals')),
  pipelines: ({ input }) => run(`projects/${encodeURIComponent(input.project)}/pipelines`, ['--paginate']),
}
