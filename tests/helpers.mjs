import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeExtension(root, manifest = extension(), files = {}) {
  await mkdir(root, { recursive: true })
  const path = join(root, 'hairness.json')
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [name, content] of Object.entries(files)) {
    const destination = join(root, name)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
  return path
}

export function extension(overrides = {}) {
  return {
    $schema: 'https://hairness.dev/schema/extension.json',
    name: 'fixture/review',
    version: '1.0.0',
    description: 'Review agentic assets.',
    files: [{ path: 'skills/review/SKILL.md', type: 'hairness:skill', id: 'review', description: 'Review a subject.' }],
    ...overrides,
  }
}
