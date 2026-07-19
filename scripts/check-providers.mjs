import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHome } from '../src/create.mjs'
import { packHairness } from './lib/pack.mjs'

const root = new URL('../', import.meta.url).pathname
const temporary = await mkdtemp(join(tmpdir(), 'hairness-providers-'))
try {
  const packs = await packHairness(root, join(temporary, 'packs'))
  const home = join(temporary, 'home')
  await createHome(home, {
    packageSpec: `file:${packs.cli}`,
    starter: `file:${packs.starter}`,
    starterName: '@hairness/starter',
    packageOverrides: { '@hairness/native': `file:${packs.native}` },
  })
  for (const id of ['hairness', 'hairness-onboarding', 'hairness-scratch']) {
    const codex = await readFile(join(home, '.agents/skills', id, 'SKILL.md'), 'utf8')
    const claude = await readFile(join(home, '.claude/skills', id, 'SKILL.md'), 'utf8')
    assert.equal(codex.replaceAll(`$${id}`, id).replaceAll('.agents', '.provider'), claude.replaceAll(`/${id}`, id).replaceAll('.claude', '.provider'))
  }
  console.log('provider parity passed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
