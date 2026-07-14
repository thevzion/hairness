import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHome } from '../src/home/create.mjs'
import { doctorHome } from '../src/home/doctor.mjs'
import { exists, readJson } from '../src/lib/io.mjs'
import { applyOnboarding, answerOnboarding, onboardingStatus, planOnboarding } from '../src/onboarding/index.mjs'
import { overlayPaths } from '../src/overlay/index.mjs'
import { git } from '../src/runtime/git.mjs'

async function rootFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-create-'))
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return root
}

async function repository(path) {
  await mkdir(path, { recursive: true })
  await git(['init', '--quiet'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# Target\n')
  await git(['add', 'README.md'], { cwd: path })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd: path })
}

test('create builds a complete local Home atomically with independent Target and Overlay', async (t) => {
  const root = await rootFixture(t)
  const target = join(root, 'product')
  const home = join(root, 'agent-home')
  await repository(target)
  const result = await createHome(home, {
    preset: 'standard', language: 'fr', providers: ['codex', 'claude'], target,
    overlayGit: true, install: false,
  })
  const canonicalTarget = await git(['rev-parse', '--show-toplevel'], { cwd: target })

  assert.equal(result.status, 'created')
  assert.deepEqual(result.launch, [
    { provider: 'codex', command: `codex -C "${home}" --add-dir "${canonicalTarget}"`, onboarding: '$hairness-onboarding' },
    { provider: 'claude', command: `cd "${home}" && claude --add-dir "${canonicalTarget}"`, onboarding: '/hairness-onboarding' },
  ])
  assert.equal(await git(['remote'], { cwd: home }), '')
  assert.equal(await git(['remote'], { cwd: join(home, '.overlay') }), '')
  assert.equal(Number(await git(['rev-list', '--count', 'HEAD'], { cwd: home })), 1)
  assert.equal(Number(await git(['rev-list', '--count', 'HEAD'], { cwd: join(home, '.overlay') })), 1)
  assert.equal(await git(['ls-files', '.agents/skills/hairness/SKILL.md'], { cwd: home }), '')
  assert.equal(await git(['ls-files', '.agents/skills/.gitkeep'], { cwd: home }), '.agents/skills/.gitkeep')
  assert.equal((await readFile(join(home, 'hairness.json'), 'utf8')).includes(target), false)
  assert.equal((await readFile(join(home, 'hairness.lock.json'), 'utf8')).includes(target), false)
  assert.equal((await doctorHome(home, { allowMissingDependency: true })).status, 'ready')
})

test('create failure leaves no partial destination', async (t) => {
  const root = await rootFixture(t)
  const destination = join(root, 'broken-home')
  await assert.rejects(
    createHome(destination, { preset: 'minimal', language: 'en', providers: ['unknown'], overlayGit: false, install: false }),
    (error) => error.code === 'document_invalid' || error.code === 'provider_unsupported',
  )
  assert.equal(await exists(destination), false)
})

test('onboarding resumes after every French answer and applies one exact checkpoint', async (t) => {
  const root = await rootFixture(t)
  const home = join(root, 'onboarding-home')
  await createHome(home, { preset: 'minimal', language: 'fr', providers: ['codex'], overlayGit: false, install: false })

  const answered = []
  while (true) {
    const status = await onboardingStatus(home)
    assert.equal(status.language, 'fr')
    if (!status.next) break
    answered.push(status.next.id)
    await answerOnboarding(home, status.next.id, `Réponse pour ${status.next.id}`)
    const draft = await readJson(overlayPaths(home).onboardingDraft)
    assert.equal(draft.answers[status.next.id], `Réponse pour ${status.next.id}`)
  }
  assert.deepEqual(answered, ['situation', 'project-context', 'working-memory', 'work.boundaries'])
  const planned = await planOnboarding(home)
  assert.equal(planned.status, 'checkpoint-required')
  assert.deepEqual(planned.plan.composition.add, [])
  const applied = await applyOnboarding(home, planned.checkpoint.metadata.id)
  assert.equal(applied.status, 'complete')
  assert.equal((await onboardingStatus(home)).status, 'complete')
  assert.match(await readFile(join(home, '.agents/skills/hairness-onboarding/SKILL.md'), 'utf8'), /Speak fr/)
})
