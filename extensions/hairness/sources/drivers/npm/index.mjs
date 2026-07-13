import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const defaultRegistry = 'https://registry.npmjs.org/'

function registry(input) {
  const value = new URL(input.registry ?? defaultRegistry)
  if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password || value.search) throw new Error('registry must be a credential-free HTTP(S) URL')
  return value.href
}

function packageName(input) {
  if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(input.package ?? '')) throw new Error('invalid package name')
  return input.package
}

function organization(input) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(input.organization ?? '')) throw new Error('invalid organization name')
  return input.organization
}

async function npm(args, input, allowMissing = false) {
  try {
    const { stdout } = await exec('npm', [...args, '--registry', registry(input)], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
    return stdout.trim() ? JSON.parse(stdout) : null
  } catch (error) {
    if (allowMissing && (error.stderr?.includes('E404') || error.stdout?.includes('E404'))) return null
    throw error
  }
}

function spec(input) {
  const name = packageName(input)
  if (!input.version) throw new Error('version is required')
  return `${name}@${input.version}`
}

export const operations = {
  identity: async ({ input }) => ({ username: await npm(['whoami', '--json'], input), registry: registry(input) }),
  organization: ({ input }) => npm(['org', 'ls', organization(input), '--json'], input),
  owners: ({ input }) => npm(['view', packageName(input), 'maintainers', '--json'], input),
  version: async ({ input }) => {
    const value = await npm(['view', spec(input), 'name', 'version', '--json'], input, true)
    return { package: packageName(input), version: input.version, exists: value !== null, value }
  },
  'dist-tags': ({ input }) => npm(['view', packageName(input), 'dist-tags', '--json'], input),
  integrity: async ({ input }) => ({ package: packageName(input), version: input.version, ...await npm(['view', spec(input), 'dist.integrity', 'dist.shasum', 'dist.tarball', '--json'], input) }),
}
