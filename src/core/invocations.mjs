import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { appendJsonLine, assertSafeId, createJsonExclusive, readJson, workspacePaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'

function paths(root, id) {
  assertSafeId(id, 'invocation id')
  const directory = join(workspacePaths(root).invocations, id)
  return { directory, events: join(directory, 'events.jsonl'), state: join(directory, 'state.json'), result: join(directory, 'result.json'), receipt: join(directory, 'receipt.json') }
}

export async function ensureInvocationEpoch(root) {
  const path = join(workspacePaths(root).invocations, 'epoch.json')
  const existing = await readJson(path, null)
  if (existing) return existing
  const value = { schemaVersion: 2, protocolVersion: '0.2', startedAt: new Date().toISOString() }
  try { await createJsonExclusive(path, value) } catch (error) { if (error.code !== 'EEXIST') throw error }
  return readJson(path)
}

export async function readInvocation(root, id) {
  const value = await readJson(paths(root, id).state, null)
  if (value) return value
  const events = await invocationEvents(root, id)
  if (!events.length) throw new HairnessError('invocation_unknown', `Unknown invocation: ${id}`, { exitCode: 2 })
  const rebuilt = rebuildInvocation(events)
  await writeInvocation(root, rebuilt)
  return rebuilt
}

export async function writeInvocation(root, value) {
  await writeJsonAtomic(paths(root, value.id).state, value)
  return value
}

export async function invocationEvents(root, id) {
  try {
    return (await readFile(paths(root, id).events, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export async function appendInvocationEvent(root, id, type, data = {}) {
  const event = await validateContract('InvocationEvent', { schemaVersion: 2, protocolVersion: '0.2', invocationId: id, sequence: (await invocationEvents(root, id)).length + 1, type, at: new Date().toISOString(), data })
  await appendJsonLine(paths(root, id).events, event)
  return event
}

export async function readInvocationResult(root, id) {
  const value = await readJson(paths(root, id).result, null)
  return value ? validateContract('InvocationResult', value) : null
}

function resultDigest(result) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(result))).digest('hex')}`
}

function assertSemanticPayload(value, path = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSemanticPayload(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    if (['transcript', 'reasoning', 'rawproviderresponse', 'rawresponse'].includes(normalized)) throw new HairnessError('semantic_payload_forbidden', `Semantic ledger payload cannot contain ${path}.${key}.`, { exitCode: 2 })
    assertSemanticPayload(item, `${path}.${key}`)
  }
}

export async function acceptInvocationResult(root, result, contract) {
  await validateContract('InvocationResult', result)
  assertSemanticPayload(result.payload)
  const current = await readInvocation(root, result.invocationId)
  const digest = resultDigest(result)
  const existingReceipt = await readInvocationReceipt(root, result.invocationId)
  if (existingReceipt) {
    if (existingReceipt.status === 'completed' && existingReceipt.result?.digest === digest) return existingReceipt
    throw new HairnessError('invocation_terminal', `Invocation ${result.invocationId} is terminal.`, { exitCode: 2 })
  }
  await appendInvocationEvent(root, result.invocationId, 'result-submitted', { resultId: result.resultId, digest })
  const existingResult = await readInvocationResult(root, result.invocationId)
  if (existingResult && resultDigest(existingResult) !== digest) throw new HairnessError('invocation_result_immutable', `Invocation ${result.invocationId} already has a different immutable result.`, { exitCode: 2 })
  if (!existingResult) await createJsonExclusive(paths(root, result.invocationId).result, result)
  const reference = await validateContract('InvocationResultRef', { resultId: result.resultId, schema: contract.schema, disposition: contract.disposition, digest, path: 'result.json' })
  await appendInvocationEvent(root, result.invocationId, 'result-accepted', { result: reference })
  const completedAt = new Date().toISOString()
  const receipt = await writeInvocationReceipt(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: result.invocationId, status: 'completed', operation: current.request.operation, summary: result.summary, result: reference, outcome: null, proof: result.proof, limits: result.limits, routes: result.routes, completedAt })
  await writeInvocation(root, { ...current, state: 'completed', result: reference, updatedAt: completedAt })
  await appendInvocationEvent(root, result.invocationId, 'completed', { result: reference })
  return receipt
}

export async function createSyntheticInvocation(root, runId, assignment) {
  const candidate = `inv-run-${runId}`
  const id = candidate.length <= 128 ? candidate : `inv-run-${createHash('sha256').update(runId).digest('hex').slice(0, 32)}`
  if (await readJson(paths(root, id).state, null)) return id
  await ensureInvocationEpoch(root)
  const at = new Date().toISOString()
  const origin = { kind: 'direct', host: 'cli' }
  const work = {}
  const draft = { schemaVersion: 2, protocolVersion: '0.2', operation: assignment.operation, summary: assignment.goal, inputs: {}, controls: {}, origin, result: 'run', route: 'worker', progressPolicy: 'auto' }
  const expectedResult = { id: 'run', contract: { schema: 'RunResult', disposition: 'response' }, promotion: 'none' }
  const request = { schemaVersion: 2, protocolVersion: '0.2', id, mode: 'direct', origin, work, operation: assignment.operation, summary: assignment.goal, inputs: {}, controls: {}, expectedResult, route: 'worker', progressPolicy: 'auto', createdAt: at }
  const preview = { schemaVersion: 2, protocolVersion: '0.2', id, state: 'needs-agent', operation: assignment.operation, summary: assignment.goal, resolved: { inputs: {}, controls: {}, resolverOwners: [] }, gaps: [], route: { kind: 'worker' }, expectedResult, effects: assignment.requestedEffects, limits: [], next: { action: 'dispatch-agent', route: 'worker' } }
  const value = { id, mode: 'direct', draft, request, preview, state: 'needs-agent', updatedAt: at }
  await writeInvocation(root, value)
  await appendInvocationEvent(root, id, 'requested', { mode: 'direct', draft })
  await appendInvocationEvent(root, id, 'resolved', { request })
  await appendInvocationEvent(root, id, 'previewed', { preview })
  await appendInvocationEvent(root, id, 'started', { state: 'needs-agent' })
  return id
}

export async function createSyntheticPlanInvocation(root, plan) {
  const candidate = `inv-plan-${plan.id}`
  const id = candidate.length <= 128 ? candidate : `inv-plan-${createHash('sha256').update(plan.id).digest('hex').slice(0, 32)}`
  if (await readJson(paths(root, id).state, null)) return id
  await ensureInvocationEpoch(root)
  const at = new Date().toISOString()
  const origin = { kind: 'direct', host: 'cli' }
  const work = plan.work ?? {}
  const operation = plan.routes[0].operation
  const expectedResult = { id: 'fan-in', contract: { schema: 'ContextPacket', disposition: 'response' }, promotion: 'none' }
  const draft = { schemaVersion: 2, protocolVersion: '0.2', operation, summary: plan.intent.summary, inputs: {}, controls: {}, origin, result: 'fan-in', route: 'worker', progressPolicy: 'auto' }
  const request = { schemaVersion: 2, protocolVersion: '0.2', id, mode: 'direct', origin, work, operation, summary: plan.intent.summary, inputs: {}, controls: {}, expectedResult, route: 'worker', progressPolicy: 'auto', createdAt: at }
  const preview = { schemaVersion: 2, protocolVersion: '0.2', id, state: 'needs-agent', operation, summary: plan.intent.summary, resolved: { inputs: {}, controls: {}, resolverOwners: [] }, gaps: [], route: { kind: 'worker' }, expectedResult, effects: [], limits: [], next: { action: 'dispatch-agent', route: 'worker' } }
  const value = { id, mode: 'direct', draft, request, preview, state: 'needs-agent', updatedAt: at }
  await writeInvocation(root, value)
  await appendInvocationEvent(root, id, 'requested', { mode: 'direct', draft })
  await appendInvocationEvent(root, id, 'resolved', { request })
  await appendInvocationEvent(root, id, 'previewed', { preview })
  await appendInvocationEvent(root, id, 'started', { state: 'needs-agent' })
  return id
}

export function rebuildInvocation(events) {
  if (!events.length) throw new HairnessError('invocation_events_empty', 'Cannot rebuild an invocation without events.', { exitCode: 2 })
  const projection = { id: events[0].invocationId }
  for (const [index, event] of events.entries()) {
    if (event.invocationId !== projection.id || event.sequence !== index + 1) {
      throw new HairnessError('invocation_events_invalid', 'Invocation events are not one ordered stream.', { exitCode: 2 })
    }
    if (event.type === 'requested') Object.assign(projection, { mode: event.data.mode, draft: event.data.draft })
    if (event.type === 'resolved') projection.request = event.data.request
    if (event.type === 'previewed') Object.assign(projection, { preview: event.data.preview, state: event.data.preview?.state })
    if (event.type === 'started' || event.type === 'blocked') projection.state = event.data.state ?? (event.type === 'blocked' ? 'blocked' : projection.state)
    if (event.type === 'result-accepted') projection.result = event.data.result
    if (event.type === 'completed') projection.state = 'completed'
    if (event.type === 'cancelled') projection.state = 'blocked'
    projection.updatedAt = event.at
  }
  if (!projection.draft || !projection.request || !projection.preview || !projection.state) {
    throw new HairnessError('invocation_events_incomplete', 'Invocation events do not contain a complete projection.', { exitCode: 2 })
  }
  return projection
}

export async function readInvocationReceipt(root, id) {
  return readJson(paths(root, id).receipt, null)
}

export async function writeInvocationReceipt(root, receipt) {
  await validateContract('InvocationReceipt', receipt)
  await writeJsonAtomic(paths(root, receipt.invocationId).receipt, receipt)
  return receipt
}

export async function listInvocations(root, options = {}) {
  const epoch = await ensureInvocationEpoch(root)
  const entries = await readdir(workspacePaths(root).invocations, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  const values = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const invocation = await readInvocation(root, entry.name)
    const receipt = await readInvocationReceipt(root, entry.name)
    const legacy = !invocation.request?.origin || invocation.request.createdAt < epoch.startedAt
    return { ...invocation, legacy, terminal: Boolean(receipt) }
  }))
  if (options.state === 'open') return values.filter((value) => !value.legacy && !value.terminal)
  if (options.state === 'terminal') return values.filter((value) => value.terminal)
  return values
}
