import Ajv2020 from 'ajv/dist/2020.js'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { validateDocument } from './contracts.mjs'
import { loadHome } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { assertInside, exists, readJson, treeDigest } from './lib/io.mjs'

const coreIds = new Set(['hairness', 'hairness-onboarding', 'hairness-scratch'])

export async function inspectExtension(path) {
  const root = await realpath(path)
  if (await exists(join(root, 'package-lock.json'))) throw new HairnessError('extension_nested_lock', 'Extensions must not contain package-lock.json.')
  await rejectProviderSources(root)
  const manifest = await validateDocument(await readJson(join(root, 'extension.json')), 'Extension')
  const paths = [
    ...(manifest.spec.instructions ?? []),
    ...(manifest.spec.skills ?? []).map((entry) => entry.path),
    ...(manifest.spec.checks ?? []).map((entry) => entry.path),
    ...(manifest.spec.prologue ? [manifest.spec.prologue.path] : []),
    ...(manifest.spec.configSchema ? [manifest.spec.configSchema] : []),
  ]
  for (const path of paths) {
    const target = assertInside(root, resolve(root, path), 'extension path')
    if (!await exists(target)) throw new HairnessError('extension_file_missing', `${manifest.metadata.id} is missing ${path}.`)
  }
  for (const skill of manifest.spec.skills ?? []) {
    if (basename(skill.path) !== 'skill.md') throw new HairnessError('extension_skill_source', `${skill.path} must be named skill.md.`)
  }
  return { root, manifest, digest: await treeDigest(root) }
}

export async function activeExtensions(root, home = null) {
  home ??= await loadHome(root)
  const extensions = []
  for (const id of home.spec.extensions) {
    const path = join(root, 'extensions', ...id.split('/'))
    if (!await exists(join(path, 'extension.json'))) throw new HairnessError('extension_missing', `Active extension ${id} is not installed.`)
    const extension = await inspectExtension(path)
    if (extension.manifest.metadata.id !== id) throw new HairnessError('extension_identity_mismatch', `${path} declares ${extension.manifest.metadata.id}, expected ${id}.`)
    extensions.push(extension)
  }
  await validateComposition(extensions, home)
  return extensions
}

export async function validateComposition(extensions, home = null) {
  const extensionIds = new Set(extensions.map((extension) => extension.manifest.metadata.id))
  const skills = new Map([...coreIds].map((id) => [id, 'hairness/kernel']))
  const commands = new Map([...coreIds].map((id) => [id, 'hairness/kernel']))
  for (const extension of extensions) {
    const manifest = extension.manifest
    for (const required of manifest.spec.requires ?? []) {
      if (!extensionIds.has(required)) throw new HairnessError('extension_dependency_missing', `${manifest.metadata.id} requires ${required}.`)
    }
    const ownedSkills = new Set()
    for (const skill of manifest.spec.skills ?? []) {
      if (skills.has(skill.id)) throw new HairnessError('skill_collision', `${skill.id} is owned by both ${skills.get(skill.id)} and ${manifest.metadata.id}.`)
      skills.set(skill.id, manifest.metadata.id)
      ownedSkills.add(skill.id)
    }
    for (const command of manifest.spec.commands ?? []) {
      if (!ownedSkills.has(command.skill)) throw new HairnessError('command_skill_missing', `${manifest.metadata.id}:${command.id} exposes unknown Skill ${command.skill}.`)
      if (commands.has(command.id) || skills.has(command.id) && command.id !== command.skill) {
        throw new HairnessError('command_collision', `Provider output ${command.id} collides.`)
      }
      commands.set(command.id, manifest.metadata.id)
    }
  }
  if (home) {
    const active = new Set(extensions.map((extension) => extension.manifest.metadata.id))
    const stale = Object.keys(home.spec.config).filter((id) => !active.has(id))
    if (stale.length) throw new HairnessError('config_owner_inactive', `Config belongs to inactive extensions: ${stale.join(', ')}.`)
    await validateExtensionConfig(home, extensions)
  }
  return { skills, commands }
}

export async function validateExtensionConfig(home, extensions) {
  const limits = []
  for (const extension of extensions) {
    const path = extension.manifest.spec.configSchema
    if (!path) continue
    const schema = JSON.parse(await readFile(assertInside(extension.root, resolve(extension.root, path), 'config schema'), 'utf8'))
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
    if (!validate(home.spec.config[extension.manifest.metadata.id] ?? {})) {
      limits.push({ id: extension.manifest.metadata.id, errors: validate.errors })
    }
  }
  return limits
}

async function rejectProviderSources(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue
      if (entry.name === 'SKILL.md') throw new HairnessError('provider_native_source', 'Extension sources use skill.md; SKILL.md is generated provider output.')
      if (entry.isSymbolicLink()) throw new HairnessError('symlink_forbidden', `Extension source contains symbolic link ${entry.name}.`)
      if (entry.isDirectory()) await visit(join(directory, entry.name))
    }
  }
  await visit(root)
}
