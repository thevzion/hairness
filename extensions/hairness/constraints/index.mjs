const allowed = new Set(['readonly', 'no-git', 'no-external'])
const scopes = new Set(['session', 'segment', 'frame'])
const empty = { session: [], segments: {}, frames: {} }

async function work(runtime) { return runtime.extensions.call('hairness/workframes', 'state') }
async function read(runtime) { return runtime.overlay.read('constraints.json', empty) }
function bucket(document, scope, id) {
  if (scope === 'session') return document.session
  const values = scope === 'segment' ? document.segments : document.frames
  values[id] ??= []
  return values[id]
}
async function context(runtime, scope, flags) {
  const value = await work(runtime)
  const segmentId = flags.segment ?? value.activeSegmentId
  const frameId = flags.frame ?? value.frames.findLast?.((item) => item.segmentId === segmentId && item.status === 'open')?.id ?? value.frames.filter((item) => item.segmentId === segmentId && item.status === 'open').at(-1)?.id
  if (scope === 'segment' && !segmentId) throw new Error('No active segment.')
  if (scope === 'frame' && !frameId) throw new Error('No open frame.')
  return { value, id: scope === 'segment' ? segmentId : frameId }
}
async function effective(runtime, input = {}) {
  const document = await read(runtime)
  const value = await work(runtime)
  const segmentId = input.segmentId ?? value.activeSegmentId
  const frameId = input.frameId ?? value.frames.filter((item) => item.segmentId === segmentId && item.status === 'open').at(-1)?.id
  return [...new Set([...document.session, ...(document.segments[segmentId] ?? []), ...(document.frames[frameId] ?? [])])]
}

export const services = { effective: async ({ input, runtime }) => effective(runtime, input) }

export async function authorityPolicy({ input, runtime, manifest }) {
  const requestedEffects = input.requestedEffects ?? []
  const constraints = await effective(runtime, input)
  const deniedEffects = requestedEffects.filter((effect) =>
    constraints.includes('readonly')
    || (constraints.includes('no-git') && effect.startsWith('git:'))
    || (constraints.includes('no-external') && !effect.startsWith('filesystem:')))
  const allowedEffects = requestedEffects.filter((effect) => !deniedEffects.includes(effect))
  const observedAt = new Date().toISOString()
  const digest = `sha256:${createHash('sha256').update(JSON.stringify({ constraints, requestedEffects, allowedEffects })).digest('hex')}`
  return [{ owner: manifest.id, requestedEffects, allowedEffects, deniedEffects, reasons: constraints.map((constraint) => `active:${constraint}`), digest, observedAt }]
}

export async function handleCommand({ target, action, flags, runtime }) {
  const mode = target ?? 'show'
  if (mode === 'show') return { scope: flags.scope ?? 'session', constraints: await effective(runtime), inherited: true, limits: [], routes: [] }
  const scope = flags.scope ?? 'segment'
  if (!scopes.has(scope)) throw new Error(`Unknown constraint scope: ${scope}`)
  const constraint = action ?? flags.constraint
  if (!allowed.has(constraint)) throw new Error(`Unknown constraint: ${constraint}`)
  const document = await read(runtime)
  const { id } = await context(runtime, scope, flags)
  const values = bucket(document, scope, id)
  if (mode === 'set') values.push(...(values.includes(constraint) ? [] : [constraint]))
  else if (mode === 'clear') values.splice(values.indexOf(constraint), values.includes(constraint) ? 1 : 0)
  else throw new Error(`Unknown constraint action: ${mode}`)
  await runtime.overlay.write('constraints.json', document)
  if (scope !== 'session') await runtime.extensions.call('hairness/workframes', 'set-boundary', { scope, id, constraints: values })
  return { scope, id: id ?? null, constraints: values, effective: await effective(runtime), limits: [], routes: [] }
}
import { createHash } from 'node:crypto'
