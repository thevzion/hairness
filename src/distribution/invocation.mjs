import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { acceptInvocationResult, appendInvocationEvent, ensureInvocationEpoch, listInvocations, readInvocation, readInvocationReceipt, readInvocationResult, writeInvocation, writeInvocationReceipt } from '../core/invocations.mjs'
import { readArtifact, promoteArtifact, stageArtifact } from '../core/artifacts.mjs'
import { readJson } from '../core/io.mjs'
import { validateContract, validateJsonSchema } from '../core/contracts.mjs'
import { resolveOperation } from '../core/capabilities.mjs'
import { collectContributions, commandSurface, operationIndex, validateArtifactPayload } from './registry.mjs'
import { resolvePreferences } from './preferences.mjs'
import { uniqueCandidates } from './gaps.mjs'

const routeOrder = ['deterministic', 'inline', 'worker', 'external']
const controlScopeOrder = { session: 1, segment: 2, frame: 3 }

function selectedResult(operation, requested) {
  const id = requested ?? operation.defaultResult
  const value = operation.results.find((result) => result.id === id)
  if (!value) throw new HairnessError('invocation_result_unsupported', `${operation.capability}#${operation.id} does not declare result ${id}.`, { exitCode: 2 })
  const promotion = value.contract.disposition === 'artifact' ? 'artifact' : value.contract.disposition === 'effect' ? 'effect' : 'none'
  return { id, contract: value.contract, promotion }
}

function invocationOrigin(draft, mode) {
  const providerSessionId = process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_SESSION_ID
  const host = process.env.CODEX_THREAD_ID ? 'codex' : process.env.CLAUDE_SESSION_ID ? 'claude' : mode === 'direct' ? 'cli' : 'unknown'
  return { kind: mode === 'direct' ? 'direct' : 'command', ...draft.origin, host: draft.origin?.host ?? host, ...(draft.origin?.providerSessionId || !providerSessionId ? {} : { providerSessionId }) }
}

async function workReference(root, host) {
  const contributions = await collectContributions(root, 'session-opening', { host }).catch(() => [])
  const data = contributions.find((item) => item.section === 'work')?.data ?? {}
  return { missionId: data.missionId ?? null, segmentId: data.segmentId ?? null, frameId: data.frameId ?? null }
}

function selectedRoute(operation, requested) {
  if (requested && !operation.routes.includes(requested)) throw new HairnessError('invocation_route_unsupported', `${operation.capability}#${operation.id} does not support ${requested}.`, { exitCode: 2 })
  return requested ?? routeOrder.find((route) => operation.routes.includes(route))
}

async function requiredInputs(operation) {
  if (!operation.inputSchema) return { required: [], schema: null }
  const path = resolve(operation.extensionPath, operation.inputSchema)
  const schema = await readJson(path)
  return { required: schema.required ?? [], schema: path }
}

async function resolveDraft(root, draft, mode, existingId) {
  await validateContract('InvocationDraft', draft)
  if (draft.origin?.commandId) {
    const surface = await commandSurface(root, draft.origin.commandId)
    if (surface.operation && (surface.operation.capability !== draft.operation.capability || surface.operation.id !== draft.operation.id)) throw new HairnessError('command_operation_mismatch', `${surface.id} cannot invoke ${draft.operation.capability}:${draft.operation.id}.`, { exitCode: 2 })
    if (draft.result && surface.resultId && draft.result !== surface.resultId) throw new HairnessError('command_result_fixed', `${surface.id} fixes result ${surface.resultId}.`, { exitCode: 2 })
    for (const [key, value] of Object.entries(surface.fixed?.controls ?? {})) if (Object.hasOwn(draft.controls, key) && draft.controls[key] !== value) throw new HairnessError('command_control_fixed', `${surface.id} fixes control ${key}.`, { exitCode: 2 })
    draft = { ...draft, result: surface.resultId ?? draft.result, controls: { ...(surface.defaults ?? {}), ...draft.controls, ...(surface.fixed?.controls ?? {}) } }
  }
  const operation = resolveOperation(await operationIndex(root), draft.operation)
  const preferences = await resolvePreferences(root)
  const inputs = { ...draft.inputs }
  const controlContributions = (await collectContributions(root, 'invocation-controls', { operation: draft.operation })).sort((left, right) => controlScopeOrder[left.scope] - controlScopeOrder[right.scope] || left.priority - right.priority)
  const controls = Object.assign({}, preferences.controls ?? {}, ...controlContributions.map((item) => item.values), draft.controls)
  const { required, schema } = await requiredInputs(operation)
  const contributions = await collectContributions(root, 'input-resolver', { operation: draft.operation, inputs, controls })
  const gaps = []
  for (const field of required.filter((field) => inputs[field] === undefined)) {
    const candidates = uniqueCandidates(contributions.filter((item) => item.field === field).sort((left, right) => right.priority - left.priority).flatMap((item) => item.candidates))
    if (candidates.length === 1) inputs[field] = candidates[0]
    else {
      gaps.push(await validateContract('InvocationGap', { id: `gap-${field}`, field, summary: candidates.length ? `Choose ${field}.` : `Provide ${field}.`, required: true, options: candidates.map((value) => ({ value, label: String(value) })) }))
      break
    }
  }
  if (!gaps.length && schema) await validateJsonSchema(schema, inputs, 'invocation inputs')
  const route = selectedRoute(operation, draft.route)
  const expectedResult = selectedResult(operation, draft.result)
  const id = existingId ?? `inv-${randomUUID()}`
  const progressPolicy = draft.progressPolicy ?? 'preview'
  const origin = invocationOrigin(draft, mode)
  const work = await workReference(root, origin.host)
  const request = await validateContract('InvocationRequest', { schemaVersion: 2, protocolVersion: '0.2', id, mode, origin, work, operation: draft.operation, summary: draft.summary, inputs, controls, expectedResult, route, progressPolicy, createdAt: new Date().toISOString() })
  const state = gaps.length ? 'needs-input' : progressPolicy === 'preview' ? 'resolved' : operation.class === 'effect' ? 'needs-authority' : route === 'external' ? 'unsupported' : route === 'inline' || route === 'worker' ? 'needs-agent' : 'resolved'
  const next = gaps.length
    ? { action: 'answer', route: `hairness invoke answer ${id}` }
    : progressPolicy === 'preview'
      ? { action: 'confirm', route: `hairness invoke resume ${id} --auto` }
      : state === 'needs-authority'
        ? { action: 'checkpoint' }
        : state === 'needs-agent'
          ? { action: 'dispatch-agent', route }
          : state === 'unsupported'
            ? { action: 'choose-supported-route' }
            : { action: 'execute-deterministic', route }
  const limits = [...contributions, ...controlContributions].flatMap((item) => item.limits)
  if (origin.host === 'unknown' && origin.kind !== 'direct') limits.push('provider-session-unbound')
  const preview = await validateContract('InvocationPreview', { schemaVersion: 2, protocolVersion: '0.2', id, state, operation: draft.operation, summary: draft.summary, resolved: { inputs, controls, resolverOwners: [...new Set([...contributions, ...controlContributions].map((item) => item.owner))] }, gaps, route: { kind: route }, expectedResult, effects: operation.effects, limits, next })
  if (Buffer.byteLength(JSON.stringify(preview)) > 4096) throw new HairnessError('invocation_preview_too_large', 'InvocationPreview exceeds 4 KiB.', { exitCode: 2 })
  return { id, mode, draft: { ...draft, inputs }, request, preview, state, updatedAt: new Date().toISOString() }
}

async function persist(root, value, initial = false) {
  await writeInvocation(root, value)
  if (initial) await appendInvocationEvent(root, value.id, 'requested', { mode: value.mode, draft: value.draft })
  await appendInvocationEvent(root, value.id, 'resolved', { request: value.request })
  await appendInvocationEvent(root, value.id, 'previewed', { preview: value.preview })
  if (value.request.progressPolicy === 'auto' && value.state !== 'needs-input') await appendInvocationEvent(root, value.id, value.state === 'needs-authority' || value.state === 'unsupported' ? 'blocked' : 'started', { state: value.state })
  return value.preview
}

export async function startInvocation(root, draft, options = {}) {
  await ensureInvocationEpoch(root)
  const resolved = await resolveDraft(root, { ...draft, progressPolicy: options.auto ? 'auto' : draft.progressPolicy }, options.mode ?? 'intent')
  const preview = await persist(root, resolved, true)
  if (resolved.request.progressPolicy === 'auto' && resolved.request.route === 'deterministic' && resolved.request.origin.commandId) {
    const [{ commandSurface }, { extendedCommand }] = await Promise.all([import('./registry.mjs'), import('./commands.mjs')])
    const surface = await commandSurface(root, resolved.request.origin.commandId)
    const tokens = surface.machineRoute.trim().split(/\s+/)
    if (tokens.shift() !== 'hairness') throw new HairnessError('command_route_invalid', `${surface.id} has an invalid machine route.`, { exitCode: 2 })
    const [namespace, target, action, ...rest] = tokens
    const payload = await extendedCommand(root, namespace, target, action, rest, { ...resolved.request.inputs, ...resolved.request.controls })
    await completeInvocation(root, resolved.id, { summary: payload.summary ?? resolved.request.summary, payload, proof: payload.proof ?? [], limits: payload.limits ?? [], routes: payload.routes ?? [] })
    return showInvocation(root, resolved.id)
  }
  return preview
}

export async function showInvocation(root, id) {
  return { invocation: await readInvocation(root, id), result: await readInvocationResult(root, id), receipt: await readInvocationReceipt(root, id) }
}

export async function listInvocationRecords(root, state = 'all') {
  return { invocations: await listInvocations(root, { state }), limits: [], routes: [] }
}

export async function completeInvocation(root, id, input) {
  const current = await readInvocation(root, id)
  if (await readInvocationReceipt(root, id)) throw new HairnessError('invocation_terminal', `Invocation ${id} is terminal.`, { exitCode: 2 })
  const result = { schemaVersion: 2, protocolVersion: '0.2', invocationId: id, resultId: current.request.expectedResult.id, proof: [], limits: [], routes: [], ...input }
  if (result.invocationId !== id || result.resultId !== current.request.expectedResult.id) throw new HairnessError('invocation_result_mismatch', `Invocation ${id} expects result ${current.request.expectedResult.id}.`, { exitCode: 2 })
  try {
    await validateContract('InvocationResult', result)
    await validateContract(current.request.expectedResult.contract.schema, result.payload)
    if (current.request.expectedResult.contract.disposition === 'artifact') {
      await validateArtifactPayload(root, result.payload)
      const existing = await readArtifact(root, result.payload.id, result.payload.revision).catch((error) => error.code === 'artifact_not_found' || error.code === 'artifact_revision_not_found' ? null : Promise.reject(error))
      if (!existing) { await stageArtifact(root, result.payload.runId, result.payload); await promoteArtifact(root, result.payload.runId) }
    }
  } catch (error) {
    const digest = `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
    await appendInvocationEvent(root, id, 'result-rejected', { digest, code: error.code ?? 'invalid-result' })
    throw error
  }
  return acceptInvocationResult(root, result, current.request.expectedResult.contract)
}

export async function blockInvocation(root, id, reason) {
  const current = await readInvocation(root, id)
  if (await readInvocationReceipt(root, id)) throw new HairnessError('invocation_terminal', `Invocation ${id} is terminal.`, { exitCode: 2 })
  const completedAt = new Date().toISOString()
  const receipt = await writeInvocationReceipt(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: id, status: 'blocked', operation: current.request.operation, summary: reason, outcome: null, proof: [], limits: [reason], routes: [], completedAt })
  await writeInvocation(root, { ...current, state: 'blocked', updatedAt: completedAt })
  await appendInvocationEvent(root, id, 'blocked', { state: 'blocked', reason })
  return receipt
}

export async function answerInvocation(root, id, answers) {
  const current = await readInvocation(root, id)
  if (current.state !== 'needs-input') throw new HairnessError('invocation_not_waiting', `Invocation ${id} is ${current.state}.`, { exitCode: 2 })
  return persist(root, await resolveDraft(root, { ...current.draft, inputs: { ...current.draft.inputs, ...answers } }, current.mode, id))
}

export async function resumeInvocation(root, id, options = {}) {
  const current = await readInvocation(root, id)
  if (await readInvocationReceipt(root, id)) throw new HairnessError('invocation_terminal', `Invocation ${id} is terminal.`, { exitCode: 2 })
  return persist(root, await resolveDraft(root, { ...current.draft, progressPolicy: options.auto ? 'auto' : current.draft.progressPolicy }, current.mode, id))
}

export async function cancelInvocation(root, id) {
  const current = await readInvocation(root, id)
  if (await readInvocationReceipt(root, id)) throw new HairnessError('invocation_terminal', `Invocation ${id} is terminal.`, { exitCode: 2 })
  const receipt = await writeInvocationReceipt(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: id, status: 'cancelled', operation: current.request.operation, summary: 'Invocation cancelled.', outcome: null, proof: [], limits: ['cancelled by user'], routes: [], completedAt: new Date().toISOString() })
  await writeInvocation(root, { ...current, state: 'blocked', updatedAt: receipt.completedAt })
  await appendInvocationEvent(root, id, 'cancelled', {})
  return receipt
}
