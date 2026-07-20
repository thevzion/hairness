#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { addItems, diffItem, removeItem, statusItems, syncItems } from './arranger.mjs'
import { buildHome } from './build.mjs'
import { createHome, initHome } from './create.mjs'
import { doctorHome } from './doctor.mjs'
import { assertRuntime, findHome } from './home.mjs'
import { addIntegration, bindIntegration, doctorIntegrations, listIntegrations, parseAccessors, removeIntegration, unbindIntegration } from './integrations.mjs'
import { asHairnessError, HairnessError } from './lib/errors.mjs'
import { prologueModel, renderPrologue } from './prologue.mjs'
import { listRegistry, searchRegistry, validateRegistry, viewItems } from './registry.mjs'
import { readJson } from './lib/io.mjs'
import { addTarget, bindTarget, discoverTargets, doctorTargets, listTargets, removeTarget, unbindTarget } from './targets.mjs'

export async function runCli(argv = process.argv.slice(2), io = process) {
  const { positionals, flags } = parseArguments(argv)
  const [command, action, ...rest] = positionals
  try {
    const value = await route(command, action, rest, flags, io)
    if (command === 'prologue' && !flags.json) return write(io.stdout, renderPrologue(value))
    return write(io.stdout, flags.json ? JSON.stringify(value, null, 2) : renderHuman(value, [command, action]))
  } catch (caught) {
    const error = asHairnessError(caught)
    write(io.stderr, flags.json ? JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2) : `${error.code}: ${error.message}`)
    return error.exitCode
  }
}

async function route(command, action, rest, flags, io) {
  if (!command) return help()
  if (command === 'create') return createHome(required(action, 'destination'), {
    baseItem: rest[0], providers: csv(flags.providers), language: flags.language, name: flags.name, addressAs: flags['address-as'], note: flags.note,
  })
  if (command === 'init') return initHome(flags.home ?? process.cwd(), {
    items: [action, ...rest].filter(Boolean), providers: csv(flags.providers), language: flags.language, name: flags.name, addressAs: flags['address-as'], note: flags.note,
  })
  if (command === 'registry' && action === 'validate') return validateRegistry(await readJson(required(rest[0], 'registry.json')))
  const root = await findHome(flags.home ?? process.cwd())
  await assertRuntime(root)
  if (command === 'add') {
    const addresses = [action, ...rest].filter(Boolean)
    if (!addresses.length) throw usage('At least one item is required.')
    if (booleanFlag(flags.view)) return viewItems(root, addresses)
    const overwrite = booleanFlag(flags.overwrite)
    const preview = await addItems(root, addresses, { dryRun: true, overwrite })
    if (booleanFlag(flags['dry-run']) || booleanFlag(flags.diff)) return preview
    if (!booleanFlag(flags.yes) && !await confirm(io, preview)) throw new HairnessError('confirmation_required', 'Installation cancelled. Pass -y for non-interactive use.')
    return addItems(root, addresses, { overwrite })
  }
  if (command === 'view') {
    const addresses = [action, ...rest].filter(Boolean)
    if (!addresses.length) throw usage('At least one item is required.')
    return viewItems(root, addresses)
  }
  if (command === 'list') return listRegistry(root, required(action, 'registry'))
  if (command === 'search') return searchRegistry(root, required(action, 'registry'), flags.query ?? '')
  if (command === 'status') return statusItems(root, action)
  if (command === 'diff') return diffItem(root, required(action, 'item'), { to: flags.to })
  if (command === 'sync') {
    if (!action && !booleanFlag(flags.all)) throw usage('An item or --all is required.')
    return syncItems(root, action, { all: booleanFlag(flags.all), check: booleanFlag(flags.check), to: flags.to, overwrite: booleanFlag(flags.overwrite) })
  }
  if (command === 'remove') return removeItem(root, required(action, 'item'), { overwrite: booleanFlag(flags.overwrite) })
  if (command === 'build') return buildHome(root, { check: booleanFlag(flags.check), allowAdapters: values(flags['allow-adapter']) })
  if (command === 'doctor') return doctorHome(root)
  if (command === 'prologue') return prologueModel(root)
  if (command === 'target') return targetRoute(root, action, rest, flags)
  if (command === 'integration') return integrationRoute(root, action, rest, flags)
  throw usage(`Unknown command ${command}.`)
}

async function targetRoute(root, action, rest, flags) {
  if (action === 'list') return listTargets(root)
  if (action === 'doctor') return doctorTargets(root)
  if (action === 'discover') return discoverTargets(required(rest[0], 'discovery root'))
  if (action === 'add') return addTarget(root, required(rest[0], 'repository'), { id: flags.id, summary: flags.summary })
  if (action === 'bind') return bindTarget(root, required(rest[0], 'Target id'), required(rest[1], 'repository path'))
  if (action === 'unbind') return unbindTarget(root, required(rest[0], 'Target id'))
  if (action === 'remove') return removeTarget(root, required(rest[0], 'Target id'))
  throw usage('hairness target list|discover|add|bind|unbind|remove|doctor')
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
    summary: 'Hairness arranges source-owned agentic assets for any agent runtime.',
    next: ['hairness create <home>', 'hairness add <item>', 'hairness doctor'],
    commands: [
      'init [items...]', 'create <home> [base-item]', 'add <items...>', 'view <items...>', 'list <registry>', 'search <registry> [--query <text>]',
      'status [item]', 'diff <item>', 'sync [item|--all]', 'remove <item>', 'registry validate <registry.json>', 'build [--check] [--allow-adapter <id>]',
      'doctor [--json]', 'prologue [--json]', 'target list|discover|add|bind|unbind|remove|doctor', 'integration list|add|bind|unbind|remove|doctor',
    ],
  }
}

function parseArguments(argv) {
  const flags = {}
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '-y') { flags.yes = true; continue }
    if (!value.startsWith('--')) { positionals.push(value); continue }
    const [name, inline] = value.slice(2).split('=', 2)
    const next = inline ?? (argv[index + 1] && !argv[index + 1].startsWith('-') ? argv[++index] : true)
    if (flags[name] === undefined) flags[name] = next
    else flags[name] = Array.isArray(flags[name]) ? [...flags[name], next] : [flags[name], next]
  }
  return { flags, positionals }
}

function renderHuman(value, command) {
  if (value?.summary && value?.commands) return [value.summary, '', 'Next:', ...value.next.map((item) => `  ${item}`), '', 'Commands:', ...value.commands.map((item) => `  hairness ${item}`)].join('\n')
  if (value?.status === 'created') return ['Hairness Home created', value.home, `Extensions: ${value.items.join(', ')}`, '', ...value.launch.flatMap((entry) => [`${entry.provider}: ${entry.command}`, `Then invoke ${entry.onboarding}.`])].join('\n')
  if (value?.home?.id && value?.limits) return [`Hairness doctor — ${value.status}`, `Home: ${value.home.id}`, `Providers: ${value.home.providers.join(', ')}`, `Extensions: ${value.extensions.length}`, `Targets: ${value.targets.filter((entry) => entry.binding).length}/${value.targets.length} bound`, `Build: ${value.build}`, ...(value.limits.length ? ['', 'Limits:', ...value.limits.map((item) => `  - ${item}`)] : [])].join('\n')
  if (Array.isArray(value)) return value.length ? value.map((entry) => `- ${entry.id ?? entry.name ?? JSON.stringify(entry)}${entry.state ? `: ${entry.state}` : ''}`).join('\n') : 'No entries.'
  if (command[0] === 'build' && value?.outputs) return `Build ready — ${value.outputs.length} generated outputs.`
  return Object.entries(value ?? {}).map(([key, entry]) => `${key}: ${typeof entry === 'object' ? JSON.stringify(entry) : entry}`).join('\n')
}

async function confirm(io, preview) {
  if (!io.stdin?.isTTY || !io.stdout?.isTTY) return false
  io.stdout.write(`Install ${preview.items.join(', ')} and write ${preview.writes.length} files? [y/N] `)
  return new Promise((resolvePromise) => {
    io.stdin.once('data', (chunk) => resolvePromise(/^y(?:es)?\s*$/i.test(String(chunk))))
    io.stdin.resume?.()
  })
}

function csv(value) { return value === undefined ? undefined : values(value).flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean) }
function values(value) { return value === undefined ? [] : Array.isArray(value) ? value : [value] }
function booleanFlag(value) { return value === true || value === 'true' || value === 'yes' || value === '1' }
function required(value, label) { if (!value) throw usage(`${label} is required.`); return value }
function usage(message) { return new HairnessError('usage', message, { exitCode: 2 }) }
function write(stream, value) { stream.write(`${value}\n`); return 0 }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runCli()
