import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveArtifact, showArtifact } from '../src/artifacts/index.mjs'
import { resolveExtensionSource } from '../src/composition/extensions.mjs'
import {
  applyExtensionPlan,
  initializeExtension,
  listExtensions,
  prepareExtensionAdd,
  prepareExtensionAdopt,
  prepareExtensionRemove,
  prepareExtensionUpdate,
} from '../src/composition/lifecycle.mjs'
import { createHome } from '../src/home/create.mjs'
import { readJson, writeJsonAtomic } from '../src/lib/io.mjs'
import { git } from '../src/runtime/git.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-extension-'))
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  const home = join(root, 'home')
  await createHome(home, { preset: 'minimal', language: 'en', providers: ['codex'], overlayGit: false, install: false })
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, home }
}

async function twoFileExtension(path, id = 'acme/review') {
  await mkdir(path, { recursive: true })
  await writeJsonAtomic(join(path, 'extension.json'), {
    apiVersion: 'hairness.dev/extension/v1alpha1', kind: 'Extension',
    metadata: { id, version: '1.0.0', summary: 'Review in chat.' },
    spec: {
      provides: ['acme.review'], requires: ['hairness.cockpit'],
      recipes: [{ id: 'hairness-review', path: 'review.md', summary: 'Review one change.', capability: 'acme.review' }],
      adapters: [], schemas: [], gates: [], onboarding: [], tests: [],
    },
  })
  await writeFile(join(path, 'review.md'), 'Review the requested change and render findings in chat.\n')
}

test('two-file path extensions preview, checkpoint and apply without implicit activation', async (t) => {
  const { root, home } = await fixture(t)
  const source = join(root, 'review-extension')
  await twoFileExtension(source)

  const prepared = await prepareExtensionAdd(home, source)
  assert.deepEqual(prepared.preview.add, ['acme/review'])
  assert.equal((await readJson(join(home, 'hairness.json'))).spec.extensions.includes('acme/review'), false)
  await applyExtensionPlan(home, prepared.checkpoint.metadata.id)
  assert.equal((await readJson(join(home, 'hairness.json'))).spec.extensions.includes('acme/review'), true)
  assert.equal((await listExtensions(home)).find((item) => item.id === 'acme/review').source, source)
  assert.match(await readFile(join(home, '.agents/skills/hairness-review/SKILL.md'), 'utf8'), /\$hairness-review/)
})

test('divergence blocks mechanical update, adopt accepts it, and removal preserves artifacts', async (t) => {
  const { root, home } = await fixture(t)
  const source = join(root, 'review-extension')
  await twoFileExtension(source)
  const add = await prepareExtensionAdd(home, source)
  await applyExtensionPlan(home, add.checkpoint.metadata.id)
  const installed = join(home, 'extensions/acme/review')
  await writeFile(join(installed, 'review.md'), 'Locally improved recipe.\n')

  await assert.rejects(prepareExtensionUpdate(home, 'acme/review'), (error) => error.code === 'extension_diverged')
  const adopt = await prepareExtensionAdopt(home, installed)
  await applyExtensionPlan(home, adopt.checkpoint.metadata.id)
  assert.equal((await prepareExtensionUpdate(home, 'acme/review')).status, 'current')

  await saveArtifact(home, { owner: 'acme/review', type: 'decision', id: 'accepted', payload: '# Accepted\n' })
  const remove = await prepareExtensionRemove(home, 'acme/review')
  await applyExtensionPlan(home, remove.checkpoint.metadata.id)
  assert.equal((await readJson(join(home, 'hairness.json'))).spec.extensions.includes('acme/review'), false)
  assert.equal((await showArtifact(home, 'acme/review', 'decision', 'accepted')).payload, '# Accepted\n')
})

test('required capabilities block removal and init creates the minimal authoring shape', async (t) => {
  const { root, home } = await fixture(t)
  await assert.rejects(prepareExtensionRemove(home, 'hairness/cockpit'), (error) => error.code === 'extension_required')
  const scaffold = join(root, 'new-extension')
  const initialized = await initializeExtension(scaffold, 'acme/notes')
  assert.equal(initialized.manifest.metadata.id, 'acme/notes')
  assert.equal(initialized.manifest.spec.recipes.length, 1)
})

test('capability and command collisions reject composition before activation', async (t) => {
  const { root, home } = await fixture(t)
  const first = join(root, 'first')
  const second = join(root, 'second')
  await twoFileExtension(first, 'acme/first')
  await twoFileExtension(second, 'acme/second')
  const add = await prepareExtensionAdd(home, first)
  await applyExtensionPlan(home, add.checkpoint.metadata.id)

  await assert.rejects(prepareExtensionAdd(home, second), (error) => error.code === 'capability_collision')
  const manifest = await readJson(join(second, 'extension.json'))
  manifest.spec.provides = ['acme.second']
  await writeJsonAtomic(join(second, 'extension.json'), manifest)
  await assert.rejects(prepareExtensionAdd(home, second), (error) => error.code === 'command_collision')
})

test('Git extension sources resolve refs to immutable commits and subtree digests', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-git-extension-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repository = join(root, 'repository')
  const extension = join(repository, 'extensions/acme/review')
  await mkdir(repository, { recursive: true })
  await git(['init', '--quiet'], { cwd: repository })
  await twoFileExtension(extension)
  await git(['add', '--all'], { cwd: repository })
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'extension'], { cwd: repository })
  const head = await git(['rev-parse', 'HEAD'], { cwd: repository })

  const resolved = await resolveExtensionSource(pathToFileURL(repository).href, { ref: 'HEAD', path: 'extensions/acme/review', tmp: root })
  try {
    assert.equal(resolved.provenance.resolvedCommit, head)
    assert.match(resolved.provenance.digest, /^sha256:[a-f0-9]{64}$/)
  } finally {
    await resolved.cleanup()
  }
})
