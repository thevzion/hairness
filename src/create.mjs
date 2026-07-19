import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHome } from './build.mjs'
import { doctorHome } from './doctor.mjs'
import { git } from './git.mjs'
import { homeDocument, homeId, localConfigDocument } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { copyTree, exists, resolvePackageFile, writeJsonAtomic } from './lib/io.mjs'
import { npm, installArgs } from './npm.mjs'
import { dependencyValue, inspectPackage, packageNameFromSpec } from './packages.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const cliPackage = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

export async function createHome(destination, options = {}) {
  const target = resolve(destination)
  if (await exists(target)) throw new HairnessError('destination_exists', `Destination already exists: ${target}.`)
  await mkdir(dirname(target), { recursive: true })
  const stage = await mkdtemp(join(dirname(target), '.hairness-create-'))
  const id = homeId(target)
  const requestedCliSpec = options.packageSpec ?? process.env.HAIRNESS_PACKAGE_SPEC ?? `@hairness/cli@${cliPackage.version}`
  const requestedStarterSpec = options.starter ?? process.env.HAIRNESS_STARTER_SPEC ?? `@hairness/starter@${cliPackage.version}`
  const starterName = options.starterName ?? packageNameFromSpec(requestedStarterSpec) ?? '@hairness/starter'
  const requestedOverrides = options.packageOverrides ?? parseOverrides(process.env.HAIRNESS_PACKAGE_OVERRIDES)
  try {
    await git(['init', '--quiet', '--initial-branch=main'], { cwd: stage })
    const cliSpec = await vendorLocalSpec(stage, '@hairness/cli', requestedCliSpec)
    const starterSpec = await vendorLocalSpec(stage, starterName, requestedStarterSpec)
    const overrides = Object.fromEntries(await Promise.all(
      Object.entries(requestedOverrides).map(async ([name, spec]) => [name, await vendorLocalSpec(stage, name, spec)]),
    ))
    const packageDocument = {
      name: id,
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      dependencies: {
        '@hairness/cli': dependencyValue(cliSpec, '@hairness/cli'),
        [starterName]: dependencyValue(starterSpec, starterName),
        ...Object.fromEntries(Object.entries(overrides).map(([name, spec]) => [name, dependencyValue(spec, name)])),
      },
      scripts: {
        build: 'hairness build',
        doctor: 'hairness doctor',
        prologue: 'hairness prologue',
      },
    }
    await writeJsonAtomic(join(stage, 'package.json'), packageDocument, 0o644)
    await npm(stage, installArgs())
    const starter = await inspectPackage(stage, starterName, 'Starter')
    promoteStarterDependencies(packageDocument, starter, overrides)
    await writeJsonAtomic(join(stage, 'package.json'), packageDocument, 0o644)
    await npm(stage, installArgs())

    const extensions = []
    for (const name of starter.manifest.extensions) {
      const extension = await inspectPackage(stage, name, 'Extension')
      if (extension.manifest.subtype === 'adapter' && !allowed(options.allowBuild, name)) {
        throw new HairnessError('adapter_approval_required', `${name} requires --allow-build ${name}.`)
      }
      extensions.push({ package: name, ...(extension.manifest.subtype === 'adapter' ? { execution: 'build' } : {}) })
    }
    const catalogs = (starter.manifest.catalogs ?? []).map((name) => ({ id: catalogId(name), package: name }))
    if (starter.manifest.template) {
      const template = await resolvePackageFile(starter.root, starter.manifest.template, `${starterName} template`)
      await copyTree(template, stage)
    }
    await mkdir(join(stage, '.overlay'), { recursive: true })
    await writeJsonAtomic(join(stage, '.overlay', 'config.json'), localConfigDocument({
      ...(options.name ? { name: options.name } : {}),
      ...(options.addressAs ? { addressAs: options.addressAs } : {}),
      responseLanguage: options.language ?? 'en',
      ...(options.note ? { note: options.note } : {}),
    }))
    await writeJsonAtomic(join(stage, 'hairness.json'), homeDocument(
      id,
      starterName,
      options.providers ?? starter.manifest.providers,
      extensions,
      catalogs,
      starter.manifest.config ?? {},
      starter.manifest.targets ?? [],
      starter.manifest.integrations ?? [],
    ), 0o644)
    await writeFile(join(stage, '.gitignore'), 'node_modules/\n.hairness/\ntargets/*\n!targets/.gitkeep\n.DS_Store\n')
    await buildHome(stage, { adapterHomeRoot: target })
    const doctor = await doctorHome(stage, { adapterHomeRoot: target })
    const blocking = doctor.limits.filter((limit) => !isExpectedLocalLimit(limit))
    if (blocking.length) throw new HairnessError('create_qualification_failed', `Created Home is partial: ${blocking.join(', ')}.`)
    await git(['add', '--all'], { cwd: stage })
    await git(['-c', 'user.name=Hairness', '-c', 'user.email=local@hairness.dev', 'commit', '--quiet', '-m', 'chore: initialize Hairness Home'], { cwd: stage })
    if (await git(['remote'], { cwd: stage })) throw new HairnessError('home_remote_forbidden', 'Home creation must not configure a remote.')
    await rename(stage, target)
    return {
      status: 'created',
      home: target,
      id,
      starter: starterName,
      launch: launchInstructions(target, options.providers ?? starter.manifest.providers),
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

function promoteStarterDependencies(homePackage, starter, overrides) {
  for (const name of [...starter.manifest.extensions, ...(starter.manifest.catalogs ?? [])]) {
    const declared = overrides[name] ? dependencyValue(overrides[name], name) : starter.document.dependencies?.[name]
    if (!declared) throw new HairnessError('starter_dependency_missing', `${starter.name} does not depend on ${name}.`)
    if (!overrides[name]) dependencyValue(`${name}@${declared}`, name)
    homePackage.dependencies[name] = declared
  }
}

function parseOverrides(value) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object')
    return parsed
  } catch (error) {
    throw new HairnessError('package_overrides_invalid', `HAIRNESS_PACKAGE_OVERRIDES ${error.message}.`)
  }
}

function allowed(value, name) {
  if (value === true) return true
  return (Array.isArray(value) ? value : value ? [value] : []).includes(name)
}

function catalogId(name) {
  return name.split('/').at(-1).replace(/^hairness-/, '')
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

async function vendorLocalSpec(stage, name, spec) {
  const value = String(spec)
  if (!value.startsWith('file:') && !value.startsWith('.') && !value.startsWith('/')) return value
  const requestedPath = resolve(value.startsWith('file:') ? value.slice('file:'.length) : value)
  if ((await lstat(requestedPath)).isSymbolicLink()) {
    throw new HairnessError('symlink_forbidden', `Local package ${name} must not be a symbolic link.`)
  }
  const source = await realpath(requestedPath)
  const stat = await lstat(source)
  const directory = name.replace(/^@/, '').replaceAll('/', '-')
  const relativePath = join('vendor', directory, basename(source))
  const destination = join(stage, relativePath)
  await mkdir(dirname(destination), { recursive: true })
  if (stat.isDirectory()) {
    await mkdir(destination)
    await copyTree(source, destination)
  } else if (stat.isFile()) {
    await copyFile(source, destination)
  } else {
    throw new HairnessError('local_package_invalid', `Local package ${name} must be a file or directory.`)
  }
  return `file:${relativePath}`
}

function isExpectedLocalLimit(limit) {
  return limit.startsWith('target-unbound:')
    || limit.startsWith('integration-unbound:')
    || limit.startsWith('integration-unavailable:')
    || limit.startsWith('integration-cli-missing:')
}
