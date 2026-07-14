import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listArtifacts, ownerArtifactValidator, saveArtifact, showArtifact, validateArtifact } from './artifacts/index.mjs'
import { inspectExtension } from './composition/extensions.mjs'
import {
  applyExtensionPlan,
  initializeExtension,
  listExtensions,
  prepareExtensionAdd,
  prepareExtensionAdopt,
  prepareExtensionRemove,
  prepareExtensionUpdate,
} from './composition/lifecycle.mjs'
import {
  acceptDeliveryBrief,
  preparePullRequest,
  releaseCheckout,
  runDeliveryGates,
  selectCheckout,
} from './delivery/index.mjs'
import { asHairnessError, HairnessError } from './lib/errors.mjs'
import { findHome } from './home/index.mjs'
import { createHome } from './home/create.mjs'
import { doctorHome } from './home/doctor.mjs'
import { runCreateWizard } from './home/wizard.mjs'
import { answerOnboarding, applyOnboarding, onboardingStatus, planOnboarding } from './onboarding/index.mjs'
import { applyAdapterEffect, prepareAdapterEffect, runAdapter } from './operations/adapters.mjs'
import { archiveOverlay, overlayStatus, snapshotOverlay } from './overlay/index.mjs'
import { buildProviders } from './providers/v3-compiler.mjs'
import {
  createScratch,
  importScratch,
  listScratches,
  noteScratch,
  setScratchStatus,
  showScratch,
  useScratch,
} from './scratch/index.mjs'
import { applyTargetPlan, discoverTargets, doctorTargets, listTargets, prepareTargetAdd, prepareTargetBind, prepareTargetRemove, prepareTargetUnbind } from './targets/index.mjs'

const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

export async function runCli(argv = process.argv.slice(2), io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  const { positionals, flags } = parseArguments(argv)
  try {
    if (flags.version || positionals[0] === 'version') return write(io.stdout, packageDocument.version)
    const result = await route(positionals, flags, io)
    write(io.stdout, flags.json ? JSON.stringify({ ok: true, data: result, limits: result?.limits ?? [], routes: result?.routes ?? [] }) : renderHuman(result, { color: Boolean(io.stdout.isTTY && !process.env.NO_COLOR), command: positionals }))
    return 0
  } catch (caught) {
    const error = asHairnessError(caught)
    const output = { ok: false, error: { code: error.code, message: error.message, details: error.details }, limits: error.limits, routes: error.routes }
    write(io.stderr, flags.json ? JSON.stringify(output) : renderHumanError(error))
    return error.exitCode
  }
}

async function route(positionals, flags, io) {
  const [namespace, action, ...rest] = positionals
  if (!namespace || namespace === 'help') return contextualHelp(flags)
  if (namespace === 'create') {
    if (!action) throw usage('hairness create <home> [--preset minimal|standard] [--from <path>]')
    const options = createOptions(flags)
    return flags.yes ? createHome(action, options) : runCreateWizard(action, options)
  }
  const root = await findHome(flags.home ?? process.cwd())
  if (namespace === 'build') return buildProviders(root, { check: Boolean(flags.check) })
  if (namespace === 'doctor') return doctorHome(root)
  if (namespace === 'onboarding') return onboardingRoute(root, action, rest, flags)
  if (namespace === 'extension') return extensionRoute(root, action, rest, flags)
  if (namespace === 'target') return targetRoute(root, action, rest, flags)
  if (namespace === 'scratch') return scratchRoute(root, action, rest, flags)
  if (namespace === 'artifact') return artifactRoute(root, action, rest, flags, io)
  if (namespace === 'overlay') return overlayRoute(root, action, flags)
  if (namespace === 'operation') return operationRoute(root, action, rest, flags, io)
  if (namespace === 'delivery') return deliveryRoute(root, action, rest, flags, io)
  throw new HairnessError('unknown_command', `Unknown command: ${namespace}.`)
}

async function onboardingRoute(root, action, rest, flags) {
  if (action === 'status') return onboardingStatus(root)
  if (action === 'answer') {
    if (!rest[0]) throw usage('hairness onboarding answer <question-id> --value <answer>')
    const answer = flags['value-json'] !== undefined ? JSON.parse(String(flags['value-json'])) : String(flags.value ?? rest.slice(1).join(' '))
    return answerOnboarding(root, rest[0], answer)
  }
  if (action === 'plan') return planOnboarding(root)
  if (action === 'apply') {
    const checkpoint = rest[0] ?? flags.checkpoint
    if (!checkpoint) throw usage('hairness onboarding apply <checkpoint-id>')
    return applyOnboarding(root, checkpoint)
  }
  throw usage('hairness onboarding status|answer|plan|apply')
}

async function extensionRoute(root, action, rest, flags) {
  if (action === 'list') return listExtensions(root)
  if (action === 'init') {
    if (!rest[0]) throw usage('hairness extension init <owner/name> [--path <directory>]')
    return initializeExtension(flags.path ?? join(process.cwd(), 'extensions', ...rest[0].split('/')), rest[0])
  }
  if (action === 'doctor') {
    if (!rest[0]) return doctorHome(root)
    return inspectExtension(join(root, 'extensions', ...rest[0].split('/')))
  }
  if (flags.checkpoint) return applyExtensionPlan(root, flags.checkpoint)
  if (action === 'adopt') {
    if (!rest[0]) throw usage('hairness extension adopt <path>')
    return prepareExtensionAdopt(root, rest[0])
  }
  if (action === 'add') {
    if (!rest[0]) throw usage('hairness extension add <source> [--ref <ref>] [--path <subtree>]')
    return prepareExtensionAdd(root, rest[0], { ref: flags.ref, path: flags.path, cwd: process.cwd() })
  }
  if (action === 'update') {
    if (flags.all) {
      const values = []
      for (const extension of await listExtensions(root)) values.push(await prepareExtensionUpdate(root, extension.id))
      return values
    }
    if (!rest[0]) throw usage('hairness extension update <id|--all>')
    return prepareExtensionUpdate(root, rest[0])
  }
  if (action === 'remove') {
    if (!rest[0]) throw usage('hairness extension remove <id>')
    return prepareExtensionRemove(root, rest[0])
  }
  throw usage('hairness extension list|init|adopt|add|update|remove|doctor')
}

async function targetRoute(root, action, rest, flags) {
  if (action === 'list') return listTargets(root)
  if (action === 'doctor') return doctorTargets(root)
  if (action === 'discover') return discoverTargets(root, required(rest[0], 'Discovery root'))
  if (flags.checkpoint) return applyTargetPlan(root, flags.checkpoint)
  if (action === 'add') {
    if (!rest[0]) throw usage('hairness target add <repository> [--id <id>]')
    return prepareTargetAdd(root, rest[0], flags.id)
  }
  if (action === 'bind') {
    if (!rest[0] || !rest[1]) throw usage('hairness target bind <id> <repository>')
    return prepareTargetBind(root, rest[0], rest[1])
  }
  if (action === 'unbind') {
    if (!rest[0]) throw usage('hairness target unbind <id>')
    return prepareTargetUnbind(root, rest[0])
  }
  if (action === 'remove') {
    if (!rest[0]) throw usage('hairness target remove <id>')
    return prepareTargetRemove(root, rest[0])
  }
  throw usage('hairness target list|discover|add|bind|unbind|remove|doctor')
}

async function scratchRoute(root, action, rest, flags) {
  if (action === 'list') return listScratches(root)
  if (action === 'show') return showScratch(root, required(rest[0], 'Scratch id'))
  if (action === 'create') return createScratch(root, { id: flags.id, title: rest.join(' ') || flags.title, context: flags.context, use: !flags['no-use'] })
  if (action === 'use') return useScratch(root, required(rest[0], 'Scratch id'))
  if (action === 'note') return noteScratch(root, { id: flags.id, kind: flags.kind, text: flags.text ?? rest.join(' ') })
  if (action === 'park' || action === 'close') return setScratchStatus(root, required(rest[0], 'Scratch id'), action === 'park' ? 'parked' : 'closed')
  if (action === 'import') return importScratch(root, required(rest[0], 'source path'), { id: flags.id, title: flags.title, use: !flags['no-use'] })
  if (action === 'snapshot') return snapshotOverlay(root, { message: flags.message })
  throw usage('hairness scratch list|show|create|use|note|park|close|import|snapshot')
}

async function artifactRoute(root, action, rest, flags, io) {
  if (action === 'list') return listArtifacts(root)
  if (action === 'show') return showArtifact(root, ...artifactIdentity(rest))
  if (action === 'validate') return validateArtifact(root, ...artifactIdentity(rest))
  if (action === 'save') {
    const [owner, type, id] = artifactIdentity(rest)
    const mediaType = flags.media ?? 'text/markdown'
    const payload = await payloadInput(flags, io, mediaType)
    const validatePayload = mediaType === 'application/json' ? await ownerArtifactValidator(root, owner, type) : undefined
    return saveArtifact(root, { owner, type, id, mediaType, payload, validatePayload, provenance: flags.provenance ? JSON.parse(flags.provenance) : {} })
  }
  throw usage('hairness artifact list|show|save|validate')
}

async function overlayRoute(root, action, flags) {
  if (action === 'status') return overlayStatus(root)
  if (action === 'snapshot') return snapshotOverlay(root, { message: flags.message })
  if (action === 'archive') return archiveOverlay(root)
  throw usage('hairness overlay status|snapshot|archive')
}

async function operationRoute(root, action, rest, flags, io) {
  if (action === 'run') return runAdapter(root, required(rest[0], 'adapter reference'), await jsonInput(flags, io))
  if (action === 'prepare') return prepareAdapterEffect(root, required(rest[0], 'adapter reference'), await jsonInput(flags, io))
  if (action === 'apply') return applyAdapterEffect(root, required(rest[0], 'checkpoint id'))
  throw usage('hairness operation run|prepare|apply')
}

async function deliveryRoute(root, action, rest, flags, io) {
  const input = ['brief', 'checkout', 'prepare-pr'].includes(action) ? await jsonInput(flags, io) : null
  if (action === 'brief') return acceptDeliveryBrief(root, input)
  if (action === 'checkout') return selectCheckout(root, input)
  if (action === 'gate') return runDeliveryGates(root, required(rest[0], 'gate stage'), flags.inputs ? JSON.parse(flags.inputs) : {})
  if (action === 'prepare-pr') return preparePullRequest(root, input)
  if (action === 'release-checkout') return releaseCheckout(root, required(rest[0], 'Target id'), required(rest[1], 'Scratch id'))
  throw usage('hairness delivery brief|checkout|gate|prepare-pr|release-checkout')
}

function createOptions(flags) {
  return {
    preset: flags.preset,
    from: flags.from,
    distributionRef: flags['distribution-ref'],
    distributionPath: flags['distribution-path'],
    language: flags.language,
    providers: flags.providers ? String(flags.providers).split(',') : undefined,
    target: flags.target === 'skip' ? null : flags.target,
    workspaceRoot: flags.workspace === 'skip' ? null : flags.workspace,
    targetId: flags['target-id'],
    overlayGit: flags['overlay-git'] === undefined ? undefined : booleanFlag(flags['overlay-git']),
    snapshot: flags.snapshot,
    packageSpec: flags['package-spec'] ?? process.env.HAIRNESS_PACKAGE_SPEC,
    yes: flags.yes === undefined ? undefined : booleanFlag(flags.yes),
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
    const [raw, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) flags[raw] = inline
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags[raw] = argv[++index]
    else flags[raw] = true
  }
  return { flags, positionals }
}

async function jsonInput(flags, io) {
  const source = flags['inputs-json'] ?? flags.file
  if (source && source !== true) {
    if (source === '-') return JSON.parse(await readStream(io.stdin))
    if (String(source).trim().startsWith('{')) return JSON.parse(source)
    return JSON.parse(await readFile(source, 'utf8'))
  }
  const body = await readStream(io.stdin)
  return body.trim() ? JSON.parse(body) : {}
}

async function payloadInput(flags, io, mediaType) {
  let raw
  if (flags.file && flags.file !== true) raw = await readFile(flags.file, 'utf8')
  else if (flags.value !== undefined) raw = String(flags.value)
  else raw = await readStream(io.stdin)
  return mediaType === 'application/json' ? JSON.parse(raw) : raw
}

async function readStream(stream) {
  if (stream.isTTY) return ''
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function artifactIdentity(rest) {
  if (rest.length < 3) throw usage('Artifact identity requires <owner> <type> <id>.')
  return rest.slice(0, 3)
}

function required(value, label) {
  if (!value) throw usage(`${label} is required.`)
  return value
}

function booleanFlag(value) {
  return value === true || value === 'true' || value === 'yes' || value === '1'
}

function usage(message) {
  return new HairnessError('usage', message, { exitCode: 2 })
}

async function contextualHelp(flags) {
  let state = { status: 'outside-home', limit: 'No Home found from the current directory.' }
  try {
    const root = await findHome(flags.home ?? process.cwd())
    const doctor = await doctorHome(root)
    state = { status: doctor.status, limit: doctor.limits[0] ?? null }
  } catch (caught) {
    const error = asHairnessError(caught)
    if (error.code !== 'home_not_found') state = { status: 'partial', limit: `${error.code}: ${error.message}` }
  }
  return {
    kind: 'help',
    summary: 'Hairness is a lightweight provider-agnostic harness for agentic assets.',
    state,
    next: ['hairness create <home>', 'hairness doctor', 'hairness onboarding status'],
    commands: [
      'create <home>', 'build [--check]', 'doctor',
      'onboarding status|answer|plan|apply', 'extension list|init|adopt|add|update|remove|doctor',
      'target list|discover|add|bind|unbind|remove|doctor', 'scratch list|show|create|use|note|park|close|import|snapshot',
      'artifact list|show|save|validate', 'overlay status|snapshot|archive', 'operation run|prepare|apply',
      'delivery brief|checkout|gate|prepare-pr|release-checkout',
    ],
  }
}

function renderHuman(value, options = {}) {
  const accent = (text) => options.color ? `\u001b[1;36m${text}\u001b[0m` : text
  const [namespace, action] = options.command ?? []
  if (value?.status === 'created' && value.launch) {
    return [accent('Hairness Home created'), value.home, '', ...value.launch.flatMap((item) => [`${item.provider}: ${item.command}`, `Then invoke ${item.onboarding}.`])].join('\n')
  }
  if (value?.kind === 'help') return [accent(value.summary), `State: ${value.state.status}${value.state.limit ? ` — ${value.state.limit}` : ''}`, '', 'Next useful routes:', ...value.next.map((item) => `  ${item}`), '', 'Deterministic commands:', ...value.commands.map((item) => `  hairness ${item}`)].join('\n')
  if (value?.home?.id && value?.targets && value?.sources) {
    return [accent(`Hairness doctor — ${value.status}`), `Home: ${value.home.id}`, `Profile: ${value.profile ? [value.profile.name, value.profile.language].filter(Boolean).join(' · ') : 'missing'}`, `Onboarding: ${value.onboarding.status}`, `Build: ${value.build.status}`, `Targets: ${value.targets.filter((item) => item.binding).length}/${value.targets.length} bound`, `Sources: ${value.sources.filter((item) => item.binding).length}/${value.sources.length} configured`, `Maps: ${value.maps.length}`, `Scratch: ${value.scratch ?? 'ephemeral'}`, ...(value.limits.length ? ['', 'Limits:', ...value.limits.map((item) => `  - ${item}`)] : []), ...(value.routes.length ? ['', 'Next:', ...value.routes.map((item) => `  ${item}`)] : [])].join('\n')
  }
  if (value?.status === 'checkpoint-required') return [accent('Checkpoint required'), ...Object.entries(value.preview ?? value.plan ?? {}).map(([key, item]) => `${key}: ${inline(item)}`), `checkpoint: ${value.checkpoint?.metadata?.id ?? 'prepared'}`].join('\n')
  if (namespace === 'onboarding' && value?.status) return [
    accent(`Onboarding — ${value.status}`),
    `Language: ${value.language}`,
    `Progress: ${value.answered?.length ?? 0}/${value.total ?? value.answered?.length ?? 0}`,
    value.next ? `Next question: ${value.next.question}` : 'Next question: none',
    value.discovery ? `Discovered repositories: ${value.discovery.candidates.length}` : 'Discovery root: not configured',
    `Detected Sources: ${value.sources?.length ?? 0}`,
    '',
    value.next ? `Answer: hairness onboarding answer ${value.next.id} ${['targets', 'sources'].includes(value.next.id) ? '--value-json <json-array>' : '--value <answer>'}` : 'Next: hairness onboarding plan',
  ].join('\n')
  if (namespace === 'target' && action === 'discover') return [
    accent('Target discovery'),
    `Root: ${value.root}`,
    `Expected: ${value.targets.length}`,
    `Candidates: ${value.candidates.length}`,
    ...value.candidates.map((item) => `  ${item.root} — ${item.matches.length ? `matches ${item.matches.join(', ')}` : 'no declared match'} — ${item.clean ? 'clean' : 'dirty'}`),
    ...(value.limits.length ? ['', 'Limits:', ...value.limits.map((item) => `  - ${item}`)] : []),
    '',
    'Next: choose explicitly with hairness target bind <id> <repository>',
  ].join('\n')
  if (namespace === 'target' && action === 'list' && Array.isArray(value)) return collection(accent('Targets'), value, (item) => `${item.id} — ${item.binding ?? 'unbound'} — ${item.evidence?.clean === false ? 'dirty' : item.binding ? 'ready' : item.requirement}`)
  if (namespace === 'extension' && action === 'list' && Array.isArray(value)) return collection(accent('Extensions'), value, (item) => `${item.id} — ${item.source ?? 'unlocked'}`)
  if (namespace === 'scratch' && action === 'list' && Array.isArray(value)) return collection(accent('Scratches'), value, (item) => `${item.metadata.id} — ${item.spec.status} — ${item.spec.title}`)
  if (namespace === 'artifact' && action === 'list' && Array.isArray(value)) return collection(accent('Artifacts'), value, (item) => `${item.metadata.owner}/${item.metadata.type}/${item.metadata.id}`)
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === 'string' ? `- ${item}` : `- ${inline(item)}`).join('\n') : 'No entries.'
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${inline(item)}`).join('\n')
  return String(value ?? '')
}

function collection(title, values, render) {
  return values.length ? [title, ...values.map((item) => `  ${render(item)}`)].join('\n') : `${title}\n  none`
}

function renderHumanError(error) {
  const receipt = error.details?.receipt
  const state = receipt ? `Effect outcome: ${receipt.spec.outcome}; Receipt: ${receipt.metadata.id}` : 'No effect Receipt was produced.'
  const routes = error.routes?.length ? error.routes : ['hairness doctor']
  return [`${error.code}: ${error.message}`, `State: ${state}`, `Recovery: ${routes.join(' | ')}`].join('\n')
}

function inline(value) {
  if (value === null || value === undefined) return 'none'
  if (Array.isArray(value)) return value.map((item) => inline(item)).join(', ') || 'none'
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}=${inline(item)}`).join(' ')
  return String(value)
}

function write(stream, value) {
  stream.write(`${value}\n`)
  return 0
}
