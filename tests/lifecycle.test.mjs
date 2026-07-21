import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { buildHome } from '../src/build.mjs'
import { createHome } from '../src/create.mjs'
import { doctorHome } from '../src/doctor.mjs'
import { addAssets, diffAsset, removeAsset, resolveAsset, statusAssets, syncAssets } from '../src/assets.mjs'
import { asset, writeAsset } from './helpers.mjs'

const exec = promisify(execFile)

test('add, status, diff, sync and remove preserve source ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-lifecycle-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const v1 = await writeAsset(join(root, 'v1'), asset(), { 'skills/review/SKILL.md': 'Review version one.\n' })
    await addAssets(home, [v1])
    assert.equal((await statusAssets(home, 'fixture/review'))[0].state, 'clean')
    await buildHome(home)
    assert.match(await readFile(join(home, '.agents/skills/review/SKILL.md'), 'utf8'), /version one/)

    const sourceFile = join(home, 'assets/fixture/review/skills/review/SKILL.md')
    await writeFile(sourceFile, 'Local customization.\n')
    assert.equal((await statusAssets(home, 'review'))[0].state, 'customized')
    await buildHome(home)
    assert.equal((await doctorHome(home)).status, 'ready')
    const v2 = await writeAsset(join(root, 'v2'), asset({ version: '2.0.0', files: [
      { path: 'skills/review/SKILL.md', type: 'hairness:skill', id: 'review', description: 'Review a subject.' },
      { path: 'knowledge/new.md', type: 'hairness:file' },
    ] }), { 'skills/review/SKILL.md': 'Review version two.\n', 'knowledge/new.md': 'New knowledge.\n' })
    const before = await readFile(sourceFile)
    await assert.rejects(() => syncAssets(home, 'review', { to: v2 }), (error) => error.code === 'sync_customized')
    assert.deepEqual(await readFile(sourceFile), before)
    assert.equal((await diffAsset(home, 'review', { to: v2 })).files.find((file) => file.path === 'skills/review/SKILL.md').change, 'changed')

    const unknown = join(home, 'assets/fixture/review/notes.md')
    await writeFile(unknown, 'Owned locally.\n')
    await syncAssets(home, 'review', { to: v2, overwrite: true })
    assert.equal((await statusAssets(home, 'review'))[0].state, 'clean')
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    assert.equal(await readFile(sourceFile, 'utf8'), 'Review version two.\n')
    const v3 = await writeAsset(join(root, 'v3'), asset({ version: '3.0.0' }), { 'skills/review/SKILL.md': 'Review version three.\n' })
    await syncAssets(home, 'review', { to: v3 })
    await assert.rejects(readFile(join(home, 'assets/fixture/review/knowledge/new.md')), (error) => error.code === 'ENOENT')
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    await writeFile(sourceFile, 'Another customization.\n')
    await assert.rejects(() => removeAsset(home, 'review'), (error) => error.code === 'asset_customized')
    await removeAsset(home, 'review', { overwrite: true })
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    await assert.rejects(readFile(sourceFile), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installed Assets can be shared with fresh provenance and local manifest edits block sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-manifest-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const source = await writeAsset(join(root, 'source'), asset(), { 'skills/review/SKILL.md': 'Review.\n' })
    await addAssets(home, [source])
    const installedPath = join(home, 'assets/fixture/review/hairness.json')
    const installed = JSON.parse(await readFile(installedPath, 'utf8'))
    assert.equal(installed.installation.source, source)
    assert.match(installed.installation.baseManifestDigest, /^sha256:/)
    await assert.rejects(readFile(join(home, 'assets/fixture/review/hairness.item.json')), (error) => error.code === 'ENOENT')

    const secondHome = join(root, 'second-home')
    await createHome(secondHome)
    await addAssets(secondHome, [installedPath])
    const shared = JSON.parse(await readFile(join(secondHome, 'assets/fixture/review/hairness.json'), 'utf8'))
    assert.equal(shared.installation.source, installedPath)
    assert.equal(shared.installation.requestedRef, null)
    assert.equal(shared.installation.resolvedCommit, null)
    assert.equal(shared.installation.mobile, true)
    assert.equal(shared.installation.baseManifestDigest, installed.installation.baseManifestDigest)

    installed.description = 'Locally described.'
    await writeFile(installedPath, `${JSON.stringify(installed, null, 2)}\n`)
    assert.equal((await statusAssets(home, 'review'))[0].manifest, 'customized')
    await assert.rejects(() => syncAssets(home, 'review'), (error) => error.code === 'sync_customized')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Scratch is absent by default and becomes owned source only after an explicit add', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-scratch-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    await assert.rejects(readFile(join(home, 'assets/hairness/scratch/hairness.json')), (error) => error.code === 'ENOENT')
    await addAssets(home, ['@hairness/scratch'])
    await buildHome(home)
    assert.match(await readFile(join(home, '.agents/skills/hairness-scratch/SKILL.md'), 'utf8'), /explicit, lightweight working memory/i)
    assert.equal((await statusAssets(home, 'hairness/scratch'))[0].state, 'clean')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('status reports an invalid installed manifest without hiding the Asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-invalid-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const path = join(home, 'assets/hairness/onboarding/hairness.json')
    await writeFile(path, '{ invalid json\n')
    const [status] = await statusAssets(home, 'hairness/onboarding')
    assert.equal(status.state, 'invalid')
    await assert.rejects(() => buildHome(home), (error) => error.code === 'asset_invalid')

    const legacyHome = join(root, 'legacy-home')
    await createHome(legacyHome)
    await mkdir(join(legacyHome, 'extensions'), { recursive: true })
    await assert.rejects(() => buildHome(legacyHome), (error) => error.code === 'legacy_asset_layout')

    const oldSchema = join(root, 'old-schema.json')
    await writeFile(oldSchema, `${JSON.stringify({ ...asset(), $schema: 'https://hairness.dev/schema/extension.json' }, null, 2)}\n`)
    await assert.rejects(() => resolveAsset(home, oldSchema), (error) => error.code === 'document_invalid')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('HTTPS manifests install their relative source files and reject query secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-https-'))
  const previousFetch = globalThis.fetch
  try {
    const home = join(root, 'home')
    await createHome(home)
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('hairness.json')) return new Response(JSON.stringify(asset({ name: 'remote/review', files: [{ path: 'review.md', type: 'hairness:file' }] })), { status: 200 })
      return new Response('Remote.\n', { status: 200 })
    }
    await addAssets(home, ['https://assets.example/assets/review/hairness.json'])
    assert.equal(await readFile(join(home, 'assets/remote/review/review.md'), 'utf8'), 'Remote.\n')
    await assert.rejects(() => resolveAsset(home, 'https://assets.example/hairness.json?token=secret'), (error) => error.code === 'source_insecure')
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('Adapters are inert during add and require explicit build approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-adapter-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const adapter = await writeAsset(join(root, 'adapter'), asset({
      name: 'fixture/adapter', files: [{ path: 'adapter.mjs', type: 'hairness:file' }],
      adapter: { id: 'fixture-adapter', entry: 'adapter.mjs', outputs: ['generated'] },
    }), {
      'adapter.mjs': "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, 'generated'), { recursive: true }); writeFileSync(join(root, 'generated/proof.txt'), 'adapter ready\\n')\n",
    })
    await addAssets(home, [adapter])
    await assert.rejects(readFile(join(home, 'generated/proof.txt')), (error) => error.code === 'ENOENT')
    await assert.rejects(() => buildHome(home), (error) => error.code === 'adapter_approval_required')
    await buildHome(home, { allowAdapters: ['fixture-adapter'] })
    assert.equal(await readFile(join(home, 'generated/proof.txt'), 'utf8'), 'adapter ready\n')
    await buildHome(home, { check: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Adapters cannot claim Kernel-managed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-adapter-reserved-'))
  try {
    const home = join(root, 'home')
    await createHome(home, { providers: ['codex'] })
    const before = await readFile(join(home, '.codex/hooks.json'))
    const adapter = await writeAsset(join(root, 'adapter'), asset({
      name: 'fixture/reserved', files: [{ path: 'adapter.mjs', type: 'hairness:file' }],
      adapter: { id: 'reserved-adapter', entry: 'adapter.mjs', outputs: ['.codex'] },
    }), {
      'adapter.mjs': "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, '.codex'), { recursive: true }); writeFileSync(join(root, '.codex/hooks.json'), '{}\\n')\n",
    })
    await addAssets(home, [adapter])
    await assert.rejects(() => buildHome(home, { allowAdapters: ['reserved-adapter'] }), (error) => error.code === 'adapter_output_reserved')
    assert.deepEqual(await readFile(join(home, '.codex/hooks.json')), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('paths, collisions and symlinks are rejected before any Home write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-paths-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const source = join(root, 'source')
    await mkdir(source, { recursive: true })
    await writeFile(join(root, 'outside.md'), 'outside\n')
    await symlink(join(root, 'outside.md'), join(source, 'linked.md'))
    const manifest = await writeAsset(source, asset({ files: [{ path: 'linked.md', type: 'hairness:file' }] }))
    await assert.rejects(() => addAssets(home, [manifest]), (error) => error.code === 'symlink_forbidden')
    await assert.rejects(readFile(join(home, 'assets/fixture/review/hairness.json')), (error) => error.code === 'ENOENT')

    const first = await writeAsset(join(root, 'first'), asset(), { 'skills/review/SKILL.md': 'First.\n' })
    const second = await writeAsset(join(root, 'second'), asset({ name: 'fixture/second' }), { 'skills/review/SKILL.md': 'Second.\n' })
    await addAssets(home, [first])
    await assert.rejects(() => addAssets(home, [second]), (error) => error.code === 'capability_collision')
    await assert.rejects(readFile(join(home, 'assets/fixture/second/hairness.json')), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub tag, commit and mobile addresses resolve an autonomous manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-github-'))
  const previous = Object.fromEntries(['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1'].map((key) => [key, process.env[key]]))
  try {
    const repository = join(root, 'source')
    const github = join(root, 'github')
    const bare = join(github, 'acme/assets.git')
    await exec('git', ['init', '--quiet', '--initial-branch=main', repository])
    await writeAsset(join(repository, 'assets/review'), asset({ name: 'acme/review' }), { 'skills/review/SKILL.md': 'GitHub source.\n' })
    await exec('git', ['add', '--all'], { cwd: repository })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'asset'], { cwd: repository })
    await exec('git', ['tag', 'v1.0.0'], { cwd: repository })
    await mkdir(join(github, 'acme'), { recursive: true })
    await exec('git', ['clone', '--quiet', '--bare', repository, bare])
    const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
    process.env.GIT_CONFIG_COUNT = '2'
    process.env.GIT_CONFIG_KEY_0 = `url.file://${github}/.insteadOf`
    process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/'
    process.env.GIT_CONFIG_KEY_1 = 'protocol.file.allow'
    process.env.GIT_CONFIG_VALUE_1 = 'always'
    const home = join(root, 'home')
    await createHome(home)
    await addAssets(home, ['acme/assets/assets/review#v1.0.0'])
    const installed = JSON.parse(await readFile(join(home, 'assets/acme/review/hairness.json'), 'utf8'))
    assert.equal(installed.installation.requestedRef, 'v1.0.0')
    assert.equal(installed.installation.resolvedCommit, commit)
    assert.equal(installed.installation.mobile, false)
    assert.equal(await readFile(join(home, 'assets/acme/review/skills/review/SKILL.md'), 'utf8'), 'GitHub source.\n')
    assert.equal((await resolveAsset(home, 'acme/assets/assets/review')).mobile, true)
    assert.equal((await resolveAsset(home, `acme/assets/assets/review#${commit}`)).mobile, false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
