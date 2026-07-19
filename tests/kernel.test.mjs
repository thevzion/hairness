import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { buildHome } from '../src/build.mjs'
import { compileSchemas } from '../src/contracts.mjs'
import { createHome } from '../src/create.mjs'
import { doctorHome } from '../src/doctor.mjs'
import { prologueModel } from '../src/prologue.mjs'
import { addTarget, listTargets } from '../src/targets.mjs'
import { validateDependencySource, validateExactSpec, validateHomeInstallSpec } from '../src/packages.mjs'
import { packHairness } from '../scripts/lib/pack.mjs'
import { packedHomeOptions } from './helpers.mjs'

const exec = promisify(execFile)
const projectRoot = new URL('../', import.meta.url).pathname

test('the package contract creates a locked Home without a Hairness lock', async () => {
  assert.deepEqual(await compileSchemas(), ['home', 'package', 'prologue'])
  for (const invalid of ['@hairness/native@next', '@hairness/native@^0.4.0', 'github:acme/native#main']) {
    assert.throws(() => validateExactSpec(invalid), (error) => error.code === 'package_spec_not_exact')
  }
  await assert.rejects(
    () => validateHomeInstallSpec('/tmp/hairness-home', 'file:/tmp/outside-package.tgz'),
    (error) => error.code === 'path_escape',
  )
  await assert.rejects(
    () => validateDependencySource('/tmp/hairness-home', '@hairness/native', '^0.4.0'),
    (error) => error.code === 'package_spec_not_exact',
  )
  const root = await mkdtemp(join(tmpdir(), 'hairness-kernel-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    const linkedCli = join(root, 'cli-link.tgz')
    await symlink(packs.cli, linkedCli)
    await assert.rejects(
      () => createHome(join(root, 'linked-home'), { ...packedHomeOptions(packs), packageSpec: `file:${linkedCli}` }),
      (error) => error.code === 'symlink_forbidden',
    )
    const home = join(root, 'home')
    await createHome(home, { ...packedHomeOptions(packs), language: 'fr' })
    const document = JSON.parse(await readFile(join(home, 'hairness.json'), 'utf8'))
    assert.equal(document.apiVersion, 'hairness.dev/home/v1alpha3')
    assert.equal(document.spec.starter, '@hairness/starter')
    assert.deepEqual(document.spec.extensions, [{ package: '@hairness/native' }])
    await assert.rejects(readFile(join(home, 'hairness.lock.json')), (error) => error.code === 'ENOENT')
    const packageDocument = JSON.parse(await readFile(join(home, 'package.json'), 'utf8'))
    const lock = JSON.parse(await readFile(join(home, 'package-lock.json'), 'utf8'))
    for (const source of Object.values(packageDocument.dependencies)) assert.match(source, /^file:vendor\//)
    assert.match((await exec('git', ['ls-files', 'vendor'], { cwd: home })).stdout, /hairness-cli-0\.4\.0-alpha\.0\.tgz/)
    assert.equal(lock.lockfileVersion, 3)
    assert.equal((await doctorHome(home)).status, 'ready')
    await buildHome(home, { check: true })
    assert.equal((await prologueModel(home)).preferences.responseLanguage, 'fr')
    assert.match(await readFile(join(home, '.agents/skills/hairness/SKILL.md'), 'utf8'), /# \$hairness/)
    assert.match(await readFile(join(home, '.claude/skills/hairness/SKILL.md'), 'utf8'), /# \/hairness/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Home binds an independent Git Target without tracking its path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-target-'))
  try {
    const packs = await packHairness(projectRoot, join(root, 'packs'))
    const home = join(root, 'home')
    const target = join(root, 'target')
    await createHome(home, { ...packedHomeOptions(packs), providers: ['codex'] })
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
