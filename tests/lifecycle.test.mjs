import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { addItems, diffItem, removeItem, statusItems, syncItems } from '../src/arranger.mjs'
import { buildHome } from '../src/build.mjs'
import { createHome } from '../src/create.mjs'
import { extension, writeItem } from './helpers.mjs'
import { resolveItem } from '../src/registry.mjs'

const exec = promisify(execFile)

test('add, status, diff, sync and remove preserve source ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-lifecycle-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const v1 = await writeItem(join(root, 'v1'), extension(), { 'skills/review/SKILL.md': 'Review version one.\n' })
    await addItems(home, [v1])
    assert.equal((await statusItems(home, 'fixture/review'))[0].state, 'clean')
    await buildHome(home)
    assert.match(await readFile(join(home, '.agents/skills/review/SKILL.md'), 'utf8'), /version one/)

    const sourceFile = join(home, 'extensions/fixture/review/skills/review/SKILL.md')
    await writeFile(sourceFile, 'Local customization.\n')
    assert.equal((await statusItems(home, 'review'))[0].state, 'customized')
    const v2 = await writeItem(join(root, 'v2'), extension({ version: '2.0.0', files: [
      { path: 'skills/review/SKILL.md', type: 'hairness:skill', id: 'review', description: 'Review a subject.' },
      { path: 'knowledge/new.md', type: 'hairness:file' },
    ] }), { 'skills/review/SKILL.md': 'Review version two.\n', 'knowledge/new.md': 'New knowledge.\n' })
    const before = await readFile(sourceFile)
    await assert.rejects(() => syncItems(home, 'review', { to: v2 }), (error) => error.code === 'sync_customized')
    assert.deepEqual(await readFile(sourceFile), before)
    assert.equal((await diffItem(home, 'review', { to: v2 })).files.find((file) => file.path === 'skills/review/SKILL.md').change, 'changed')

    const unknown = join(home, 'extensions/fixture/review/notes.md')
    await writeFile(unknown, 'Owned locally.\n')
    await syncItems(home, 'review', { to: v2, overwrite: true })
    assert.equal((await statusItems(home, 'review'))[0].state, 'clean')
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    assert.equal(await readFile(sourceFile, 'utf8'), 'Review version two.\n')
    const v3 = await writeItem(join(root, 'v3'), extension({ version: '3.0.0' }), { 'skills/review/SKILL.md': 'Review version three.\n' })
    await syncItems(home, 'review', { to: v3 })
    await assert.rejects(readFile(join(home, 'extensions/fixture/review/knowledge/new.md')), (error) => error.code === 'ENOENT')
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    await writeFile(sourceFile, 'Another customization.\n')
    await assert.rejects(() => removeItem(home, 'review'), (error) => error.code === 'item_customized')
    await removeItem(home, 'review', { overwrite: true })
    assert.equal(await readFile(unknown, 'utf8'), 'Owned locally.\n')
    await assert.rejects(readFile(sourceFile), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dependencies are recursive, cyclic graphs fail and dependents protect remove', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-deps-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const dependency = await writeItem(join(root, 'dependency'), extension({ name: 'security', title: 'Security', files: [{ path: 'security.md', type: 'hairness:file' }] }), { 'security.md': 'Security.\n' })
    const parent = await writeItem(join(root, 'parent'), extension({ registryDependencies: [dependency] }), { 'skills/review/SKILL.md': 'Review.\n' })
    await addItems(home, [parent])
    assert.deepEqual((await statusItems(home)).filter((item) => item.id.startsWith('fixture/')).map((item) => item.id), ['fixture/review', 'fixture/security'])
    await assert.rejects(() => removeItem(home, 'fixture/security'), (error) => error.code === 'item_required')

    const cycleAPath = join(root, 'cycles/a.json')
    const cycleBPath = join(root, 'cycles/b.json')
    await writeItem(join(root, 'cycles'), extension({ name: 'a', title: 'A', registryDependencies: [cycleBPath], files: [{ path: 'a.md', type: 'hairness:file' }] }), { 'a.md': 'A\n' })
    await writeItem(join(root, 'cycles'), extension({ name: 'b', title: 'B', registryDependencies: [cycleAPath], files: [{ path: 'b.md', type: 'hairness:file' }] }), { 'b.md': 'B\n' })
    await assert.rejects(() => addItems(home, [cycleAPath]), (error) => error.code === 'dependency_cycle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Adapters are inert during add and require explicit build approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-adapter-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const adapter = await writeItem(join(root, 'adapter'), extension({
      name: 'adapter', title: 'Adapter', files: [{ path: 'adapter.mjs', type: 'hairness:adapter' }],
      adapter: { id: 'fixture-adapter', entry: 'adapter.mjs', outputs: ['generated'] },
    }), {
      'adapter.mjs': "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, 'generated'), { recursive: true }); writeFileSync(join(root, 'generated/proof.txt'), 'adapter ready\\n')\n",
    })
    await addItems(home, [adapter])
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
    const adapter = await writeItem(join(root, 'adapter'), extension({
      name: 'reserved', title: 'Reserved Adapter', files: [{ path: 'adapter.mjs', type: 'hairness:adapter' }],
      adapter: { id: 'reserved-adapter', entry: 'adapter.mjs', outputs: ['.codex'] },
    }), {
      'adapter.mjs': "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; const root = process.env.HAIRNESS_OUTPUT_DIR; mkdirSync(join(root, '.codex'), { recursive: true }); writeFileSync(join(root, '.codex/hooks.json'), '{}\\n')\n",
    })
    await addItems(home, [adapter])
    await assert.rejects(() => buildHome(home, { allowAdapters: ['reserved-adapter'] }), (error) => error.code === 'adapter_output_reserved')
    assert.deepEqual(await readFile(join(home, '.codex/hooks.json')), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('registry paths and symlinks are rejected before any Home write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-paths-'))
  try {
    const home = join(root, 'home')
    await createHome(home)
    const source = join(root, 'source')
    await mkdir(source, { recursive: true })
    await writeFile(join(root, 'outside.md'), 'outside\n')
    await symlink(join(root, 'outside.md'), join(source, 'linked.md'))
    const item = await writeItem(source, extension({ files: [{ path: 'linked.md', type: 'hairness:file' }] }))
    await assert.rejects(() => addItems(home, [item]), (error) => error.code === 'symlink_forbidden')
    await assert.rejects(readFile(join(home, 'extensions/fixture/review/hairness.item.json')), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('private namespace headers expand from the environment without persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-private-'))
  const previousFetch = globalThis.fetch
  const previousToken = process.env.HAIRNESS_REGISTRY_TOKEN
  try {
    const home = join(root, 'home')
    await createHome(home)
    const document = JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8'))
    document.registries['@private'] = { url: 'https://registry.example/{name}.json', headers: { Authorization: 'Bearer ${HAIRNESS_REGISTRY_TOKEN}' } }
    await writeFile(join(home, 'hairness.json'), `${JSON.stringify(document, null, 2)}\n`)
    process.env.HAIRNESS_REGISTRY_TOKEN = 'test-token-never-persisted'
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token-never-persisted')
      return new Response(JSON.stringify(extension({ files: [{ path: 'review.md', type: 'hairness:file', content: 'Remote.\n' }] })), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await addItems(home, ['@private/review'])
    const receipt = await readFile(join(home, 'extensions/private/review/hairness.item.json'), 'utf8')
    assert.equal(receipt.includes('test-token-never-persisted'), false)
    await assert.rejects(() => resolveItem(home, 'https://registry.example/review.json?token=forbidden'), (error) => error.code === 'source_insecure')
  } finally {
    globalThis.fetch = previousFetch
    if (previousToken === undefined) delete process.env.HAIRNESS_REGISTRY_TOKEN
    else process.env.HAIRNESS_REGISTRY_TOKEN = previousToken
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub addresses resolve tags and record the exact commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-github-'))
  const previous = Object.fromEntries(['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1'].map((key) => [key, process.env[key]]))
  try {
    const repository = join(root, 'source')
    const github = join(root, 'github')
    const bare = join(github, 'acme/assets.git')
    await mkdir(repository, { recursive: true })
    await exec('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repository })
    const registry = {
      $schema: 'https://hairness.dev/schema/registry.json', name: 'acme',
      items: [extension({ registry: undefined })],
    }
    delete registry.items[0].registry
    await writeFile(join(repository, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`)
    await mkdir(join(repository, 'skills/review'), { recursive: true })
    await writeFile(join(repository, 'skills/review/SKILL.md'), 'GitHub source.\n')
    await exec('git', ['add', '--all'], { cwd: repository })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'registry'], { cwd: repository })
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
    await addItems(home, ['acme/assets/review#v1.0.0'])
    const receipt = JSON.parse(await readFile(join(home, 'extensions/acme/review/hairness.item.json'), 'utf8'))
    assert.equal(receipt.requestedRef, 'v1.0.0')
    assert.equal(receipt.resolvedCommit, commit)
    assert.equal(receipt.mobile, false)
    assert.equal(await readFile(join(home, 'extensions/acme/review/skills/review/SKILL.md'), 'utf8'), 'GitHub source.\n')
    assert.equal((await resolveItem(home, 'acme/assets/review#main')).mobile, true)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
