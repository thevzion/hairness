import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(new URL('../', import.meta.url).pathname)
const lab = await mkdtemp(join(tmpdir(), 'hairness-v04-lab-'))

async function command(file, args, cwd) {
  return exec(file, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_update_notifier: 'false' }, maxBuffer: 20 * 1024 * 1024 })
}

try {
  const pack = join(lab, 'pack')
  await mkdir(pack)
  const packed = JSON.parse((await command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', pack], root)).stdout)[0]
  const tarball = join(pack, packed.filename)
  const launcher = join(lab, 'launcher')
  await mkdir(launcher)
  await writeFile(join(launcher, 'package.json'), '{"private":true}\n')
  await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', tarball], launcher)
  const hairness = join(launcher, 'node_modules', '.bin', 'hairness')

  const target = join(lab, 'target')
  await mkdir(target)
  await command('git', ['init', '--quiet', '--initial-branch=main'], target)
  await writeFile(join(target, 'README.md'), '# Target\n')
  await command('git', ['add', 'README.md'], target)
  await command('git', ['-c', 'user.name=Hairness Lab', '-c', 'user.email=lab@hairness.dev', 'commit', '--quiet', '-m', 'initial'], target)
  await command('git', ['remote', 'add', 'origin', 'git@github.com:acme/target.git'], target)

  const home = join(lab, 'home')
  const created = JSON.parse((await command(hairness, ['create', home, '--providers', 'codex,claude', '--language', 'fr', '--package-spec', `file:${tarball}`, '--json'], launcher)).stdout)
  assert.equal(created.status, 'created')
  const cli = join(home, 'node_modules', '.bin', 'hairness')
  const targetResult = JSON.parse((await command(cli, ['target', 'add', target, '--id', 'product', '--json'], home)).stdout)
  assert.equal(targetResult.matches, true)
  const integration = JSON.parse((await command(cli, ['integration', 'add', 'jira', '--cli', 'jira', '--json'], home)).stdout)
  assert.equal(integration.id, 'jira')
  await command(cli, ['integration', 'bind', 'jira', 'codex', 'cli:jira', '--json'], home).catch(() => {})
  await command(cli, ['build', '--check', '--json'], home)
  const prologue = JSON.parse((await command(cli, ['prologue', '--json'], home)).stdout)
  assert.equal(prologue.preferences.responseLanguage, 'fr')
  await mkdir(join(home, '.overlay', 'scratches', 'hairness-reset'), { recursive: true })
  await writeFile(join(home, '.overlay', 'scratches', 'hairness-reset', 'scratch.md'), '# Hairness reset\n')
  const status = (await command('git', ['status', '--short'], home)).stdout
  assert.equal(status.includes('.agents/skills/'), false)
  assert.equal(status.includes('.claude/skills/'), false)
  const overlay = await readdir(join(home, '.overlay', 'scratches', 'hairness-reset'))
  assert.deepEqual(overlay, ['scratch.md'])
  console.log(JSON.stringify({ status: 'passed', home, target: targetResult.repository, providers: created.launch.map((entry) => entry.provider) }, null, 2))
} finally {
  await rm(lab, { recursive: true, force: true })
}
