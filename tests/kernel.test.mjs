import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { buildHome } from '../src/build.mjs'
import { runCli } from '../src/cli.mjs'
import { compileSchemas, validateDocument } from '../src/contracts.mjs'
import { createHome, initHome } from '../src/create.mjs'
import { doctorHome } from '../src/doctor.mjs'
import { assertRuntime } from '../src/home.mjs'
import { prologueModel } from '../src/prologue.mjs'
import { addTarget, listTargets } from '../src/targets.mjs'

const exec = promisify(execFile)

test('create produces a Git-ready Home with onboarding and tracked projections', async () => {
  assert.deepEqual(await compileSchemas(), ['home', 'extension', 'prologue'])
  const help = captureIo()
  assert.equal(await runCli([], help.io), 0)
  assert.doesNotMatch(help.stdout(), /\b(?:registry|catalog|view|search)\b/i)
  const root = await mkdtemp(join(tmpdir(), 'hairness-kernel-'))
  try {
    const home = join(root, 'my-home')
    await createHome(home, { providers: ['codex', 'claude'] })
    const document = JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8'))
    await validateDocument(document, 'home')
    assert.deepEqual(document, {
      $schema: 'https://hairness.dev/schema/home.json',
      name: 'my-home',
      runtime: '@hairness/cli@0.4.0-alpha.0',
      providers: ['codex', 'claude'],
    })
    for (const absent of ['package.json', 'package-lock.json', 'hairness.lock.json', '.overlay/config.json']) {
      await assert.rejects(readFile(join(home, absent)), (error) => error.code === 'ENOENT')
    }
    const tracked = (await exec('git', ['ls-files'], { cwd: home })).stdout
    for (const path of [
      'extensions/hairness/onboarding/hairness.json',
      '.agents/skills/hairness/SKILL.md',
      '.agents/skills/hairness-onboarding/SKILL.md',
      '.claude/skills/hairness/SKILL.md',
      '.claude/skills/hairness-onboarding/SKILL.md',
      'AGENTS.md', 'CLAUDE.md', '.codex/hooks.json', '.claude/settings.json',
    ]) assert.match(tracked, new RegExp(`^${path.replaceAll('.', '\\.')}$`, 'm'))
    assert.doesNotMatch(tracked, /^\.hairness\//m)
    assert.equal((await doctorHome(home)).status, 'ready')
    await buildHome(home, { check: true })
    const onboarding = JSON.parse(await readFile(join(home, 'extensions/hairness/onboarding/hairness.json'), 'utf8'))
    assert.equal(onboarding.name, 'hairness/onboarding')
    assert.equal(onboarding.installation.source, '@hairness/onboarding')
    assert.match(onboarding.installation.baseManifestDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(Object.keys(onboarding.installation.baseDigests).length, onboarding.files.length)
    const prologue = await prologueModel(home)
    assert.equal(prologue.facts.find((fact) => fact.id === 'home.name').value, 'my-home')
    document.runtime = '@hairness/cli@9.0.0'
    await writeFile(join(home, 'hairness.json'), `${JSON.stringify(document, null, 2)}\n`)
    await assert.rejects(() => assertRuntime(home), (error) => error.code === 'runtime_mismatch' && /npx --yes/.test(error.message))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('init creates a bare Home and preserves an existing Overlay byte-for-byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-init-'))
  try {
    await mkdir(join(root, '.overlay'))
    const config = '{\n  "version": 1,\n  "preferences": { "name": "Existing" },\n  "integrationBindings": {}\n}\n'
    await writeFile(join(root, '.overlay/config.json'), config)
    const rejected = captureIo()
    assert.equal(await runCli(['init', '@hairness/scratch', '--home', root], rejected.io), 2)
    assert.match(rejected.stderr(), /bare Home/)
    await initHome(root, { name: 'bare-home', providers: ['codex'] })
    assert.equal(await readFile(join(root, '.overlay/config.json'), 'utf8'), config)
    await assert.rejects(readFile(join(root, 'extensions/hairness/onboarding/hairness.json')), (error) => error.code === 'ENOENT')
    await buildHome(root)
    assert.equal((await doctorHome(root)).status, 'ready')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function captureIo() {
  const out = []
  const err = []
  return {
    io: { stdout: { write: (value) => out.push(value) }, stderr: { write: (value) => err.push(value) } },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  }
}

test('a cloned Home is immediately healthy without local build state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-clone-'))
  try {
    const source = join(root, 'source')
    const clone = join(root, 'clone')
    await createHome(source)
    await exec('git', ['clone', '--quiet', source, clone])
    await assert.rejects(readFile(join(clone, '.hairness/build.json')), (error) => error.code === 'ENOENT')
    assert.equal((await doctorHome(clone)).status, 'ready')
    await buildHome(clone, { check: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Home binds an independent Git Target and exposes bounded repository state', async () => {
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
    assert.equal(entry.evidence.branch, 'main')
    assert.equal(entry.evidence.clean, true)
    const prologue = await prologueModel(home)
    assert.equal(prologue.facts.find((fact) => fact.id === 'target.target.branch').value, 'main')
    assert.equal((await exec('git', ['status', '--short'], { cwd: home })).stdout.includes('targets/'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
