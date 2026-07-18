#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createHome } from './create.mjs'
import { doctorHome } from './doctor.mjs'
import { activeExtensions } from './extensions.mjs'
import { findHome } from './home.mjs'
import { addIntegration, bindIntegration, doctorIntegrations, listIntegrations, parseAccessors, removeIntegration, unbindIntegration } from './integrations.mjs'
import { buildProviders } from './providers.mjs'
import { prologueModel, renderPrologue } from './prologue.mjs'
import { addTarget, bindTarget, doctorTargets, listTargets, removeTarget, unbindTarget } from './targets.mjs'
import { asHairnessError, HairnessError } from '../lib/errors.mjs'

export async function runCliV4(argv = process.argv.slice(2), io = process) {
  const { positionals, flags } = parseArguments(argv)
  const [command, action, ...rest] = positionals
  try {
    const value = await route(command, action, rest, flags)
    if (command === 'prologue' && !flags.json) return write(io.stdout, renderPrologue(value))
    return write(io.stdout, flags.json ? JSON.stringify(value, null, 2) : renderHuman(value, [command, action]))
  } catch (caught) {
    const error = asHairnessError(caught)
    write(io.stderr, flags.json
      ? JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2)
      : `${error.code}: ${error.message}`)
    return error.exitCode
  }
}

async function route(command, action, rest, flags) {
  if (!command) return help()
  if (command === 'create') return createHome(required(action, 'destination'), {
    providers: csv(flags.providers) ?? ['codex', 'claude'],
    language: flags.language,
    name: flags.name,
    addressAs: flags['address-as'],
    note: flags.note,
    packageSpec: flags['package-spec'] ?? process.env.HAIRNESS_PACKAGE_SPEC,
    install: flags.install === undefined ? true : booleanFlag(flags.install),
  })
  const root = await findHome(flags.home ?? process.cwd())
  if (command === 'build') return buildProviders(root, { check: booleanFlag(flags.check) })
  if (command === 'doctor') return doctorHome(root)
  if (command === 'prologue') return prologueModel(root)
  if (command === 'target') return targetRoute(root, action, rest, flags)
  if (command === 'integration') return integrationRoute(root, action, rest, flags)
  if (command === 'extension') {
    if (action === 'list' || action === 'doctor') return activeExtensions(root).then((items) => items.map((item) => ({ id: item.manifest.metadata.id, version: item.manifest.metadata.version, digest: item.digest })))
    throw usage('hairness extension list|add|update|remove|doctor')
  }
  throw usage(`Unknown command ${command}.`)
}

async function targetRoute(root, action, rest, flags) {
  if (action === 'list') return listTargets(root)
  if (action === 'doctor') return doctorTargets(root)
  if (action === 'add') return addTarget(root, required(rest[0], 'repository'), { id: flags.id, summary: flags.summary })
  if (action === 'bind') return bindTarget(root, required(rest[0], 'Target id'), required(rest[1], 'repository path'))
  if (action === 'unbind') return unbindTarget(root, required(rest[0], 'Target id'))
  if (action === 'remove') return removeTarget(root, required(rest[0], 'Target id'))
  throw usage('hairness target list|add|bind|unbind|remove|doctor')
}

async function integrationRoute(root, action, rest, flags) {
  if (action === 'list') return listIntegrations(root)
  if (action === 'doctor') return doctorIntegrations(root)
  if (action === 'add') return addIntegration(root, required(rest[0], 'Integration id'), parseAccessors(flags), flags.summary)
  if (action === 'bind') return bindIntegration(root, required(rest[0], 'Integration id'), required(rest[1], 'provider'), required(rest[2], 'accessor'))
  if (action === 'unbind') return unbindIntegration(root, required(rest[0], 'Integration id'), required(rest[1], 'provider'))
  if (action === 'remove') return removeIntegration(root, required(rest[0], 'Integration id'))
  throw usage('hairness integration list|add|bind|unbind|remove|doctor')
}

function help() {
  return {
    summary: 'Hairness is a lightweight provider-agnostic Kernel for agent workspaces.',
    next: ['hairness create <home>', 'hairness doctor', 'hairness prologue'],
    commands: [
      'create <home>', 'build [--check]', 'doctor [--json]', 'prologue [--json]',
      'extension list|add|update|remove|doctor',
      'target list|add|bind|unbind|remove|doctor',
      'integration list|add|bind|unbind|remove|doctor',
    ],
  }
}

function parseArguments(argv) {
  const flags = {}
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const [name, inline] = value.slice(2).split('=', 2)
    const next = inline ?? (argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true)
    if (flags[name] === undefined) flags[name] = next
    else flags[name] = Array.isArray(flags[name]) ? [...flags[name], next] : [flags[name], next]
  }
  return { flags, positionals }
}

function renderHuman(value, command) {
  if (value?.summary && value?.commands) return [value.summary, '', 'Next:', ...value.next.map((item) => `  ${item}`), '', 'Commands:', ...value.commands.map((item) => `  hairness ${item}`)].join('\n')
  if (value?.status === 'created') return ['Hairness Home created', value.home, '', ...value.launch.flatMap((entry) => [`${entry.provider}: ${entry.command}`, `Then invoke ${entry.onboarding}.`])].join('\n')
  if (value?.home?.id && value?.limits) return [`Hairness doctor — ${value.status}`, `Home: ${value.home.id}`, `Providers: ${value.home.providers.join(', ')}`, `Targets: ${value.targets.filter((entry) => entry.binding).length}/${value.targets.length} bound`, `Integrations: ${value.integrations.length}`, `Build: ${value.build}`, ...(value.limits.length ? ['', 'Limits:', ...value.limits.map((item) => `  - ${item}`)] : [])].join('\n')
  if (Array.isArray(value)) return value.length ? value.map((entry) => `- ${entry.id ?? JSON.stringify(entry)}`).join('\n') : 'No entries.'
  if (command[0] === 'build' && value?.outputs) return `Build ready — ${value.outputs.length} provider outputs.`
  return Object.entries(value ?? {}).map(([key, entry]) => `${key}: ${typeof entry === 'object' ? JSON.stringify(entry) : entry}`).join('\n')
}

function csv(value) {
  if (value === undefined) return undefined
  return (Array.isArray(value) ? value : [value]).flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean)
}

function booleanFlag(value) {
  return value === true || value === 'true' || value === 'yes' || value === '1'
}

function required(value, label) {
  if (!value) throw usage(`${label} is required.`)
  return value
}

function usage(message) {
  return new HairnessError('usage', message, { exitCode: 2 })
}

function write(stream, value) {
  stream.write(`${value}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runCliV4()
