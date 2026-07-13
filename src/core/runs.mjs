import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { appendJsonLine, assertSafeId, ensureOverlay, now, readJson, workspacePaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'
import { acceptInvocationResult, appendInvocationEvent, createSyntheticInvocation } from './invocations.mjs'

const transitions = {
  planned: ['ready', 'cancelled'],
  ready: ['running', 'needs-input', 'needs-authority', 'cancelled'],
  running: ['needs-input', 'needs-budget', 'needs-authority', 'needs-split', 'succeeded', 'failed', 'invalid', 'cancelled', 'unknown'],
  'needs-input': ['ready', 'running', 'failed', 'cancelled'],
  'needs-budget': ['ready', 'running', 'failed', 'cancelled'],
  'needs-authority': ['ready', 'running', 'failed', 'cancelled'],
  'needs-split': ['ready', 'failed', 'cancelled'],
  unknown: ['ready', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  invalid: [],
  cancelled: [],
}

function runPaths(root, runId) {
  assertSafeId(runId, 'run id')
  const directory = join(workspacePaths(root).runs, runId)
  return {
    directory,
    task: join(directory, 'task.json'),
    events: join(directory, 'events.jsonl'),
    result: join(directory, 'result.json'),
    checkpoint: join(directory, 'checkpoint.json'),
    grant: join(directory, 'grant.json'),
  }
}

export async function createRun(root, { id, planId, assignment, parentInvocationId: requestedParent, routeId: requestedRoute }) {
  await validateContract('Assignment', assignment)
  await ensureOverlay(root)
  const paths = runPaths(root, id)
  const timestamp = now()
  const linkedPlan = planId ? await readJson(join(workspacePaths(root).plans, `${planId}.json`), null) : null
  const inheritedParent = requestedParent ?? linkedPlan?.parentInvocationId
  const parentInvocationId = inheritedParent ?? await createSyntheticInvocation(root, id, assignment)
  const parentMode = inheritedParent ? 'shared' : 'synthetic'
  const run = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id,
    planId,
    parentInvocationId,
    routeId: requestedRoute ?? id,
    parentMode,
    state: 'planned',
    assignment,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await validateContract('RouteRun', run)
  const existing = await readJson(paths.task, null)
  if (existing) throw new HairnessError('run_exists', `Run already exists: ${id}`, { exitCode: 2 })
  await writeJsonAtomic(paths.task, run)
  await appendRunEvent(root, id, 'created', { planId, parentInvocationId, routeId: run.routeId })
  await appendInvocationEvent(root, parentInvocationId, 'route-dispatched', { runId: id, routeId: run.routeId })
  return run
}

export async function runEvents(root, runId) {
  try { return (await readFile(runPaths(root, runId).events, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export async function appendRunEvent(root, runId, type, data = {}) {
  const event = await validateContract('RunEvent', { schemaVersion: 2, protocolVersion: '0.2', runId, sequence: (await runEvents(root, runId)).length + 1, type, at: now(), data })
  await appendJsonLine(runPaths(root, runId).events, event)
  return event
}

export async function readRun(root, runId) {
  const paths = runPaths(root, runId)
  const run = await readJson(paths.task, null)
  if (!run) throw new HairnessError('run_not_found', `Run not found: ${runId}`)
  await validateContract('RouteRun', run)
  return run
}

export async function transitionRun(root, runId, state, detail = {}) {
  const paths = runPaths(root, runId)
  const run = await readRun(root, runId)
  if (!transitions[run.state]?.includes(state)) {
    throw new HairnessError('invalid_transition', `Cannot transition ${runId} from ${run.state} to ${state}.`, {
      exitCode: 2,
    })
  }
  const timestamp = now()
  const next = { ...run, state, updatedAt: timestamp }
  await validateContract('RouteRun', next)
  await writeJsonAtomic(paths.task, next)
  await appendRunEvent(root, runId, 'state', { from: run.state, to: state, detail })
  return next
}

export async function submitRunResult(root, result) {
  await validateContract('RunResult', result)
  const paths = runPaths(root, result.runId)
  const run = await readRun(root, result.runId)
  if (run.state !== 'running') {
    throw new HairnessError('run_not_running', `Run ${run.id} is ${run.state}, not running.`, { exitCode: 2 })
  }
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(result)).digest('hex')}`
  await appendRunEvent(root, result.runId, 'result-submitted', { digest, status: result.status })
  await appendInvocationEvent(root, run.parentInvocationId, 'result-submitted', { runId: run.id, routeId: run.routeId, digest })
  await writeJsonAtomic(paths.result, result)
  await transitionRun(root, result.runId, result.status, { summary: result.summary })
  await appendRunEvent(root, result.runId, 'result-accepted', { digest, status: result.status })
  await appendInvocationEvent(root, run.parentInvocationId, 'result-accepted', { runId: run.id, routeId: run.routeId, digest })
  const terminal = ['succeeded', 'failed', 'invalid', 'cancelled'].includes(result.status)
  if (terminal) await appendRunEvent(root, result.runId, result.status === 'succeeded' ? 'completed' : 'failed', { status: result.status })
  if (terminal && run.parentMode === 'synthetic') await acceptInvocationResult(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: run.parentInvocationId, resultId: 'run', summary: result.summary, payload: result, proof: result.proof, limits: result.limits, routes: result.routes }, { schema: 'RunResult', disposition: 'response' })
  return result
}

export async function readRunResult(root, runId) {
  const result = await readJson(runPaths(root, runId).result, null)
  if (!result) return null
  return validateContract('RunResult', result)
}

export async function buildWorkerCapsule(root, runId) {
  const run = await readRun(root, runId)
  const grant = await readJson(runPaths(root, runId).grant, null)
  const assignment = run.assignment
  const capsule = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    runId,
    taskName: assignment.id,
    operation: assignment.operation,
    profile: assignment.profile,
    goal: assignment.goal,
    outcome: assignment.outcome,
    inputs: assignment.inputs,
    targets: assignment.targets,
    exclusions: assignment.exclusions,
    allowedSources: assignment.allowedSources,
    allowedEffects: assignment.profile === 'executor' ? (grant?.effects ?? []) : [],
    workload: assignment.workload,
    ...(assignment.budget ? { budget: assignment.budget } : {}),
    result: assignment.result,
    routes: {
      inspect: `hairness worker ${runId} inspect --start --json`,
      source: `hairness worker ${runId} source --json`,
      effect: `hairness worker ${runId} effect --json`,
      submit: `hairness worker ${runId} submit --json`,
      fail: `hairness worker ${runId} fail --json`,
    },
  }
  return validateContract('WorkerCapsule', capsule)
}

export { runPaths, transitions }
