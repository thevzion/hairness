import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { buildHome } from './build.mjs'
import { doctorHome } from './doctor.mjs'
import { addExtensions } from './extensions.mjs'
import { git } from './git.mjs'
import { homeDocument, homeId } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { exists, writeFileAtomic, writeJsonAtomic } from './lib/io.mjs'

export async function createHome(destination, options = {}) {
  const target = resolve(destination)
  if (await exists(target)) throw new HairnessError('destination_exists', `Destination already exists: ${target}.`)
  await mkdir(dirname(target), { recursive: true })
  const stage = await mkdtemp(join(dirname(target), '.hairness-create-'))
  try {
    await git(['init', '--quiet', '--initial-branch=main'], { cwd: stage })
    await initHome(stage, { ...options, name: options.name ?? homeId(target) })
    const addresses = ['@hairness/onboarding', ...(options.baseItem ? [options.baseItem] : [])]
    const result = await addExtensions(stage, addresses)
    await buildHome(stage)
    const doctor = await doctorHome(stage)
    const blocking = doctor.limits.filter((limit) => !isExpectedLocalLimit(limit))
    if (blocking.length) throw new HairnessError('create_qualification_failed', `Created Home is partial: ${blocking.join(', ')}.`)
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await rename(stage, target)
    return { status: 'created', home: target, extensions: result.extensions, launch: launchInstructions(target, options.providers ?? ['codex', 'claude']) }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export async function initHome(root = process.cwd(), options = {}) {
  root = resolve(root)
  await mkdir(root, { recursive: true })
  if (await exists(join(root, 'hairness.json'))) throw new HairnessError('home_exists', `${root} already contains hairness.json.`)
  const ignorePath = join(root, '.gitignore')
  const ignoreExisted = await exists(ignorePath)
  const currentIgnore = ignoreExisted ? await readFile(ignorePath, 'utf8') : ''
  try {
    await writeJsonAtomic(join(root, 'hairness.json'), homeDocument({ destination: root, name: options.name, providers: options.providers }), 0o644)
    const required = ['.hairness/', '.overlay/', 'targets/', '.DS_Store']
    const missing = required.filter((line) => !currentIgnore.split(/\r?\n/).includes(line))
    if (missing.length) await writeFileAtomic(ignorePath, `${currentIgnore.trimEnd()}${currentIgnore.trim() ? '\n' : ''}${missing.join('\n')}\n`, 0o644)
    return { status: 'initialized', home: root, providers: options.providers ?? ['codex', 'claude'], extensions: [] }
  } catch (error) {
    await rm(join(root, 'hairness.json'), { force: true })
    if (ignoreExisted) await writeFileAtomic(ignorePath, currentIgnore, 0o644)
    else await rm(ignorePath, { force: true })
    throw error
  }
}

export function launchInstructions(home, providers, targets = []) {
  const addDirs = targets.map((path) => ` --add-dir ${quote(path)}`).join('')
  return providers.flatMap((provider) => provider === 'codex'
    ? [{ provider, command: `codex -C ${quote(home)}${addDirs}`, onboarding: '$hairness-onboarding' }]
    : [{ provider, command: `cd ${quote(home)} && claude${addDirs}`, onboarding: '/hairness-onboarding' }])
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

function isExpectedLocalLimit(limit) {
  return limit.startsWith('target-unbound:')
    || limit.startsWith('integration-unbound:')
    || limit.startsWith('integration-unavailable:')
    || limit.startsWith('integration-cli-missing:')
}
