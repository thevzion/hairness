import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url).pathname

export async function renderExtensionCatalog(repository = root) {
  const recipes = new Map()
  for (const name of await readdir(join(repository, 'catalog'))) {
    if (!name.endsWith('.json')) continue
    const value = JSON.parse(await readFile(join(repository, 'catalog', name), 'utf8'))
    if (value.extensions) recipes.set(value.id, new Set(value.extensions))
  }
  const values = []
  for (const owner of await readdir(join(repository, 'extensions'))) {
    for (const name of await readdir(join(repository, 'extensions', owner))) {
      const value = JSON.parse(await readFile(join(repository, 'extensions', owner, name, 'extension.json'), 'utf8'))
      values.push(value)
    }
  }
  values.sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id))
  const lines = [
    '# Extension catalog',
    '',
    'This matrix is generated from extension manifests. Categories organize discovery; they never change extension IDs or source paths.',
    '',
    '| Extension | Category | Summary | Maturity | Minimal | Standard | Forge |',
    '|---|---|---|---|:---:|:---:|:---:|',
  ]
  for (const value of values) lines.push(`| \`${value.id}\` | ${value.category} | ${value.summary} | ${value.maturity} | ${recipes.get('minimal')?.has(value.id) ? 'yes' : 'no'} | ${recipes.get('standard')?.has(value.id) ? 'yes' : 'no'} | ${recipes.get('forge')?.has(value.id) ? 'yes' : 'no'} |`)
  lines.push('', 'Official means maintained by the Hairness project. Verified means protocol conformance for a pinned version, not automatic trust or authority.', '')
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = join(root, 'docs', 'extensions', 'catalog.md')
  const rendered = await renderExtensionCatalog(root)
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== rendered) throw new Error('Extension catalog is stale. Run npm run catalog.')
  } else await writeFile(target, rendered)
}
