import { access, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import {
  HairnessError,
  annotateArtifact,
  artifactHistory,
  artifactGraph,
  asHairnessError,
  assertEffectAllowed,
  buildWorkerCapsule,
  ensureOverlay,
  findWorkspaceRoot,
  listLocks,
  listArtifacts,
  readArtifact,
  readJson,
  readPlan,
  readRun,
  readRunResult,
  promoteArtifact,
  quarantineLocks,
  reduceStoredPlan,
  releaseLocks,
  resolveLock,
  stageArtifact,
  submitRunResult,
  transitionRun,
  workspacePaths,
  validateContract,
  writeJsonAtomic,
} from './core/index.mjs'

const PROTOCOL_VERSION = '0.2'

function parseArguments(argv) {
  const flags = {}
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      index += 1
    }
  }
  return { flags, positionals }
}

async function inputJson(flags) {
  if (flags.file) return JSON.parse(await readFile(flags.file, 'utf8'))
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  if (!chunks.length) throw new HairnessError('input_required', 'Provide JSON through --file or stdin.', { exitCode: 2 })
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function envelope(ok, value) {
  return ok
    ? { schemaVersion: 2, protocolVersion: PROTOCOL_VERSION, ok: true, data: value, limits: [], routes: [] }
    : {
        schemaVersion: 2,
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: { code: value.code, summary: value.message, details: value.details },
        limits: value.limits,
        routes: value.routes,
      }
}

function renderHuman(value) {
  if (typeof value === 'string') return value
  if (value?.summary) {
    const lines = [value.summary]
    if (value.status) lines.push(`status: ${value.status}`)
    if (value.routes?.length) lines.push(`routes: ${value.routes.join(', ')}`)
    if (value.limits?.length) lines.push(`limits: ${value.limits.join('; ')}`)
    return lines.join('\n')
  }
  return JSON.stringify(value, null, 2)
}

async function coreCommand(root, positionals, flags) {
  const [namespace, target, action, ...rest] = positionals
  if (!namespace) throw new HairnessError('usage', 'Usage: hairness <namespace> <target> [action]', { exitCode: 2 })

  if (namespace === 'intent') {
    const { extensionCommand } = await import('./distribution/registry.mjs')
    return extensionCommand(root, 'intent', target, action, rest, flags)
  }

  if (namespace === 'plan') {
    if (!target) throw new HairnessError('usage', 'Usage: hairness plan <id> show|next|reduce', { exitCode: 2 })
    const mode = action ?? 'show'
    if (mode === 'show') return readPlan(root, target)
    if (mode === 'reduce') return reduceStoredPlan(root, target)
    if (mode === 'next') {
      const plan = await readPlan(root, target)
      for (const route of plan.routes) {
        const result = await readRunResult(root, route.id)
        if (!result) return route
      }
      return { summary: 'All routes have results.', status: 'ready-to-reduce', routes: [`hairness plan ${target} reduce`], limits: [] }
    }
  }

  if (namespace === 'run') {
    if (!target) throw new HairnessError('usage', 'Usage: hairness run <id> show|resume|cancel|clean', { exitCode: 2 })
    const mode = action ?? 'show'
    if (mode === 'show') return { run: await readRun(root, target), result: await readRunResult(root, target) }
    if (mode === 'resume') return transitionRun(root, target, 'ready', { reason: 'resume requested' })
    if (mode === 'cancel') return transitionRun(root, target, 'cancelled', { reason: flags.reason ?? 'cancel requested' })
    if (mode === 'clean') {
      const run = await readRun(root, target)
      if (!['succeeded', 'failed', 'invalid', 'cancelled'].includes(run.state)) throw new HairnessError('run_active', `Run ${target} is ${run.state}.`)
      await rm(join(workspacePaths(root).runs, target), { recursive: true })
      return { summary: `Cleaned run ${target}.`, status: 'cleaned', routes: [], limits: [] }
    }
  }

  if (namespace === 'worker') {
    if (!target) throw new HairnessError('usage', 'Usage: hairness worker <run-id> inspect|source|effect|submit|fail', { exitCode: 2 })
    const mode = action ?? 'inspect'
    if (mode === 'inspect') {
      const run = await readRun(root, target)
      if (flags.start && run.state === 'ready') await transitionRun(root, target, 'running', { reason: 'worker started' })
      return buildWorkerCapsule(root, target)
    }
    if (mode === 'source') {
      const capsule = await buildWorkerCapsule(root, target)
      return { summary: 'Allowed source routes.', sources: capsule.allowedSources, limits: [], routes: capsule.allowedSources }
    }
    if (mode === 'effect') {
      if (!flags.effect || !flags.target) throw new HairnessError('usage', 'worker effect requires --effect and --target.', { exitCode: 2 })
      const { aggregateAuthorityPolicy } = await import('./distribution/registry.mjs')
      const grant = await assertEffectAllowed(root, target, flags.effect, flags.target, (effects) => aggregateAuthorityPolicy(root, effects, { runId: target, target: flags.target }))
      return { summary: 'Effect is authorized for this run.', status: 'authorized', grantId: grant.id, effect: flags.effect, target: flags.target, limits: [], routes: [] }
    }
    if (mode === 'submit') {
      const result = await inputJson(flags)
      await validateContract('RunResult', result)
      if (result.runId !== target) throw new HairnessError('run_result_mismatch', 'Submitted result does not match the worker run.', { exitCode: 2 })
      const run = await readRun(root, target)
      if (run.state !== 'running') throw new HairnessError('run_not_running', `Run ${run.id} is ${run.state}, not running.`, { exitCode: 2 })
      if (run.assignment.profile === 'producer' && run.assignment.result.disposition === 'artifact' && result.status === 'succeeded') {
        const artifact = result.outcome?.artifact
        if (!artifact) throw new HairnessError('artifact_required', 'Producer result must contain outcome.artifact.', { exitCode: 2 })
        if (artifact.owner !== run.assignment.result.artifactOwner || artifact.type !== run.assignment.result.artifactType) throw new HairnessError('artifact_result_mismatch', `Worker result must produce ${run.assignment.result.artifactOwner}:${run.assignment.result.artifactType}.`, { exitCode: 2 })
        const { validateArtifactPayload } = await import('./distribution/registry.mjs')
        await validateArtifactPayload(root, artifact)
        await stageArtifact(root, target, artifact)
        await promoteArtifact(root, target)
      }
      if (run.assignment.result.disposition === 'scratch') {
        const path = join(workspacePaths(root).scratch, run.assignment.id, run.id, 'result.json')
        await writeJsonAtomic(path, result)
      }
      if (run.assignment.result.disposition === 'effect' && run.assignment.profile !== 'executor') throw new HairnessError('effect_result_requires_executor', 'Only an executor may submit an effect result.', { exitCode: 2 })
      if (run.assignment.profile === 'executor' && result.status === 'succeeded') {
        const receipt = result.outcome?.receipt ?? result.outcome
        await validateContract('ChangeReceipt', receipt)
        if (receipt.status === 'succeeded') await releaseLocks(run.assignment.targets, run.id)
        else await quarantineLocks(run.assignment.targets, run.id, `executor receipt: ${receipt.status}`)
      }
      return submitRunResult(root, result)
    }
    if (mode === 'fail') {
      const result = {
        schemaVersion: 2,
        protocolVersion: PROTOCOL_VERSION,
        runId: target,
        status: 'failed',
        summary: flags.summary ?? 'Worker failed.',
        outcome: null,
        proof: [],
        limits: flags.limit ? [flags.limit] : [],
        routes: [],
      }
      const run = await readRun(root, target)
      if (run.assignment.profile === 'executor') await quarantineLocks(run.assignment.targets, run.id, 'executor failed without a successful receipt')
      return submitRunResult(root, result)
    }
  }

  if (namespace === 'artifact') {
    if (!target) throw new HairnessError('usage', 'Usage: hairness artifact list|<id> show|history|annotate|related|graph', { exitCode: 2 })
    if (target === 'list') return { artifacts: await listArtifacts(root, { owner: flags.owner, type: flags.type, label: flags.label, signal: flags.signal }) }
    const mode = action ?? 'show'
    if (mode === 'show') return readArtifact(root, target, flags.revision)
    if (mode === 'history') return artifactHistory(root, target)
    if (mode === 'related' || mode === 'graph') return artifactGraph(root, target)
    if (mode === 'annotate') {
      if (!flags.text) throw new HairnessError('usage', 'artifact annotate requires --text.', { exitCode: 2 })
      return annotateArtifact(root, target, { text: flags.text, author: flags.author ?? 'local' })
    }
  }

  if (namespace === 'scratch') {
    const paths = await ensureOverlay(root)
    const mode = target ?? 'list'
    if (mode === 'list') return { entries: await readdir(paths.scratch) }
    if (mode === 'clean') {
      const name = action
      if (!name) throw new HairnessError('usage', 'Usage: hairness scratch clean <name>', { exitCode: 2 })
      if (name.includes('/') || name === '..') throw new HairnessError('invalid_scratch_entry', `Invalid scratch entry: ${name}`, { exitCode: 2 })
      await rm(join(paths.scratch, name), { recursive: true, force: true })
      return { summary: `Cleaned scratch/${name}.`, status: 'cleaned', limits: [], routes: [] }
    }
  }

  if (namespace === 'lock') {
    const mode = target ?? 'list'
    if (mode === 'list') return { locks: await listLocks() }
    if (mode === 'resolve') {
      if (!action) throw new HairnessError('usage', 'Usage: hairness lock resolve <target>', { exitCode: 2 })
      return resolveLock(action)
    }
  }

  if (namespace === 'metrics') {
    const paths = await ensureOverlay(root)
    const names = (await readdir(paths.runs, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== '.plans')
    const runs = await Promise.all(names.map((entry) => readRun(root, entry.name)))
    const byState = Object.groupBy(runs, (run) => run.state)
    return { runs: runs.length, byState: Object.fromEntries(Object.entries(byState).map(([key, value]) => [key, value.length])) }
  }

  const { extendedCommand } = await import('./distribution/commands.mjs')
  return extendedCommand(root, namespace, target, action, rest, flags)
}

export async function runCli(argv = process.argv.slice(2), streams = { stdout: process.stdout, stderr: process.stderr }) {
  const { flags, positionals } = parseArguments(argv)
  if (flags.version || positionals[0] === '--version') {
    streams.stdout.write(`hairness ${packageJson.version}\nprotocol ${PROTOCOL_VERSION}\n`)
    return 0
  }
  try {
    if (positionals[0] === 'create') {
      const bootstrap = new URL('./bootstrap/create.mjs', import.meta.url)
      await access(bootstrap).catch(() => { throw new HairnessError('bootstrap_unavailable', 'This team distribution does not contain the forge bootstrap. Run create through @hairness/hairness or a company forge.', { exitCode: 4 }) })
      const { createCommand, interactiveCreate } = await import('./bootstrap/create.mjs')
      const args = positionals.slice(1)
      const modes = new Set(['start', 'status', 'next', 'answer', 'plan', 'apply'])
      const interactive = !flags.json && process.stdin.isTTY && args[0] && !modes.has(args[0])
      const result = interactive
        ? await interactiveCreate(args[0], flags.preset ?? 'standard', flags.role ?? 'distribution')
        : await createCommand(args, flags)
      streams.stdout.write(flags.json ? `${JSON.stringify(envelope(true, result))}\n` : `${renderHuman(result)}\n`)
      return 0
    }
    const root = await findWorkspaceRoot()
    const result = await coreCommand(root, positionals, flags)
    streams.stdout.write(flags.json ? `${JSON.stringify(envelope(true, result))}\n` : `${renderHuman(result)}\n`)
    return 0
  } catch (rawError) {
    const error = asHairnessError(rawError)
    streams.stderr.write(flags.json ? `${JSON.stringify(envelope(false, error))}\n` : `${error.code}: ${error.message}\n`)
    return error.exitCode
  }
}
