import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildProviders } from '../src/providers/compiler.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
await buildProviders(root, { check: true })
const manifest = JSON.parse(await readFile(join(root, 'hairness.build.json'), 'utf8'))
assert.deepEqual(manifest.providers, ['codex', 'claude'])
assert.equal(new Set(manifest.commands.map((command) => command.name)).size, manifest.commands.length, 'provider command collision')
for (const command of manifest.commands) {
  const codex = join(root, '.agents/skills', command.name, 'SKILL.md')
  const claude = join(root, '.claude/skills', command.name, 'SKILL.md')
  await access(codex)
  await access(claude)
  const content = await readFile(codex, 'utf8')
  assert.ok(Buffer.byteLength(content) <= (command.name === 'hairness' ? 2048 : 1024), `${command.name} exceeds its instruction budget`)
}
const producer = await readFile(join(root, '.codex/agents/hairness-producer.toml'), 'utf8')
assert.match(producer, /Do not load the main-session cockpit/)
assert.match(producer, /Never mutate a target codebase/)
console.log(`provider projection gate passed (${manifest.commands.length} commands, Codex/Claude)`)
