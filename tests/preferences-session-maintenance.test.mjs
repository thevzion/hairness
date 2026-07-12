import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolvePreferences, preferencesCommand } from '../src/distribution/preferences.mjs'
import { handleCommand as sessionCommand } from '../extensions/hairness/session-intelligence/index.mjs'
import { changeImpact } from '../extensions/hairness/maintainer/index.mjs'
import { readJson, writeJsonAtomic } from '../src/core/io.mjs'
import { validateContract } from '../src/core/contracts.mjs'
import { temporaryWorkspace } from './helpers.mjs'

test('preference resolution follows distribution, user, workspace, override order', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  await preferencesCommand(root, 'set', 'interaction.language', [], { scope: 'user', value: '"fr"' })
  await preferencesCommand(root, 'set', 'interaction.language', [], { scope: 'workspace', value: '"en"' })
  assert.equal((await resolvePreferences(root)).interaction.language, 'en')
  assert.equal((await resolvePreferences(root, { interaction: { language: 'de' } })).interaction.language, 'de')
  assert.equal((await resolvePreferences(root)).protocol.transcriptStorage, false)
})

test('workspace profile language is an effective preference until explicitly overridden', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  const configPath = join(root, '.overlay/config.json')
  await writeJsonAtomic(configPath, { schemaVersion: 2, protocolVersion: '0.2', profile: { language: 'fr', timezone: 'Europe/Paris' }, preferences: {} })
  assert.equal((await resolvePreferences(root)).interaction.language, 'fr')
  await preferencesCommand(root, 'set', 'interaction.language', [], { scope: 'workspace', value: '"en"' })
  assert.equal((await resolvePreferences(root)).interaction.language, 'en')
})

test('session digest deletes an allowlisted inbox and stores only the digest', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'home')
  await preferencesCommand(root, 'set', 'session.transcript', [], { value: 'true' })
  const stateRoot = join(root, '.overlay/extensions-state/hairness/session-intelligence')
  const inboxRoot = join(stateRoot, 'inbox')
  await mkdir(inboxRoot, { recursive: true })
  let staged = null
  const runtime = {
    contracts: { validate: validateContract },
    distribution: { preferences: () => resolvePreferences(root) },
    overlay: {
      read: (key, fallback) => readJson(join(stateRoot, key), fallback),
      write: async (key, value) => { await writeJsonAtomic(join(stateRoot, key), value); return value },
      list: async (key) => { try { return await (await import('node:fs/promises')).readdir(join(stateRoot, key)) } catch { return [] } },
    },
    artifacts: { stage: async (_runId, value) => { staged = value }, promote: async () => staged },
  }
  const session = await sessionCommand({ root, target: 'reconcile', flags: { host: 'codex', 'provider-session': 'thread-fixture' }, runtime })
  const inbox = join(inboxRoot, 'thread.txt')
  await writeFile(inbox, 'volatile transcript content')
  const result = await sessionCommand({ root, target: 'digest', flags: { id: session.id, inbox, summary: 'Bounded handoff.' }, runtime })
  assert.equal(result.digest.summary, 'Bounded handoff.')
  assert.equal(staged.type, 'session-handoff')
  await assert.rejects(access(inbox))
  const durable = await readFile(join(stateRoot, 'digests', `${session.id}.json`), 'utf8')
  assert.doesNotMatch(durable, /volatile transcript content/)
})

test('change impact blocks protocol changes without owner documentation', async () => {
  const report = await changeImpact({ root: '/tmp', files: ['src/core/io.mjs'], runtime: { contracts: { validate: validateContract } } })
  assert.equal(report.decision, 'must-update')
  assert.ok(report.dimensions.includes('protocol'))
})
