import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
async function run(args) {
  const value = (await exec(process.env.HAIRNESS_JIRA_BIN ?? 'jira', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim()
  try { return JSON.parse(value) } catch { return value }
}

export const sourceOperations = {
  identity: () => run(['me']),
  issue: ({ input }) => run(['issue', 'view', input.key, '--raw']),
  jql: ({ input }) => run(['issue', 'list', '--jql', input.jql, '--raw']),
  children: ({ input }) => run(['issue', 'list', '--jql', `parent = ${input.key}`, '--raw']),
  epic: ({ input }) => run(['issue', 'view', input.key, '--raw']),
}
