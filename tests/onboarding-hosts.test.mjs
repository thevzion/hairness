import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildProviders, providerStatus } from '../src/providers/compiler.mjs'
import { applyOnboarding, answerOnboardingGap, nextOnboardingGap, onboardingPlan } from '../src/distribution/onboarding.mjs'
import { buildPrologue } from '../src/prologue.mjs'
import { temporaryWorkspace } from './helpers.mjs'

const exec = promisify(execFile)
const repositoryRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

test('onboarding asks one question at a time and applies one matching checkpoint', async () => {
  const root = await temporaryWorkspace()
  process.env.HAIRNESS_HOME = join(root, 'user-state')
  let gap = await nextOnboardingGap(root)
  assert.equal(gap.id, 'language')
  while (gap.id) {
    const value = gap.id === 'trust' ? 'trust' : gap.id === 'providers' ? 'later' : gap.options[0].value
    gap = await answerOnboardingGap(root, gap.id, value)
  }
  const plan = await onboardingPlan(root)
  assert.ok(plan.checkpointId.startsWith('onboarding-'))
  await assert.rejects(applyOnboarding(root, 'wrong', { buildProviders: false }), (error) => error.code === 'checkpoint_mismatch')
  const result = await applyOnboarding(root, plan.checkpointId, { buildProviders: false })
  assert.equal(result.status, 'applied')
  assert.equal(JSON.parse(await readFile(join(root, '.overlay/config.json'))).profile.language, 'en')
})

test('onboarding materializes codebases as named default checkouts', async () => {
  const root = await temporaryWorkspace()
  const checkout = join(root, 'fixtures', 'app')
  await mkdir(checkout, { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: checkout })
  await exec('git', ['remote', 'add', 'origin', 'git@example.test:team/app.git'], { cwd: checkout })
  for (const name of ['sources', 'presentation-controls', 'codebase']) await cp(join(repositoryRoot, 'extensions', 'hairness', name), join(root, 'extensions', 'hairness', name), { recursive: true })
  const manifestPath = join(root, 'hairness.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.extensions.push(
    { id: 'hairness/sources', path: './extensions/hairness/sources' },
    { id: 'hairness/presentation-controls', path: './extensions/hairness/presentation-controls' },
    { id: 'hairness/codebase', path: './extensions/hairness/codebase' },
  )
  manifest.sources = [{ id: 'git', requirement: 'required' }]
  manifest.codebases = [{ schemaVersion: 2, protocolVersion: '0.2', id: 'app', displayName: 'App', requirement: 'required', repository: { provider: 'git', host: 'example.test', namespace: 'team', name: 'app', webUrl: 'https://example.test/team/app', acceptedRemotes: ['git@example.test:team/app.git'] }, testCommands: [] }]
  await writeFile(manifestPath, JSON.stringify(manifest))
  process.env.HAIRNESS_HOME = join(root, 'user-state')
  let gap = await nextOnboardingGap(root)
  while (gap.id) {
    const value = gap.id === 'trust' ? 'trust' : gap.id === 'providers' ? 'later' : gap.id === 'codebase.app' ? checkout : gap.options[0].value
    gap = await answerOnboardingGap(root, gap.id, value)
  }
  const plan = await onboardingPlan(root)
  await applyOnboarding(root, plan.checkpointId, { buildProviders: false })
  const config = JSON.parse(await readFile(join(root, '.overlay/config.json')))
  assert.equal(config.codebases.mounts.app.default.path, './.overlay/codebases/app/default')
  assert.equal((await lstat(join(root, '.overlay/codebases/app/default'))).isSymbolicLink(), true)
})

test('build creates tracked repo-local provider surfaces without plugins', async () => {
  const repositoryRoot = new URL('../', import.meta.url).pathname
  process.env.HAIRNESS_ROOT = repositoryRoot
  await buildProviders(repositoryRoot, { check: true })
  await access(join(repositoryRoot, '.agents/skills/hairness-onboarding/SKILL.md'))
  await access(join(repositoryRoot, '.codex/agents/hairness-producer.toml'))
  await access(join(repositoryRoot, '.claude/agents/hairness-producer.md'))
  assert.ok(['projected', 'verification-required', 'verified'].includes((await providerStatus(repositoryRoot, 'codex')).status))
  await assert.rejects(access(join(repositoryRoot, '.codex-plugin')))
})

test('prologue stays compact and main-session only', async () => {
  const root = await temporaryWorkspace()
  const output = await buildPrologue(root, 'codex')
  assert.ok(Buffer.byteLength(output) < 4096)
  assert.match(output, /Checkpoints grant operation-scoped authority/)
  assert.doesNotMatch(output, /transcript|reasoning/i)
})

test('onboarding reads declarative gaps without executing extension code before trust', async () => {
  const root = await temporaryWorkspace()
  const extension = join(root, 'extensions/fixture/pre-trust')
  const marker = join(root, 'extension-executed')
  await mkdir(extension, { recursive: true })
  await writeFile(join(extension, 'index.mjs'), `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'executed'); export const services = {}\n`)
  await writeFile(join(extension, 'extension.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', id: 'fixture/pre-trust', version: '0.2.0-alpha.0', module: './index.mjs', capabilities: [], dependencies: [], commands: [], providerCommands: [], onboarding: [{ id: 'fixture.choice', phase: 'domain', question: 'Fixture choice?', options: [{ value: 'off', label: 'Off' }], preferenceKey: 'fixture.choice' }] }))
  const manifestPath = join(root, 'hairness.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.extensions.push({ id: 'fixture/pre-trust', path: './extensions/fixture/pre-trust' })
  await writeFile(manifestPath, JSON.stringify(manifest))
  process.env.HAIRNESS_HOME = join(root, 'user-state')
  assert.equal((await nextOnboardingGap(root)).id, 'language')
  await assert.rejects(access(marker))
})
