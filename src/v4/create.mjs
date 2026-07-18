import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { doctorHome } from './doctor.mjs'
import { git } from './git.mjs'
import { homeDocument, homeId, homeLockDocument, localConfigDocument } from './home.mjs'
import { buildProviders } from './providers.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, writeJsonAtomic } from '../lib/io.mjs'

const exec = promisify(execFile)
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageDocument = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

export async function createHome(destination, options = {}) {
  const target = resolve(destination)
  if (await exists(target)) throw new HairnessError('destination_exists', `Destination already exists: ${target}.`)
  await mkdir(dirname(target), { recursive: true })
  const stage = await mkdtemp(join(dirname(target), '.hairness-create-'))
  const providers = options.providers ?? ['codex', 'claude']
  const id = homeId(target)
  const packageSpec = options.packageSpec ?? `@hairness/cli@${packageDocument.version}`
  try {
    await git(['init', '--quiet'], { cwd: stage })
    await mkdir(join(stage, '.overlay'), { recursive: true })
    await mkdir(join(stage, 'targets'), { recursive: true })
    await writeJsonAtomic(join(stage, 'hairness.json'), homeDocument(id, providers))
    await writeJsonAtomic(join(stage, '.overlay', 'config.json'), localConfigDocument({
      ...(options.name ? { name: options.name } : {}),
      ...(options.addressAs ? { addressAs: options.addressAs } : {}),
      responseLanguage: options.language ?? 'en',
      ...(options.note ? { note: options.note } : {}),
    }))
    await writeFile(join(stage, 'package.json'), `${JSON.stringify({
      name: id,
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      dependencies: { '@hairness/cli': dependencyValue(packageSpec) },
      scripts: {
        build: 'node ./node_modules/@hairness/cli/src/v4/cli.mjs build',
        doctor: 'node ./node_modules/@hairness/cli/src/v4/cli.mjs doctor',
      },
    }, null, 2)}\n`)
    await writeFile(join(stage, '.gitignore'), 'node_modules/\n.hairness/\ntargets/*\n!targets/.gitkeep\n.DS_Store\n')
    await writeFile(join(stage, 'targets', '.gitkeep'), '')
    if (options.install !== false) {
      await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: stage,
        env: { ...process.env, npm_config_update_notifier: 'false' },
        maxBuffer: 20 * 1024 * 1024,
      })
    } else {
      await writeFile(join(stage, 'package-lock.json'), `${JSON.stringify({ name: id, lockfileVersion: 3, requires: true, packages: {} }, null, 2)}\n`)
    }
    await writeJsonAtomic(join(stage, 'hairness.lock.json'), homeLockDocument(id, {
      version: packageDocument.version,
      source: packageSpec,
      integrity: await packageIntegrity(packageSpec),
    }))
    await buildProviders(stage)
    const doctor = await doctorHome(stage)
    const acceptedLimits = options.install === false ? ['kernel-dependency-missing'] : []
    const unexpected = doctor.limits.filter((limit) => !acceptedLimits.includes(limit))
    if (unexpected.length) throw new HairnessError('create_qualification_failed', `Created Home is partial: ${unexpected.join(', ')}.`)
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await rename(stage, target)
    return {
      status: 'created',
      home: target,
      id,
      launch: launchInstructions(target, providers),
    }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export function launchInstructions(home, providers, targets = []) {
  const addDirs = targets.map((path) => ` --add-dir ${quote(path)}`).join('')
  return providers.flatMap((provider) => provider === 'codex'
    ? [{ provider, command: `codex -C ${quote(home)}${addDirs}`, onboarding: '$hairness-onboarding' }]
    : [{ provider, command: `cd ${quote(home)} && claude${addDirs}`, onboarding: '/hairness-onboarding' }])
}

async function packageIntegrity(spec) {
  const raw = spec.startsWith('file:') ? spec.slice(5) : spec
  if (raw.endsWith('.tgz') && await exists(raw)) return digest(await readFile(raw))
  return digest(spec)
}

function dependencyValue(spec) {
  if (spec.startsWith('@hairness/cli@')) return spec.slice('@hairness/cli@'.length)
  if (spec.startsWith('file:')) return spec
  if (spec.endsWith('.tgz') || spec.startsWith('.') || spec.startsWith('/')) return `file:${spec}`
  return spec
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}
