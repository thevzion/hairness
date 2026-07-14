import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { applyExtensionPlan, prepareExtensionUpdate } from '../src/composition/lifecycle.mjs'
import { createHome } from '../src/home/create.mjs'
import { runCreateWizard } from '../src/home/wizard.mjs'
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
  assert.equal(await exists(join(root, 'state/runtime/broken-home')), false)

  const installFailure = join(root, 'install-failure')
  await assert.rejects(createHome(installFailure, {
    preset: 'minimal', language: 'en', providers: ['codex'], overlayGit: false,
    packageSpec: `file:${join(root, 'missing-package.tgz')}`,
  }))
  assert.equal(await exists(installFailure), false)
  assert.equal(await exists(join(root, 'state/runtime/install-failure')), false)
})

test('create wizard renders a short human preview without a TUI dependency', async (t) => {
  const root = await rootFixture(t)
  const answers = ['', '', '', '2', '', '']
  const io = { question: async () => answers.shift() ?? '', close() {} }
  let rendered = ''
  const stream = { isTTY: false, write(value) { rendered += value } }
  const home = join(root, 'wizard-home')
  const result = await runCreateWizard(home, { io, output: stream, cwd: root, install: false })
  assert.equal(result.status, 'created')
  assert.match(rendered, /Hairness Home setup/)
  assert.match(rendered, /Creation preview/)
  assert.match(rendered, /Will not: remote, push, tag, publication/)
  assert.equal(rendered.includes('"destination"'), false)
})

test('custom path distributions bootstrap their bundled extensions without copying a runtime', async (t) => {
  const root = await rootFixture(t)
  const distribution = join(root, 'distribution')
  const extension = join(distribution, 'extensions/acme/chat')
  await mkdir(extension, { recursive: true })
  await writeFile(join(distribution, 'hairness.distribution.json'), `${JSON.stringify({
    apiVersion: 'hairness.dev/distribution/v1alpha1', kind: 'Distribution',
    metadata: { id: 'acme/custom', version: '1.0.0', summary: 'Custom bootstrap.' },
    spec: { extensions: ['acme/chat'], defaults: {}, policies: [], onboarding: [] },
  }, null, 2)}\n`)
  await writeFile(join(extension, 'extension.json'), `${JSON.stringify({
    apiVersion: 'hairness.dev/extension/v1alpha1', kind: 'Extension',
    metadata: { id: 'acme/chat', version: '1.0.0', summary: 'Custom chat.' },
    spec: {
      provides: ['acme.chat'], requires: [],
      recipes: [{ id: 'hairness-chat', path: 'chat.md', summary: 'Chat.', capability: 'acme.chat' }],
      adapters: [], schemas: [], gates: [], onboarding: [], tests: [],
    },
  }, null, 2)}\n`)
  await writeFile(join(extension, 'chat.md'), 'Chat directly with the user.\n')

  const home = join(root, 'custom-home')
  await createHome(home, { from: distribution, language: 'en', providers: ['codex'], overlayGit: false, install: false })
  const lock = await readJson(join(home, 'hairness.lock.json'))
  assert.equal(lock.distribution.id, 'acme/custom')
  assert.equal(lock.extensions[0].path, 'extensions/acme/chat')
  assert.equal(await exists(join(home, 'src')), false)
  assert.equal(await exists(join(home, '.agents/skills/hairness-chat/SKILL.md')), true)

  await writeFile(join(extension, 'chat.md'), 'Chat with the user using the improved source.\n')
  const update = await prepareExtensionUpdate(home, 'acme/chat')
  assert.deepEqual(update.preview.update, ['acme/chat'])
  await applyExtensionPlan(home, update.checkpoint.metadata.id)
  assert.match(await readFile(join(home, '.agents/skills/hairness-chat/SKILL.md'), 'utf8'), /improved source/)

  await git(['init', '--quiet'], { cwd: distribution })
  await git(['add', '--all'], { cwd: distribution })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'distribution'], { cwd: distribution })
  const distributionHead = await git(['rev-parse', 'HEAD'], { cwd: distribution })
  const gitHome = join(root, 'custom-git-home')
  await createHome(gitHome, {
    from: pathToFileURL(distribution).href,
    distributionRef: 'HEAD',
    language: 'en', providers: ['codex'], overlayGit: false, install: false,
  })
  const gitLock = await readJson(join(gitHome, 'hairness.lock.json'))
  assert.equal(gitLock.distribution.resolvedCommit, distributionHead)
  assert.equal(gitLock.extensions[0].resolvedCommit, distributionHead)
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
    const answer = status.next.id === 'targets' || status.next.id === 'sources' ? [] : `Réponse pour ${status.next.id}`
    await answerOnboarding(home, status.next.id, answer)
    const draft = await readJson(overlayPaths(home).onboardingDraft)
    if (Array.isArray(answer)) assert.deepEqual(draft.answers[status.next.id], { selected: [] })
    else assert.equal(draft.answers[status.next.id], answer)
  }
  assert.deepEqual(answered, ['profile.name', 'profile.note', 'situation', 'project-context', 'targets', 'sources', 'work.boundaries'])
  const planned = await planOnboarding(home)
  assert.equal(planned.status, 'checkpoint-required')
  assert.deepEqual(planned.plan.composition.add, [])
  const applied = await applyOnboarding(home, planned.checkpoint.metadata.id)
  assert.equal(applied.status, 'complete')
  assert.equal((await onboardingStatus(home)).status, 'complete')
  assert.match(await readFile(join(home, '.agents/skills/hairness-onboarding/SKILL.md'), 'utf8'), /Speak fr/)
})
