import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
async function run(args) {
  const value = (await exec(process.env.HAIRNESS_AWS_BIN ?? 'aws', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim()
  try { return JSON.parse(value) } catch { return value }
}

export const sourceOperations = {
  version: () => run(['--version']),
  async profiles() { return String(await run(['configure', 'list-profiles'])).split('\n').filter(Boolean) },
  identity: ({ input }) => run(['sts', 'get-caller-identity', '--output', 'json', ...(input.profile ? ['--profile', input.profile] : [])]),
}
