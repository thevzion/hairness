import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repository = resolve(new URL('../', import.meta.url).pathname)
const suppliedLab = process.argv[2] ? resolve(process.argv[2]) : null
const lab = suppliedLab ?? await mkdtemp(join(tmpdir(), 'hairness-v03-lab-'))
const state = join(lab, 'state')
const environment = {
  ...process.env,
  HAIRNESS_STATE_HOME: state,
  GIT_TERMINAL_PROMPT: '0',
  npm_config_update_notifier: 'false',
}

try {
  const packDirectory = join(lab, 'pack')
  await mkdir(packDirectory, { recursive: true })
  const packed = await commandJson('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory], repository)
  const tarball = join(packDirectory, packed[0].filename)

  const launcher = join(lab, 'launcher')
  await mkdir(launcher, { recursive: true })
  await writeFile(join(launcher, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`)
  await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', tarball], launcher)
  const bootstrap = join(launcher, 'node_modules', '.bin', 'hairness')

  const minimalHome = join(lab, 'Minimal Home')
  const minimal = await hairnessJson(bootstrap, [
    'create', minimalHome,
    '--yes',
    '--preset', 'minimal',
    '--language', 'en',
    '--providers', 'claude',
    '--target', 'skip',
    '--overlay-git=false',
    '--package-spec', `file:${tarball}`,
  ], launcher)
  assert.equal(minimal.status, 'created')
  assert.deepEqual(minimal.preview.extensions, ['hairness/cockpit', 'hairness/work'])
  assert.equal(minimal.launch.length, 1)
  assert.equal(minimal.launch[0].provider, 'claude')
  assert.equal(minimal.launch[0].command.includes('--add-dir'), false)
  await assert.rejects(readFile(join(minimalHome, '.overlay/.git/HEAD')), (error) => error.code === 'ENOENT')
  const minimalBuild = JSON.parse(await readFile(join(state, 'runtime/minimal-home/build.json'), 'utf8'))
  assert.equal(minimalBuild.outputs.length, 8)

  const target = join(lab, 'product')
  await mkdir(join(target, 'src'), { recursive: true })
  await writeFile(join(target, 'README.md'), '# Product target\n')
  await writeFile(join(target, 'src', 'index.js'), 'export const ready = true\n')
  await command('git', ['init', '--quiet', '--initial-branch=main'], target)
  await command('git', ['add', '--all'], target)
  await command('git', ['-c', 'user.name=Hairness Lab', '-c', 'user.email=lab@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize product'], target)
  const base = (await command('git', ['rev-parse', 'HEAD'], target)).stdout.trim()

  const home = join(lab, 'Hairness Home')
  const created = await hairnessJson(bootstrap, [
    'create', home,
    '--yes',
    '--preset', 'standard',
    '--language', 'fr',
    '--providers', 'codex,claude',
    '--target', target,
    '--target-id', 'product',
    '--overlay-git=true',
    '--package-spec', `file:${tarball}`,
  ], launcher)
  assert.equal(created.status, 'created')
  assert.deepEqual(created.preview.extensions, [
    'hairness/cockpit',
    'hairness/work',
    'hairness/sources',
    'hairness/codebase',
    'hairness/delivery',
  ])
  assert.deepEqual(created.launch.map((entry) => entry.provider), ['codex', 'claude'])

  const cli = join(home, 'node_modules', '.bin', 'hairness')
  const doctor = await hairnessJson(cli, ['doctor'], home)
  assert.equal(doctor.status, 'ready')
  const opening = await hairnessJson(cli, ['opening'], home)
  assert.equal(opening.home.language, 'fr')
  assert.match(created.launch[0].command, /codex -C/)
  assert.match(created.launch[1].command, /claude --add-dir/)

  const answers = {
    situation: 'Un dépôt Git existant, déjà configuré sur cette machine.',
    'project-context': 'Prouver le parcours v0.3 sans coupler la mémoire au dépôt produit.',
    'working-memory': 'Proposer un Scratch quand le sujet devient durable ou doit être transmis.',
    'work.boundaries': 'Conserver uniquement les décisions, contraintes, handoffs et prochaines étapes.',
    'codebase.focus': 'Commencer par les frontières et le flux principal du dépôt.',
  }
  let onboarding = await hairnessJson(cli, ['onboarding', 'status'], home)
  while (onboarding.next) {
    const answer = answers[onboarding.next.id] ?? `Réponse de qualification pour ${onboarding.next.id}.`
    onboarding = await hairnessJson(cli, ['onboarding', 'answer', onboarding.next.id, '--value', answer], home)
  }
  const onboardingPlan = await hairnessJson(cli, ['onboarding', 'plan'], home)
  assert.equal(onboardingPlan.status, 'checkpoint-required')
  const onboarded = await hairnessJson(cli, ['onboarding', 'apply', onboardingPlan.checkpoint.metadata.id], home)
  assert.equal(onboarded.status, 'complete')

  await hairnessJson(cli, ['scratch', 'create', 'Golden product journey', '--id', 'golden'], home)
  await hairnessJson(cli, [
    'scratch', 'note',
    '--kind', 'decision',
    '--text', 'Le Home reste indépendant du Target et le recap demeure chat-first.',
  ], home)

  const installedPackage = join(home, 'node_modules', '@hairness', 'cli')
  process.env.HAIRNESS_STATE_HOME = state
  const { mapTarget } = await import(pathToFileURL(join(installedPackage, 'src', 'maps', 'index.mjs')).href)
  const map = await mapTarget(home, 'product', { view: 'tree', scope: 'src' })
  assert.deepEqual(map.files, ['src/index.js'])
  assert.equal(map.persistence, 'none')

  const recap = '# Accepted recap\n\n```mermaid\nflowchart LR\n  Home --> Target\n  Scratch --> Artifact\n```\n'
  const artifact = await hairnessJson(cli, [
    'artifact', 'save', 'hairness/work', 'recap', 'golden-recap',
    '--value', recap,
  ], home)
  assert.equal(artifact.payload, recap)

  const extension = join(lab, 'review-extension')
  await hairnessJson(cli, ['extension', 'init', 'acme/review', '--path', extension], home)
  await command('git', ['init', '--quiet', '--initial-branch=main'], extension)
  await command('git', ['add', '--all'], extension)
  await command('git', ['-c', 'user.name=Hairness Lab', '-c', 'user.email=lab@hairness.dev', 'commit', '--quiet', '-m', 'feat: add review extension'], extension)
  const extensionHead = (await command('git', ['rev-parse', 'HEAD'], extension)).stdout.trim()
  const extensionPlan = await hairnessJson(cli, [
    'extension', 'add', pathToFileURL(extension).href, '--ref', 'main',
  ], home)
  assert.equal(extensionPlan.preview.id, 'acme/review')
  const extensionReceipt = await hairnessJson(cli, [
    'extension', 'add', '--checkpoint', extensionPlan.checkpoint.metadata.id,
  ], home)
  assert.equal(extensionReceipt.spec.outcome, 'succeeded')
  const homeLock = JSON.parse(await readFile(join(home, 'hairness.lock.json'), 'utf8'))
  const lockedExtension = homeLock.extensions.find((entry) => entry.id === 'acme/review')
  assert.equal(lockedExtension.resolvedCommit, extensionHead)
  assert.match(lockedExtension.digest, /^sha256:[a-f0-9]{64}$/)

  const brief = await hairnessJson(cli, [
    'delivery', 'brief', '--inputs-json', JSON.stringify({
      accepted: true,
      id: 'golden-delivery',
      scratch: 'golden',
      outcome: 'Prove the v0.3 delivery boundary.',
      acceptanceCriteria: ['The exact PR effect requires a fresh checkpoint.'],
      scope: ['src'],
      nonGoals: ['Publishing or merging the PR.'],
      target: 'product',
      base,
      releaseImpact: 'none',
      requiredChecks: ['test'],
    }),
  ], home)
  assert.equal(brief.envelope.metadata.type, 'delivery-brief')
  const checkout = await hairnessJson(cli, [
    'delivery', 'checkout', '--inputs-json', JSON.stringify({
      target: 'product',
      scratch: 'golden',
      base,
      parallel: true,
    }),
  ], home)
  assert.equal(checkout.strategy, 'isolate')
  await writeFile(join(checkout.path, 'src', 'feature.js'), 'export const shipped = false\n')
  await command('git', ['add', '--all'], checkout.path)
  await command('git', ['-c', 'user.name=Hairness Lab', '-c', 'user.email=lab@hairness.dev', 'commit', '--quiet', '-m', 'feat: prove delivery checkout'], checkout.path)
  const pullRequestCheckpoint = await hairnessJson(cli, [
    'delivery', 'prepare-pr', '--inputs-json', JSON.stringify({
      brief: 'golden-delivery',
      checkout: checkout.path,
      title: 'Prove the v0.3 delivery boundary',
      body: 'Prepared by the packed-tarball lab.',
      checks: { test: 'passed' },
    }),
  ], home)
  assert.equal(pullRequestCheckpoint.spec.operation, 'delivery.publish-pr')

  assert.equal((await command('git', ['remote'], home)).stdout.trim(), '')
  assert.equal((await command('git', ['remote'], join(home, '.overlay'))).stdout.trim(), '')
  const trackedProviderFiles = (await command('git', ['ls-files', '.agents', '.claude'], home)).stdout.trim().split('\n').filter(Boolean)
  assert.deepEqual(trackedProviderFiles, ['.agents/skills/.gitkeep', '.claude/skills/.gitkeep'])
  const overlayFiles = await filesBelow(join(home, '.overlay'))
  assert.ok(!overlayFiles.some((path) => /transcript|reasoning/i.test(path)))
  assert.ok(overlayFiles.some((path) => path.endsWith('golden-recap/payload.md')))
  assert.ok(!overlayFiles.some((path) => path.includes('checkpoints/')))

  console.log(JSON.stringify({
    status: 'passed',
    tarball: basename(tarball),
    home: basename(home),
    providers: created.launch.map((entry) => entry.provider),
    language: opening.home.language,
    target: map.target,
    extension: extensionPlan.preview.id,
    prCheckpoint: pullRequestCheckpoint.metadata.id,
    overlayFiles: overlayFiles.length,
  }, null, 2))
} finally {
  if (!suppliedLab && process.env.HAIRNESS_KEEP_LAB !== '1') await rm(lab, { recursive: true, force: true })
}

async function hairnessJson(binary, args, cwd) {
  const result = await command(binary, [...args, '--json'], cwd)
  const envelope = JSON.parse(result.stdout)
  if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`)
  return envelope.data
}

async function command(file, args, cwd) {
  return exec(file, args, { cwd, env: environment, maxBuffer: 20 * 1024 * 1024 })
}

async function commandJson(file, args, cwd) {
  return JSON.parse((await command(file, args, cwd)).stdout)
}

async function filesBelow(root) {
  const values = []
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath)
      else values.push(relativePath)
    }
  }
  await visit(root)
  return values.sort()
}
