import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSessionOpening } from '../src/prologue.mjs'
import { temporaryWorkspace } from './helpers.mjs'

test('effective language governs commentary, questions, and final answers from the opening', async () => {
  const root = await temporaryWorkspace()
  const home = join(root, 'home')
  process.env.HAIRNESS_HOME = home
  await mkdir(join(root, '.overlay'), { recursive: true })
  await writeFile(join(root, '.overlay/config.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', profile: { name: 'Alexis', language: 'fr', timezone: 'Europe/Paris' }, preferences: {}, extensions: { disabled: [], local: [] }, sources: {}, codebases: {}, identities: {} }))
  const opening = await buildSessionOpening(root, 'codex')
  assert.equal(opening.profile.language, 'fr')
  assert.match(opening.instruction, /Respond in fr for commentary, questions and final answers/)
  assert.ok(opening.byteSize < 4096)
})

test('wake-up skill has a zero-tool fresh-opening path and one-call refresh path', async () => {
  const source = await readFile(new URL('../extensions/hairness/cockpit/commands/hairness-wake-up.md', import.meta.url), 'utf8')
  assert.match(source, /zero tool calls/)
  assert.match(source, /exactly one `hairness wake-up --json`/)
  assert.doesNotMatch(source, /session opening.*then.*wake-up/i)
})
