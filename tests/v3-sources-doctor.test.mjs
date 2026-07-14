import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { createHome } from '../src/home/create.mjs'
import { doctorHome } from '../src/home/doctor.mjs'
import { readJson, writeJsonAtomic } from '../src/lib/io.mjs'
import { overlayPaths } from '../src/overlay/index.mjs'
import { detectSources, doctorSources, saveSourceBindings } from '../src/sources/index.mjs'

test('Source access is configured in Runtime while doctor revalidates live health', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-sources-'))
  const state = join(root, 'state')
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const previousPath = process.env.PATH
  process.env.HAIRNESS_STATE_HOME = state
  process.env.PATH = `${bin}${delimiter}${previousPath}`
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
  })
  await createHome(home, { preset: 'standard', language: 'fr', providers: ['codex'], overlayGit: false, install: false })
  await mkdir(bin, { recursive: true })
  const executable = join(bin, 'probe-cli')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const document = await readJson(join(home, 'hairness.json'))
  document.spec.config['hairness/sources'].sources = [{
    id: 'acme/live', summary: 'Live source', requirement: 'required', accessors: [{ kind: 'cli', command: 'probe-cli' }],
  }]
  await writeJsonAtomic(join(home, 'hairness.json'), document)

  const detected = await detectSources(home)
  assert.equal(detected[0].candidates[0].available, true)
  await saveSourceBindings(home, [{ id: 'acme/live', kind: 'cli', command: 'probe-cli' }])
  await writeJsonAtomic(overlayPaths(home).onboardingDraft, { home: document.metadata.id, status: 'complete', answers: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  assert.equal((await doctorSources(home)).status, 'ready')
  await rm(executable)
  const doctor = await doctorHome(home, { allowMissingDependency: true })
  assert.equal(doctor.onboarding.configured, true)
  assert.equal(doctor.status, 'partial')
  assert.equal(doctor.limits.includes('source-required-unavailable:acme/live'), true)
  const runtimeBinding = await readJson(join(state, 'runtime', document.metadata.id, 'sources', 'bindings.json'))
  assert.equal(runtimeBinding.sources['acme/live'].command, 'probe-cli')
  assert.equal('path' in runtimeBinding.sources['acme/live'], false)
  assert.equal(JSON.stringify(runtimeBinding).includes('secret'), false)
})

test('doctor reports missing Runtime without recreating it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-readonly-doctor-'))
  const state = join(root, 'state')
  const home = join(root, 'home')
  process.env.HAIRNESS_STATE_HOME = state
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  await createHome(home, { preset: 'minimal', language: 'en', providers: ['codex'], overlayGit: false, install: false })
  const document = await readJson(join(home, 'hairness.json'))
  const runtime = join(state, 'runtime', document.metadata.id)
  await rm(runtime, { recursive: true, force: true })
  const doctor = await doctorHome(home, { allowMissingDependency: true })
  assert.equal(doctor.status, 'partial')
  assert.equal(doctor.build.status, 'stale')
  await assert.rejects(stat(runtime), (error) => error.code === 'ENOENT')
})
