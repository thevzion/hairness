import test from 'node:test'
import assert from 'node:assert/strict'
import { access, cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildProviders, cleanProviders } from '../src/providers/compiler.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

test('provider compiler emits the same active command set for Codex and Claude', async () => {
  await buildProviders(root, { check: true })
  const manifest = JSON.parse(await readFile(join(root, 'hairness.build.json')))
  assert.equal(manifest.commands.length, 30)
  assert.equal(new Set(manifest.commands.map((command) => command.name)).size, 30)
  for (const command of manifest.commands) {
    await access(join(root, '.agents/skills', command.name, 'SKILL.md'))
    await access(join(root, '.claude/skills', command.name, 'SKILL.md'))
  }
  await assert.rejects(access(join(root, '.codex-plugin')))
  await assert.rejects(access(join(root, '.claude-plugin')))
})

test('managed projection drift is detected before overwrite', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'hairness-provider-drift-'))
  for (const entry of ['extensions', 'schemas', 'src', 'hairness.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true })
  await writeFile(join(fixture, 'AGENTS.md'), '# Human content\n')
  await buildProviders(fixture, { provider: 'codex' })
  const skill = join(fixture, '.agents/skills/hairness-help/SKILL.md')
  await writeFile(skill, `${await readFile(skill, 'utf8')}\nHuman edit.\n`)
  await assert.rejects(buildProviders(fixture, { provider: 'codex' }), (error) => error.code === 'review_required')
  assert.match(await readFile(join(fixture, 'AGENTS.md'), 'utf8'), /Human content/)
})

test('managed TOML and JSON preserve foreign project configuration', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'hairness-provider-merge-'))
  for (const entry of ['extensions', 'schemas', 'src', 'hairness.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true })
  await writeFile(join(fixture, 'AGENTS.md'), '# Human content\n')
  await (await import('node:fs/promises')).mkdir(join(fixture, '.codex'), { recursive: true })
  await (await import('node:fs/promises')).mkdir(join(fixture, '.claude'), { recursive: true })
  await writeFile(join(fixture, '.codex/config.toml'), '[features]\nhooks = true\n')
  await writeFile(join(fixture, '.codex/hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo human' }] }] }, foreign: true }, null, 2))
  await writeFile(join(fixture, '.claude/settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'] } }, null, 2))
  await buildProviders(fixture)
  assert.match(await readFile(join(fixture, '.codex/config.toml'), 'utf8'), /\[features\][\s\S]*hairness:begin/)
  assert.equal(JSON.parse(await readFile(join(fixture, '.codex/hooks.json'))).foreign, true)
  assert.deepEqual(JSON.parse(await readFile(join(fixture, '.claude/settings.json'))).permissions, { deny: ['Read(.env)'] })
  await buildProviders(fixture, { check: true })
  await cleanProviders(fixture)
  assert.match(await readFile(join(fixture, '.codex/config.toml'), 'utf8'), /\[features\]/)
  assert.equal(JSON.parse(await readFile(join(fixture, '.codex/hooks.json'))).foreign, true)
  await assert.rejects(access(join(fixture, '.agents/skills/hairness-help/SKILL.md')))
})
