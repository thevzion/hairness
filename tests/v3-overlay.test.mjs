import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listArtifacts, saveArtifact, showArtifact } from '../src/artifacts/index.mjs'
import { homeDocument } from '../src/home/index.mjs'
import { writeJsonAtomic } from '../src/lib/io.mjs'
import { archiveOverlay, initializeOverlay, overlayPaths, snapshotOverlay } from '../src/overlay/index.mjs'
import { activeScratch, createScratch, listScratches, noteScratch } from '../src/scratch/index.mjs'
import { git } from '../src/runtime/git.mjs'

async function fixture(t, overlayGit = false) {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-overlay-'))
  const home = join(root, 'home')
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  await writeJsonAtomic(join(home, 'hairness.json'), homeDocument({
    id: 'overlay-home',
    language: 'fr',
    providers: ['codex'],
    extensions: ['hairness/cockpit', 'hairness/work'],
    targets: [],
    overlayGit,
  }))
  await initializeOverlay(home)
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  return { root, home, paths: overlayPaths(home) }
}

test('an ephemeral session creates no Scratch files', async (t) => {
  const { home, paths } = await fixture(t)
  assert.equal(await activeScratch(home), null)
  await assert.rejects(
    noteScratch(home, { kind: 'decision', text: 'Use the clean model.' }),
    (error) => error.code === 'scratch_not_attached',
  )
  assert.deepEqual(await readdir(paths.scratches), [])
})

test('Scratch records semantic boundaries without a conversation journal', async (t) => {
  const { home, paths } = await fixture(t)
  const scratch = await createScratch(home, { id: 'reset', title: 'Architectural reset', context: 'One breaking reset.' })
  await noteScratch(home, { kind: 'decision', text: 'Scratch remains the work identity.' })
  await noteScratch(home, { kind: 'next', text: 'Prove the provider build.' })
  const notes = await readFile(join(paths.scratches, scratch.metadata.id, 'notes.md'), 'utf8')
  assert.match(notes, /Scratch remains the work identity/)
  assert.equal(notes.includes('transcript'), false)
  assert.equal((await listScratches(home))[0].spec.next, 'Prove the provider build.')
  assert.deepEqual(await readdir(join(paths.scratches, scratch.metadata.id, 'sessions')), [])
})

test('Artifacts keep one exact canonical payload and no revision graph', async (t) => {
  const { home } = await fixture(t)
  const payload = '# Accepted recap\n\nThis is the exact chat payload.\n'
  await saveArtifact(home, {
    owner: 'hairness/work', type: 'recap', id: 'reset-recap', payload,
    provenance: { scratch: 'reset', source: 'accepted-chat' },
  })
  const saved = await showArtifact(home, 'hairness/work', 'recap', 'reset-recap')
  assert.equal(saved.payload, payload)
  assert.equal(saved.envelope.spec.payload, 'payload.md')
  assert.equal(JSON.stringify(saved.envelope).includes('revision'), false)
  assert.equal((await listArtifacts(home)).length, 1)
})

test('Overlay Git is local, snapshots boundaries and blocks unsafe files', async (t) => {
  const { home, paths } = await fixture(t, true)
  assert.equal(await git(['remote'], { cwd: paths.root }), '')
  const initial = Number(await git(['rev-list', '--count', 'HEAD'], { cwd: paths.root }))
  await createScratch(home, { id: 'delivery', title: 'Delivery' })
  const after = Number(await git(['rev-list', '--count', 'HEAD'], { cwd: paths.root }))
  assert.ok(after > initial)

  await writeFile(join(paths.root, '.env'), 'TOKEN=not-a-real-secret\n')
  await assert.rejects(snapshotOverlay(home), (error) => error.code === 'overlay_credential_path')
  await rm(join(paths.root, '.env'))

  await symlink(join(home, 'hairness.json'), join(paths.root, 'escape-link'))
  await assert.rejects(snapshotOverlay(home), (error) => ['path_escape', 'overlay_symlink_forbidden'].includes(error.code))
})

test('opaque archives live outside the Overlay and parse no legacy schema', async (t) => {
  const { home, paths } = await fixture(t)
  await writeFile(join(paths.root, 'legacy-unknown.bin'), Buffer.from([0, 1, 2, 3]))
  const archive = await archiveOverlay(home)
  assert.equal(archive.path.startsWith(join(process.env.HAIRNESS_STATE_HOME, 'archives')), true)
  assert.deepEqual(await readFile(join(archive.path, 'overlay', 'legacy-unknown.bin')), Buffer.from([0, 1, 2, 3]))
})
