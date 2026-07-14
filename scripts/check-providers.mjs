import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHome } from '../src/home/create.mjs'

const root = await mkdtemp(join(tmpdir(), 'hairness-provider-check-'))
process.env.HAIRNESS_STATE_HOME = join(root, 'state')
try {
  const home = join(root, 'home')
  const result = await createHome(home, { preset: 'standard', language: 'en', providers: ['codex', 'claude'], overlayGit: false, install: false })
  assert.equal(result.status, 'created')
  const commands = ['hairness', 'hairness-onboarding', 'hairness-scratch', 'hairness-discuss', 'hairness-map', 'hairness-ideate', 'hairness-propose', 'hairness-recap', 'hairness-plan', 'hairness-ship']
  for (const command of commands) {
    assert.match(await readFile(join(home, '.agents/skills', command, 'SKILL.md'), 'utf8'), new RegExp(`\\$${command}`))
    assert.match(await readFile(join(home, '.claude/skills', command, 'SKILL.md'), 'utf8'), new RegExp(`/${command}`))
  }
  console.log('provider projection gate passed (10 commands, Codex/Claude)')
} finally {
  delete process.env.HAIRNESS_STATE_HOME
  await rm(root, { recursive: true, force: true })
}
