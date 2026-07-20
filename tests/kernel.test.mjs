import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { buildHome } from '../src/build.mjs'
import { compileSchemas, validateDocument } from '../src/contracts.mjs'
import { createHome, initHome } from '../src/create.mjs'
import { doctorHome } from '../src/doctor.mjs'
import { assertRuntime } from '../src/home.mjs'
import { prologueModel } from '../src/prologue.mjs'
import { validateRegistry } from '../src/registry.mjs'
import { addTarget, listTargets } from '../src/targets.mjs'
import { writeItem } from './helpers.mjs'

const exec = promisify(execFile)
const projectRoot = new URL('../', import.meta.url).pathname

test('the source-owned contract creates a Home without a package install', async () => {
  assert.deepEqual(await compileSchemas(), ['home', 'registry', 'item', 'prologue'])
  await validateRegistry(JSON.parse(await readFile(join(projectRoot, 'registry/registry.json'), 'utf8')))
  const root = await mkdtemp(join(tmpdir(), 'hairness-kernel-'))
  try {
    const home = join(root, 'home')
    await createHome(home, { language: 'fr' })
    const document = JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8'))
    await validateDocument(document, 'home')
    assert.equal(document.runtime, '@hairness/cli@0.4.0-alpha.0')
    await assert.rejects(readFile(join(home, 'package.json')), (error) => error.code === 'ENOENT')
    await assert.rejects(readFile(join(home, 'package-lock.json')), (error) => error.code === 'ENOENT')
    await assert.rejects(readFile(join(home, 'hairness.lock.json')), (error) => error.code === 'ENOENT')
    assert.match((await exec('git', ['ls-files', 'extensions'], { cwd: home })).stdout, /extensions\/hairness\/core\/hairness\.item\.json/)
    assert.equal((await doctorHome(home)).status, 'ready')
    await buildHome(home, { check: true })
    assert.equal((await prologueModel(home)).preferences.responseLanguage, 'fr')
    assert.match(await readFile(join(home, '.agents/skills/hairness/SKILL.md'), 'utf8'), /# \$hairness/)
    assert.match(await readFile(join(home, '.claude/skills/hairness/SKILL.md'), 'utf8'), /# \/hairness/)
    document.runtime = '@hairness/cli@9.0.0'
    await writeFile(join(home, 'hairness.json'), `${JSON.stringify(document, null, 2)}\n`)
    await assert.rejects(() => assertRuntime(home), (error) => error.code === 'runtime_mismatch' && /npx --yes/.test(error.message))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Home binds an independent Git Target without tracking its path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-target-'))
  try {
    const home = join(root, 'home')
    const target = join(root, 'target')
    await createHome(home, { providers: ['codex'] })
    await exec('git', ['init', '--quiet', '--initial-branch=main', target])
    await writeFile(join(target, 'README.md'), '# Target\n')
    await exec('git', ['add', 'README.md'], { cwd: target })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial'], { cwd: target })
    await exec('git', ['remote', 'add', 'origin', 'git@github.com:acme/target.git'], { cwd: target })
    await addTarget(home, target, { id: 'target' })
    const [entry] = await listTargets(home)
    assert.equal(entry.binding, await realpath(target))
    assert.equal(entry.matches, true)
    assert.equal((await exec('git', ['status', '--short'], { cwd: home })).stdout.includes('targets/'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('init preserves an existing Overlay configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-init-'))
  try {
    await mkdir(join(root, '.overlay'))
    const config = '{\n  "version": 1,\n  "preferences": { "name": "Existing" },\n  "integrationBindings": {}\n}\n'
    await writeFile(join(root, '.overlay/config.json'), config)
    await initHome(root)
    assert.equal(await readFile(join(root, '.overlay/config.json'), 'utf8'), config)
    assert.equal(JSON.parse(await readFile(join(root, 'extensions/hairness/core/hairness.item.json'), 'utf8')).id, 'hairness/core')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a hairness:home item bootstraps a reproducible Home composition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-base-home-'))
  try {
    const base = await writeItem(join(root, 'registry'), {
      registry: 'acme', name: 'engineering', version: '1.0.0', type: 'hairness:home', title: 'Acme Engineering', description: 'Engineering Home base.',
      registryDependencies: ['@hairness/core'], providers: ['codex'], targets: [], integrations: [], config: {},
      files: [{ path: 'knowledge/welcome.md', type: 'hairness:file' }],
    }, { 'knowledge/welcome.md': 'Welcome.\n' })
    const home = join(root, 'home')
    await createHome(home, { baseItem: base })
    const document = JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8'))
    assert.deepEqual(document.providers, ['codex'])
    assert.equal(JSON.parse(await readFile(join(home, 'extensions/acme/engineering/hairness.item.json'), 'utf8')).type, 'hairness:home')
    assert.equal(await readFile(join(home, 'extensions/acme/engineering/knowledge/welcome.md'), 'utf8'), 'Welcome.\n')
    assert.equal((await doctorHome(home)).status, 'ready')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
