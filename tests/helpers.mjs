import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeItem(root, item, files = {}) {
  await mkdir(root, { recursive: true })
  const document = { $schema: 'https://hairness.dev/schema/registry-item.json', registry: item.registry ?? 'fixture', ...item }
  delete document.registry
  document.registry = item.registry ?? 'fixture'
  const path = join(root, `${item.name}.json`)
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
  for (const [name, content] of Object.entries(files)) {
    const destination = join(root, name)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
  return path
}

export function extension(overrides = {}) {
  return {
    name: 'review',
    version: '1.0.0',
    type: 'hairness:extension',
    title: 'Review',
    description: 'Review agentic assets.',
    registryDependencies: [],
    files: [{ path: 'skills/review/SKILL.md', type: 'hairness:skill', id: 'review', description: 'Review a subject.' }],
    ...overrides,
  }
}
