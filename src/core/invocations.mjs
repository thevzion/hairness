import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { appendJsonLine, assertSafeId, readJson, workspacePaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'

function paths(root, id) {
  assertSafeId(id, 'invocation id')
  const directory = join(workspacePaths(root).invocations, id)
  return { directory, events: join(directory, 'events.jsonl'), state: join(directory, 'state.json'), receipt: join(directory, 'receipt.json') }
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
    if (event.type === 'started' || event.type === 'blocked') projection.state = event.data.state ?? projection.state
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

export async function listInvocations(root) {
  const entries = await readdir(workspacePaths(root).invocations, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  return Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readInvocation(root, entry.name)))
}
