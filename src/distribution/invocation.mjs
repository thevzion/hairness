import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { HairnessError } from '../core/errors.mjs'
import { appendInvocationEvent, readInvocation, readInvocationReceipt, writeInvocation, writeInvocationReceipt } from '../core/invocations.mjs'
import { readJson } from '../core/io.mjs'
import { validateContract, validateJsonSchema } from '../core/contracts.mjs'
import { resolveOperation } from '../core/capabilities.mjs'
import { collectContributions, operationIndex } from './registry.mjs'
import { resolvePreferences } from './preferences.mjs'
import { uniqueCandidates } from './gaps.mjs'

const routeOrder = ['deterministic', 'inline', 'worker', 'external']
const controlScopeOrder = { session: 1, segment: 2, frame: 3 }

function selectedResult(operation, requested) {
  const id = requested ?? operation.defaultResult
  const value = operation.results.find((result) => result.id === id)
  if (!value) throw new HairnessError('invocation_result_unsupported', `${operation.capability}#${operation.id} does not declare result ${id}.`, { exitCode: 2 })
  return { id, contract: value.contract, persistence: value.contract.disposition === 'artifact' ? 'local' : 'none' }
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
  const request = await validateContract('InvocationRequest', { schemaVersion: 2, protocolVersion: '0.2', id, mode, operation: draft.operation, summary: draft.summary, inputs, controls, expectedResult, route, progressPolicy, createdAt: new Date().toISOString() })
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
  return persist(root, await resolveDraft(root, { ...draft, progressPolicy: options.auto ? 'auto' : draft.progressPolicy }, options.mode ?? 'intent'), true)
}

export async function showInvocation(root, id) {
  return { invocation: await readInvocation(root, id), receipt: await readInvocationReceipt(root, id) }
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
  const receipt = await writeInvocationReceipt(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: id, status: 'cancelled', operation: current.request.operation, summary: 'Invocation cancelled.', outcome: null, proof: [], limits: ['cancelled by user'], routes: [], completedAt: new Date().toISOString() })
  await writeInvocation(root, { ...current, state: 'blocked', updatedAt: receipt.completedAt })
  await appendInvocationEvent(root, id, 'cancelled', {})
  return receipt
}
