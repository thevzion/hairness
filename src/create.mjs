import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { addItems } from './arranger.mjs'
import { buildHome } from './build.mjs'
import { doctorHome } from './doctor.mjs'
import { git } from './git.mjs'
import { homeDocument, loadHome, localConfigDocument } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { exists, writeFileAtomic, writeJsonAtomic } from './lib/io.mjs'
import { resolveItem } from './registry.mjs'

export async function createHome(destination, options = {}) {
  const target = resolve(destination)
  if (await exists(target)) throw new HairnessError('destination_exists', `Destination already exists: ${target}.`)
  await mkdir(dirname(target), { recursive: true })
  const stage = await mkdtemp(join(dirname(target), '.hairness-create-'))
  try {
    await git(['init', '--quiet', '--initial-branch=main'], { cwd: stage })
    const result = await initHome(stage, { ...options, items: options.baseItem ? [options.baseItem] : options.items })
    await buildHome(stage)
    const doctor = await doctorHome(stage)
    const blocking = doctor.limits.filter((limit) => !isExpectedLocalLimit(limit))
    if (blocking.length) throw new HairnessError('create_qualification_failed', `Created Home is partial: ${blocking.join(', ')}.`)
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await rename(stage, target)
    return { status: 'created', home: target, items: result.items, launch: launchInstructions(target, result.providers) }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export async function initHome(root = process.cwd(), options = {}) {
  root = resolve(root)
  await mkdir(root, { recursive: true })
  if (await exists(join(root, 'hairness.json'))) throw new HairnessError('home_exists', `${root} already contains hairness.json.`)
  const configPath = join(root, '.overlay', 'config.json')
  const ignorePath = join(root, '.gitignore')
  const keepPath = join(root, 'targets', '.gitkeep')
  const configExisted = await exists(configPath)
  const ignoreExisted = await exists(ignorePath)
  const keepExisted = await exists(keepPath)
  const extensionsExisted = await exists(join(root, 'extensions'))
  const currentIgnore = ignoreExisted ? await readFile(ignorePath, 'utf8') : ''
  const registries = options.registries ?? {}
  await writeJsonAtomic(join(root, 'hairness.json'), homeDocument({ providers: options.providers, registries }), 0o644)
  if (!configExisted) {
    await mkdir(join(root, '.overlay'), { recursive: true })
    await writeJsonAtomic(configPath, localConfigDocument({
      ...(options.name ? { name: options.name } : {}),
      ...(options.addressAs ? { addressAs: options.addressAs } : {}),
      responseLanguage: options.language ?? 'en',
      ...(options.note ? { note: options.note } : {}),
    }))
  }
  const required = ['.hairness/', 'targets/*', '!targets/.gitkeep', '.DS_Store']
  const missing = required.filter((line) => !currentIgnore.split(/\r?\n/).includes(line))
  if (missing.length) await writeFileAtomic(ignorePath, `${currentIgnore.trimEnd()}${currentIgnore.trim() ? '\n' : ''}${missing.join('\n')}\n`, 0o644)
  await mkdir(join(root, 'targets'), { recursive: true })
  if (!keepExisted) await writeFileAtomic(keepPath, '', 0o644)

  const addresses = options.items?.length ? options.items : ['@hairness/core']
  try {
    for (const address of addresses) {
      const item = await resolveItem(root, address)
      if (item.item.type !== 'hairness:home') continue
      const home = await loadHome(root)
      home.providers = item.item.providers?.length ? item.item.providers : home.providers
      home.targets = item.item.targets ?? home.targets
      home.integrations = item.item.integrations ?? home.integrations
      home.config = { ...home.config, ...(item.item.config ?? {}) }
      await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    }
    const result = await addItems(root, addresses)
    return { status: 'initialized', home: root, providers: (await loadHome(root)).providers, items: result.items }
  } catch (error) {
    await rm(join(root, 'hairness.json'), { force: true })
    if (!configExisted) await rm(configPath, { force: true })
    if (ignoreExisted) await writeFileAtomic(ignorePath, currentIgnore, 0o644)
    else await rm(ignorePath, { force: true })
    if (!keepExisted) await rm(keepPath, { force: true })
    if (!extensionsExisted) await rm(join(root, 'extensions'), { recursive: true, force: true })
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
