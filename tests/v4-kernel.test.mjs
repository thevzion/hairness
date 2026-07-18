import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { compileSchemas } from '../src/v4/contracts.mjs'
import { createHome } from '../src/v4/create.mjs'
import { doctorHome } from '../src/v4/doctor.mjs'
import { buildProviders } from '../src/v4/providers.mjs'
import { prologueModel, renderPrologue } from '../src/v4/prologue.mjs'
import { addTarget, listTargets } from '../src/v4/targets.mjs'

const exec = promisify(execFile)

test('vNext compiles four contracts and creates an atomic provider-neutral Home', async () => {
  assert.equal((await compileSchemas()).length, 4)
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-'))
  try {
    const home = join(root, 'home')
    const created = await createHome(home, { providers: ['codex', 'claude'], language: 'fr', install: false })
    assert.equal(created.status, 'created')
    assert.deepEqual(created.launch.map((entry) => entry.provider), ['codex', 'claude'])
    assert.equal(await exec('git', ['remote'], { cwd: home }).then(({ stdout }) => stdout.trim()), '')
    assert.match(await readFile(join(home, 'AGENTS.md'), 'utf8'), /Speak fr/)
    assert.match(await readFile(join(home, 'CLAUDE.md'), 'utf8'), /hairness-prologue/)
    for (const command of ['hairness', 'hairness-onboarding', 'hairness-scratch']) {
      assert.match(await readFile(join(home, '.agents/skills', command, 'SKILL.md'), 'utf8'), new RegExp(`\\$${command}`))
      assert.match(await readFile(join(home, '.claude/skills', command, 'SKILL.md'), 'utf8'), new RegExp(`/${command}`))
    }
    const doctor = await doctorHome(home)
    assert.deepEqual(doctor.limits, ['kernel-dependency-missing'])
    assert.equal(await readdir(join(home, '.overlay')).then((entries) => entries.includes('scratches')), false)
    await assert.rejects(
      () => createHome(home, { install: false }),
      (error) => error.code === 'destination_exists',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('vNext binds an independent Git Target and renders orientation without claiming health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-target-'))
  try {
    const home = join(root, 'home')
    const target = join(root, 'target')
    await createHome(home, { providers: ['codex'], language: 'fr', install: false })
    await mkdir(target)
    await exec('git', ['init', '--quiet', '--initial-branch=main'], { cwd: target })
    await writeFile(join(target, 'README.md'), '# Target\n')
    await exec('git', ['add', 'README.md'], { cwd: target })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial'], { cwd: target })
    await exec('git', ['remote', 'add', 'origin', 'git@github.com:acme/target.git'], { cwd: target })

    await addTarget(home, target, { id: 'target' })
    const [entry] = await listTargets(home)
    assert.equal(entry.repository, 'github.com/acme/target')
    assert.equal(entry.binding, await realpath(target))
    assert.equal(entry.matches, true)
    assert.equal((await exec('git', ['status', '--short'], { cwd: home })).stdout.includes('targets/'), false)

    const model = await prologueModel(home)
    assert.equal(model.preferences.responseLanguage, 'fr')
    assert.equal(model.facts.find((fact) => fact.id === 'target.target.binding').value, await realpath(target))
    assert.equal(model.signals.some((signal) => signal.id.includes('health')), false)
    assert.match(renderPrologue(model), /^<hairness-prologue version="1">/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('vNext rebuild preserves unmanaged provider files and detects preference staleness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v4-build-'))
  try {
    const home = join(root, 'home')
    await createHome(home, { providers: ['codex'], language: 'en', install: false })
    const native = join(home, '.agents', 'skills', 'native', 'SKILL.md')
    await mkdir(join(native, '..'), { recursive: true })
    await writeFile(native, 'native\n')
    const hooksPath = join(home, '.codex', 'hooks.json')
    const hooks = JSON.parse(await readFile(hooksPath, 'utf8'))
    hooks.hooks.SessionStart.push({ matcher: 'custom', hooks: [{ type: 'command', command: 'custom-hook' }] })
    await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`)
    await buildProviders(home)
    assert.equal(await readFile(native, 'utf8'), 'native\n')
    assert.equal(JSON.parse(await readFile(hooksPath, 'utf8')).hooks.SessionStart.some((entry) => entry.matcher === 'custom'), true)

    const configPath = join(home, '.overlay', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    config.preferences.responseLanguage = 'fr'
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await assert.rejects(() => buildProviders(home, { check: true }), (error) => error.code === 'build_stale')
    await buildProviders(home)
    await buildProviders(home, { check: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
