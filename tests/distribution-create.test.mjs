import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { answerCreate, applyCreate, planCreate, resolveMaterialGraph, startCreate } from '../src/bootstrap/create.mjs'
import { buildProviders } from '../src/providers/compiler.mjs'

test('create collects one gap at a time and materializes standalone sources', async () => {
  const base = await mkdtemp(join(tmpdir(), 'hairness-create-'))
  process.env.HAIRNESS_HOME = join(base, 'home')
  const target = join(base, 'team-hairness')
  let gap = await startCreate(target, 'standard')
  assert.equal(gap.id, 'language')
  const answers = { language: 'en', name: 'team', displayName: 'Team Hairness', providerPrefix: 'team', cliAlias: 'none', extensions: 'preset', providers: 'codex', codebases: 'later' }
  while (gap.question) gap = await answerCreate(gap.createId, gap.id, answers[gap.id] ?? gap.options[0].value)
  const plan = await planCreate(gap.createId)
  assert.ok(plan.checkpointId.startsWith('create-'))
  assert.ok(plan.exclusions.includes('push'))
  const result = await applyCreate(gap.createId, plan.checkpointId, { install: false, git: false, build: false })
  assert.equal(result.status, 'applied')
  await access(join(target, 'src/cli.mjs'))
  await assert.rejects(access(join(target, 'catalog/extensions/hairness/cockpit/extension.json')))
  const manifest = JSON.parse(await readFile(join(target, 'hairness.json')))
  assert.equal(manifest.generatedFrom.source, '@hairness/cli')
  assert.equal(manifest.role, 'distribution')
  assert.equal(manifest.catalogRoots.length, 0)
  assert.equal(manifest.extensions.length, 10)
  const sources = JSON.parse(await readFile(join(target, 'extensions/hairness/sources/extension.json')))
  assert.deepEqual(sources.sourceDrivers, ['./drivers/git/driver.json'])
  for (const driver of ['jira', 'gitlab', 'aws']) await assert.rejects(access(join(target, 'extensions/hairness/sources/drivers', driver)))
  for (const upstream of ['SPEC.md', 'STATUS.md', 'ROADMAP.md']) await assert.rejects(access(join(target, upstream)))
  await buildProviders(target)
  assert.doesNotMatch(await readFile(join(target, 'AGENTS.md'), 'utf8'), /Forge maintenance/)
  await access(join(target, '.agents/skills/hairness-work/SKILL.md'))
  await assert.rejects(access(join(target, '.git')))
  assert.doesNotMatch(await readFile(join(target, 'src/cli.mjs'), 'utf8'), /Users\/alexisrobert\/Projects\/hairness/)
  assert.deepEqual(await readdir(join(target, 'schemas')).then((names) => names.sort()), ['capability.schema.json', 'distribution.schema.json', 'extension.schema.json', 'protocol.schema.json'])
  const lock = JSON.parse(await readFile(join(target, 'hairness.lock.json'), 'utf8'))
  assert.equal(lock.generatedFrom.source, '@hairness/cli')
  assert.equal(lock.updateSource.spec, '@hairness/cli')
  assert.ok(lock.materials.some((material) => material.scope === 'material-set:runtime'))
})

test('material graph resolves declared set dependencies without duplicate targets', async () => {
  const graph = await resolveMaterialGraph({ materialSets: ['forge'] })
  assert.deepEqual(graph.sets, ['runtime', 'forge'])
  assert.equal(new Set(graph.entries.map((entry) => entry.target)).size, graph.entries.length)
  assert.ok(graph.entries.some((entry) => entry.target === 'schemas/distribution-lock.schema.json'))
})

test('minimal materializes only the core and cockpit without dormant catalogue behavior', async () => {
  const base = await mkdtemp(join(tmpdir(), 'hairness-minimal-create-'))
  process.env.HAIRNESS_HOME = join(base, 'home')
  const target = join(base, 'minimal-hairness')
  let gap = await startCreate(target, 'minimal')
  const answers = { language: 'en', name: 'minimal', displayName: 'Minimal Hairness', providerPrefix: 'hairness', cliAlias: 'none', extensions: 'preset', providers: 'codex', codebases: 'later' }
  while (gap.question) gap = await answerCreate(gap.createId, gap.id, answers[gap.id] ?? gap.options[0].value)
  const plan = await planCreate(gap.createId)
  await applyCreate(gap.createId, plan.checkpointId, { install: false, git: false, build: false })
  const manifest = JSON.parse(await readFile(join(target, 'hairness.json')))
  assert.deepEqual(manifest.extensions.map((entry) => entry.id), ['hairness/cockpit', 'hairness/distribution'])
  await assert.rejects(access(join(target, 'extensions/hairness/maintainer')))
  await assert.rejects(access(join(target, 'extensions/hairness/work-controls')))
  await assert.rejects(access(join(target, 'catalog')))
  await assert.rejects(access(join(target, 'src/core/test-sandboxes.mjs')))
})
