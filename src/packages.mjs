import Ajv2020 from 'ajv/dist/2020.js'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { validateDocument } from './contracts.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertInside, exists, readJson, resolvePackageFile } from './lib/io.mjs'

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export async function inspectPackage(homeRoot, name, expectedKind) {
  if (!packageNamePattern.test(name)) throw new HairnessError('package_name_invalid', `Invalid package name ${name}.`)
  const documentPath = join(homeRoot, 'node_modules', ...name.split('/'), 'package.json')
  if (!await exists(documentPath)) throw new HairnessError('package_missing', `${name} is not installed.`)
  const document = await readJson(documentPath)
  if (document.name !== name) throw new HairnessError('package_identity_mismatch', `${documentPath} declares ${document.name}, expected ${name}.`)
  const manifest = await validateDocument(document.hairness, 'package')
  if (expectedKind && manifest.kind !== expectedKind) throw new HairnessError('package_kind_mismatch', `${name} is ${manifest.kind}, expected ${expectedKind}.`)
  const root = await realpath(dirname(documentPath))
  await validatePackageFiles(root, manifest)
  return { name, version: document.version, root, document, manifest }
}

export async function activeExtensions(root, home) {
  const values = []
  for (const entry of home.spec.extensions) {
    const extension = await inspectPackage(root, entry.package, 'Extension')
    if (extension.manifest.subtype === 'adapter' && entry.execution !== 'build') {
      throw new HairnessError('adapter_not_allowed', `${entry.package} requires explicit build execution approval.`)
    }
    values.push({ ...extension, selection: entry })
  }
  await validateComposition(values)
  return values
}

export async function validateComposition(extensions) {
  const names = new Set(extensions.map((extension) => extension.name))
  const skills = new Map()
  const commands = new Map()
  for (const extension of extensions) {
    for (const required of extension.manifest.requires ?? []) {
      if (!names.has(required)) throw new HairnessError('extension_dependency_missing', `${extension.name} requires ${required}.`)
    }
    const ownedSkills = new Set()
    for (const skill of extension.manifest.contributes.skills ?? []) {
      if (skills.has(skill.id)) throw new HairnessError('skill_collision', `${skill.id} is owned by both ${skills.get(skill.id)} and ${extension.name}.`)
      skills.set(skill.id, extension.name)
      ownedSkills.add(skill.id)
    }
    for (const command of extension.manifest.contributes.commands ?? []) {
      if (!ownedSkills.has(command.skill)) throw new HairnessError('command_skill_missing', `${extension.name}:${command.id} exposes unknown Skill ${command.skill}.`)
      if (commands.has(command.id) || skills.has(command.id) && command.id !== command.skill) {
        throw new HairnessError('command_collision', `Provider output ${command.id} collides.`)
      }
      commands.set(command.id, extension.name)
    }
  }
  return { skills, commands }
}

export async function validateExtensionConfig(home, extensions) {
  const limits = []
  for (const extension of extensions) {
    if (!extension.manifest.configSchema) continue
    const path = await resolvePackageFile(extension.root, extension.manifest.configSchema, `${extension.name} config schema`)
    const schema = JSON.parse(await readFile(path, 'utf8'))
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
    if (!validate(home.spec.config[extension.name] ?? {})) limits.push({ package: extension.name, errors: validate.errors })
  }
  return limits
}

export async function readCatalog(root, packageName) {
  const catalog = await inspectPackage(root, packageName, 'Catalog')
  const path = await resolvePackageFile(catalog.root, catalog.manifest.index, `${packageName} catalog index`)
  const index = JSON.parse(await readFile(path, 'utf8'))
  if (index?.apiVersion !== 'hairness.dev/catalog/v1alpha1' || !index.entries || typeof index.entries !== 'object' || Array.isArray(index.entries)) {
    throw new HairnessError('catalog_invalid', `${packageName} has an invalid catalog index.`)
  }
  for (const [id, spec] of Object.entries(index.entries)) {
    if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(id) || typeof spec !== 'string') throw new HairnessError('catalog_invalid', `${packageName} contains invalid entry ${id}.`)
    validateExactSpec(spec)
  }
  return { ...catalog, entries: index.entries }
}

export function validateExactSpec(spec) {
  const value = String(spec)
  if (value.startsWith('file:')) return value
  if (value.startsWith('.') || value.startsWith('/')) return `file:${resolve(value)}`
  if (/^(?:git\+|https?:\/\/|ssh:\/\/|git@|github:)/.test(value)) {
    const fragment = value.split('#').at(1)
    if (!fragment || !/^(?:[0-9a-f]{40}|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(fragment)) {
      throw new HairnessError('package_spec_not_exact', `Git package spec must end in an exact SemVer tag or commit SHA: ${value}.`)
    }
    return value
  }
  const parsed = registrySpec(value)
  if (!parsed || !exactVersionPattern.test(parsed.version)) {
    throw new HairnessError('package_spec_not_exact', `npm package spec must use an exact version: ${value}.`)
  }
  return value
}

export async function validateHomeInstallSpec(root, spec) {
  const value = validateExactSpec(spec)
  if (!value.startsWith('file:')) return value
  const path = assertInside(root, resolve(root, value.slice('file:'.length)), 'local package')
  const resolved = await realpath(path)
  assertInside(await realpath(root), resolved, 'local package')
  if ((await lstat(path)).isSymbolicLink()) throw new HairnessError('symlink_forbidden', 'Local package must not be a symbolic link.')
  return value
}

export async function validateDependencySource(root, name, source) {
  const value = String(source)
  return validateHomeInstallSpec(root, value.startsWith('file:') || /^(?:git\+|https?:\/\/|ssh:\/\/|git@|github:)/.test(value)
    ? value
    : `${name}@${value}`)
}

export function packageNameFromSpec(spec) {
  const parsed = registrySpec(spec)
  return parsed?.name ?? null
}

export function dependencyValue(spec, expectedName) {
  const value = validateExactSpec(spec)
  const parsed = registrySpec(value)
  if (parsed) {
    if (expectedName && parsed.name !== expectedName) throw new HairnessError('package_identity_mismatch', `${value} does not name ${expectedName}.`)
    return parsed.version
  }
  return value
}

function registrySpec(value) {
  const match = String(value).match(/^(@[^/]+\/[^@]+|[^@/]+)@(.+)$/)
  return match ? { name: match[1], version: match[2] } : null
}

async function validatePackageFiles(root, manifest) {
  const paths = []
  if (manifest.kind === 'Extension') {
    paths.push(
      ...(manifest.contributes.instructions ?? []),
      ...(manifest.contributes.files ?? []).map((entry) => entry.path),
      ...(manifest.contributes.skills ?? []).map((entry) => entry.path),
      ...(manifest.contributes.prologue ? [manifest.contributes.prologue.path] : []),
      ...(manifest.configSchema ? [manifest.configSchema] : []),
      ...(manifest.adapter ? [manifest.adapter.entry] : []),
    )
  } else if (manifest.kind === 'Starter' && manifest.template) {
    paths.push(manifest.template)
  } else if (manifest.kind === 'Catalog') {
    paths.push(manifest.index)
  }
  for (const path of paths) await resolvePackageFile(root, path)
}
