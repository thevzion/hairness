import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'

export async function run({ root }) {
  const home = JSON.parse(await readFile(join(root, 'hairness.json'), 'utf8'))
  const sources = home.spec.config['hairness/sources']?.sources ?? []
  return Promise.all(sources.map(async (source) => ({
    id: source.id,
    requirement: source.requirement,
    candidates: await Promise.all(source.accessors.map(async (accessor) => {
      if (accessor.kind !== 'cli') return { ...accessor, available: null, limit: 'provider-confirmation-required' }
      const path = await find(accessor.command)
      return { ...accessor, path, available: Boolean(path) }
    })),
  })))
}

async function find(command) {
  for (const directory of String(process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(directory, command)
    if (await access(path, constants.X_OK).then(() => true).catch(() => false)) return path
  }
  return null
}
