import { createHash } from 'node:crypto'

const postures = new Set(['discuss', 'recap', 'plan', 'act', 'execute'])
const relations = new Set(['continues', 'depends-on', 'informs', 'supersedes', 'blocks', 'related-to'])

function timestamp() { return new Date().toISOString() }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}` }
function emptyState() { return { schemaVersion: 2, protocolVersion: '0.2', mission: null, activeSegmentId: null, methodologyBinding: null, controls: {}, segments: [], frames: [], updatedAt: timestamp() } }
async function state(runtime) { return runtime.overlay.read('current.json', emptyState()) }
async function save(runtime, value, event) {
  value.updatedAt = timestamp()
  await runtime.contracts.validateSchema('./schemas/work-state.schema.json', value, 'Work Controls state')
  await runtime.overlay.append('events.jsonl', { at: value.updatedAt, ...event })
  return runtime.overlay.write('current.json', value)
}
function activeSegment(value) { return value.segments.find((segment) => segment.id === value.activeSegmentId) ?? null }
function activeFrame(value) { return value.frames.filter((frame) => frame.segmentId === value.activeSegmentId && frame.status === 'open').at(-1) ?? null }
function boundary(scope, constraints = []) { return { scope, constraints: [...new Set(constraints)] } }
function relationFlags(flags) {
  return [...relations].flatMap((type) => flags[type] ? [{ type, target: { kind: 'segment', id: flags[type] } }] : [])
}

function contextPacket(intent, summary, results, limits = [], routes = [], proof = [], effects = [], tests = []) {
  const value = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    planId: `work-${Date.now().toString(36)}`,
    intent,
    status: 'succeeded',
    summary,
    results,
    proof,
    effects,
    tests,
    limits,
    routes,
    byteSize: 0,
  }
  value.byteSize = Buffer.byteLength(JSON.stringify(value))
  return value
}

function workLinks(value) {
  const segment = activeSegment(value)
  const frame = activeFrame(value)
  return [
    'hairness work status --json',
    segment ? `hairness work resume ${segment.id} --json` : 'hairness work segment open --summary <summary> --json',
    frame ? `hairness work trace ${frame.segmentId} --json` : null,
  ].filter(Boolean)
}

function dashboardResult(value, view = 'work') {
  const segment = activeSegment(value)
  const frame = activeFrame(value)
  const controls = effectiveControls(value)
  const result = {
    view,
    mission: value.mission ? { id: value.mission.id, summary: value.mission.summary, status: value.mission.status } : null,
    activeWork: segment ? { id: segment.id, summary: segment.summary, status: segment.status, boundary: segment.boundary } : null,
    activeFrame: frame ? { id: frame.id, summary: frame.summary, posture: frame.posture, boundary: frame.boundary } : null,
    controls,
    artifacts: segment?.artifacts ?? [],
  }
  if (view === 'method') {
    result.method = value.methodologyBinding ?? null
    result.methodShape = ['mission', 'work segment', 'frame', 'recap', 'work-plan', 'checkpoint']
  }
  if (view === 'next') {
    result.next = segment
      ? ['hairness-x-discuss', 'hairness-x-check-sources', 'hairness-x-make-recap', 'hairness-x-make-plan']
      : ['hairness work mission set', 'hairness work segment open']
  }
  if (view === 'question') {
    result.question = segment
      ? 'Quel intent doit-on résoudre maintenant dans ce work segment ?'
      : 'Quel work segment faut-il ouvrir ?'
  }
  return result
}

function dashboardPacket(value, view = 'work') {
  const result = dashboardResult(value, view)
  const summary = view === 'method'
    ? 'Active method and work-segment shape.'
    : view === 'next'
      ? 'Next routes for the active work.'
      : view === 'question'
        ? 'One next question for the active work.'
        : 'Active work dashboard.'
  return contextPacket(
    `show ${view}`,
    summary,
    [result],
    ['Generated as a provider-facing dashboard; live sources still prove current truth.'],
    workLinks(value),
  )
}

function frameSummaries(value, segmentId) {
  return value.frames.filter((frame) => frame.segmentId === segmentId).map((frame) => `${frame.id}: ${frame.summary} (${frame.posture}/${frame.status})`)
}

function targetShape(kind, flags = {}) {
  const summary = flags.shape ?? flags.focus ?? (kind === 'system-shape' ? 'Target system shape to validate.' : 'Target system wiring to validate.')
  return {
    summary,
    scope: flags.scope ? String(flags.scope).split(',').filter(Boolean) : [],
    oldOwner: flags.oldOwner ?? flags['old-owner'] ?? null,
    targetOwner: flags.targetOwner ?? flags['target-owner'] ?? null,
    legacyKept: flags.legacyKept ? String(flags.legacyKept).split(',').filter(Boolean) : flags['legacy-kept'] ? String(flags['legacy-kept']).split(',').filter(Boolean) : [],
    legacyDeleted: flags.legacyDeleted ? String(flags.legacyDeleted).split(',').filter(Boolean) : flags['legacy-deleted'] ? String(flags['legacy-deleted']).split(',').filter(Boolean) : [],
    compatibility: flags.compatibility ? String(flags.compatibility).split(',').filter(Boolean) : [],
    proof: flags.proof ? String(flags.proof).split(',').filter(Boolean) : [],
    checkpoint: flags.checkpoint ?? null,
  }
}

function workPlanPayload(kind, value, flags = {}) {
  const segment = activeSegment(value)
  if (!segment) throw new Error('Open a segment first.')
  const frames = frameSummaries(value, segment.id)
  const shape = targetShape(kind, flags)
  const goal = flags.goal ?? flags.focus ?? segment.summary
  return {
    segmentId: segment.id,
    executionBoundary: `segment:${segment.id}`,
    originalFrame: activeFrame(value)?.id ?? null,
    framesConsidered: frames,
    coherence: 'Fits the active mission, segment boundary and inherited controls until contradicted by fresher proof.',
    alreadyDone: (segment.artifacts ?? []).map((artifact) => `${artifact.id}@${artifact.revision}`),
    goal,
    scope: flags.scope ? String(flags.scope).split(',').filter(Boolean) : [segment.summary],
    nonGoals: flags.nonGoals ? String(flags.nonGoals).split(',').filter(Boolean) : flags['non-goals'] ? String(flags['non-goals']).split(',').filter(Boolean) : [],
    targetShape: shape,
    ownershipChanges: [shape.oldOwner || shape.targetOwner ? `${shape.oldOwner ?? 'current owner'} -> ${shape.targetOwner ?? 'target owner'}` : null].filter(Boolean),
    compatibility: shape.compatibility,
    decisionBatch: ['Confirm the target shape before executor effects.', 'Keep provider commands chat-first unless a save-* intent requests an artifact.'],
    steps: flags.steps ? String(flags.steps).split('|').filter(Boolean) : ['Resolve proof gaps.', 'Confirm target shape and compatibility.', 'Execute each accepted route through its owning operation.'],
    validation: flags.validation ? String(flags.validation).split(',').filter(Boolean) : [],
    risks: flags.risks ? String(flags.risks).split(',').filter(Boolean) : [],
    checkpoints: shape.checkpoint ? [shape.checkpoint] : ['executor checkpoint before mutation'],
    openQuestions: flags.questions ? String(flags.questions).split('|').filter(Boolean) : [],
    constraints: segment.boundary.constraints,
  }
}

function recapPacket(value) {
  const segment = activeSegment(value)
  if (!segment) throw new Error('Open a segment first.')
  return contextPacket(
    'make recap',
    `Recap for active work segment ${segment.id}.`,
    [{
      segmentId: segment.id,
      summary: segment.summary,
      frames: frameSummaries(value, segment.id),
      decisions: [],
      artifacts: segment.artifacts,
      proof: [],
      openEdges: [],
    }],
    ['Chat recap only. Use hairness-x-save-recap to persist a SegmentDigest artifact.'],
    ['hairness-x-save-recap', 'hairness-x-make-plan'],
  )
}

function planPacket(kind, value, flags = {}) {
  const payload = workPlanPayload(kind, value, flags)
  return contextPacket(
    kind === 'system-wire' ? 'plan system wire' : kind === 'system-shape' ? 'plan system shape' : 'make plan',
    `Draft work plan for segment ${payload.segmentId}.`,
    [payload],
    ['Chat plan only. Use hairness-x-save-plan to persist a WorkPlan artifact.'],
    ['hairness-x-save-plan', 'hairness-x-do-plan'],
  )
}

async function setBoundary(runtime, input) {
  const value = await state(runtime)
  if (input.scope === 'session') return save(runtime, value, { type: 'boundary.changed', scope: 'session', constraints: input.constraints })
  if (input.scope === 'segment') {
    const segment = activeSegment(value)
    if (!segment) throw new Error('No active segment.')
    segment.boundary = boundary('segment', input.constraints)
  } else {
    const frame = value.frames.find((item) => item.id === input.id && item.status === 'open')
    if (!frame) throw new Error(`Open frame not found: ${input.id}`)
    frame.boundary = boundary('frame', input.constraints)
  }
  return save(runtime, value, { type: 'boundary.changed', scope: input.scope, id: input.id, constraints: input.constraints })
}

export const services = {
  state: async ({ runtime }) => state(runtime),
  'set-boundary': async ({ input, runtime }) => setBoundary(runtime, input),
  controls: async ({ runtime }) => effectiveControls(await state(runtime)),
}

function effectiveControls(value) {
  const segment = activeSegment(value)
  const frame = value.frames.filter((item) => item.segmentId === value.activeSegmentId && item.status === 'open').at(-1)
  return { ...(value.controls ?? {}), ...(segment?.controls ?? {}), ...(frame?.controls ?? {}) }
}

export async function invocationControls({ runtime, manifest }) {
  const value = await state(runtime)
  const segment = activeSegment(value)
  const frame = value.frames.filter((item) => item.segmentId === value.activeSegmentId && item.status === 'open').at(-1)
  return [
    { owner: manifest.id, scope: 'session', priority: 50, values: value.controls ?? {}, proof: [], limits: [] },
    ...(segment ? [{ owner: manifest.id, scope: 'segment', priority: 50, values: segment.controls ?? {}, proof: [], limits: [] }] : []),
    ...(frame ? [{ owner: manifest.id, scope: 'frame', priority: 50, values: frame.controls ?? {}, proof: [], limits: [] }] : []),
  ]
}

async function methodCommand(action, rest, runtime) {
  const value = await state(runtime)
  const bindings = (await runtime.extensions.list()).flatMap((extension) => (extension.methodologyBindings ?? []).map((binding) => ({ ...binding, owner: extension.id })))
  if (!action || action === 'show') return { active: value.methodologyBinding, available: bindings, summary: value.methodologyBinding ? `Methodology ${value.methodologyBinding} is active.` : 'No methodology binding is active.', limits: [], routes: [] }
  if (action === 'clear') {
    value.methodologyBinding = null
    return save(runtime, value, { type: 'methodology.cleared' })
  }
  if (action !== 'set' || !rest[0]) throw new Error('Usage: hairness work method show|set <binding>|clear')
  if (!bindings.some((binding) => binding.id === rest[0])) throw new Error(`Methodology binding is unavailable: ${rest[0]}`)
  value.methodologyBinding = rest[0]
  return save(runtime, value, { type: 'methodology.selected', id: rest[0] })
}

export async function sessionContributions({ runtime, manifest }) {
  const value = await state(runtime)
  const segment = activeSegment(value)
  const frame = value.frames.filter((item) => item.status === 'open').at(-1)
  return [{ owner: manifest.id, section: 'work', priority: 80, summary: `${value.mission?.summary ?? 'No mission'} · ${segment?.summary ?? 'no active segment'}`, data: { missionId: value.mission?.id ?? null, segmentId: segment?.id ?? null, frameId: frame?.id ?? null, boundary: frame?.boundary ?? segment?.boundary ?? null }, routes: segment ? ['hairness work status'] : ['hairness work segment open'], limits: [], freshness: value.updatedAt, byteSize: 0 }]
}

async function missionCommand(action, flags, runtime) {
  const value = await state(runtime)
  if ((action ?? 'show') === 'show') return value.mission
  if (action !== 'set' || !flags.summary) throw new Error('Usage: hairness work mission set --summary <text> [--id <id>]')
  if (value.mission?.status === 'active') throw new Error('An active mission already exists.')
  const at = timestamp()
  value.mission = { id: flags.id ?? id('mission'), summary: flags.summary, status: 'active', createdAt: at, updatedAt: at }
  return save(runtime, value, { type: 'mission.created', id: value.mission.id })
}

async function segmentCommand(action, flags, runtime) {
  const value = await state(runtime)
  if ((action ?? 'show') === 'show') return flags.id ? value.segments.find((item) => item.id === flags.id) ?? null : activeSegment(value)
  if (action === 'open') {
    if (!value.mission || value.mission.status !== 'active') throw new Error('Set an active mission first.')
    if (activeSegment(value)) throw new Error('Close the active segment before opening another.')
    const at = timestamp()
    const segment = { id: flags.id ?? id('segment'), missionId: value.mission.id, summary: flags.summary ?? 'Active work segment.', status: 'active', boundary: boundary('segment'), controls: {}, relations: relationFlags(flags), frames: [], artifacts: [], createdAt: at, updatedAt: at }
    value.segments.push(segment); value.activeSegmentId = segment.id
    return save(runtime, value, { type: 'segment.opened', id: segment.id })
  }
  if (action === 'close') {
    const segment = activeSegment(value)
    if (!segment) throw new Error('No active segment.')
    if (!flags.digest) return { summary: 'A typed SegmentDigest is required before closing this segment.', status: 'needs-artifact', segmentId: segment.id, limits: [], routes: [`hairness work recap`, `hairness work segment close --digest work/${segment.id}`] }
    const artifact = await runtime.artifacts.read(flags.digest)
    if (artifact.owner !== 'hairness/work-controls' || artifact.type !== 'segment-digest') throw new Error(`${flags.digest} is not a Work Controls SegmentDigest.`)
    if (artifact.payload.segmentId !== segment.id) throw new Error(`SegmentDigest targets ${artifact.payload.segmentId}, expected ${segment.id}.`)
    const at = timestamp(); segment.status = 'closed'; segment.updatedAt = at; segment.digestArtifact = { kind: 'artifact', id: artifact.id, revision: artifact.revision }
    segment.artifacts.push(segment.digestArtifact)
    for (const frame of value.frames.filter((item) => item.segmentId === segment.id && item.status === 'open')) { frame.status = 'closed'; frame.updatedAt = at }
    value.activeSegmentId = null
    return save(runtime, value, { type: 'segment.closed', id: segment.id, digest: artifact.id })
  }
  throw new Error(`Unknown segment action: ${action}`)
}

async function frameCommand(action, flags, runtime) {
  const value = await state(runtime)
  if ((action ?? 'show') === 'show') return flags.id ? value.frames.find((item) => item.id === flags.id) ?? null : value.frames.filter((item) => item.segmentId === value.activeSegmentId)
  const segment = activeSegment(value)
  if (!segment) throw new Error('Open a segment first.')
  if (action === 'open') {
    const posture = flags.posture ?? 'discuss'
    if (!postures.has(posture)) throw new Error(`Unknown posture: ${posture}`)
    const at = timestamp(); const frame = { id: flags.id ?? id('frame'), segmentId: segment.id, summary: flags.summary ?? 'Active frame.', posture, status: 'open', boundary: boundary('frame', segment.boundary.constraints), controls: {}, artifacts: [], sources: [], createdAt: at, updatedAt: at }
    value.frames.push(frame); segment.frames.push(frame.id); segment.updatedAt = at
    return save(runtime, value, { type: 'frame.opened', id: frame.id, segmentId: segment.id })
  }
  if (action === 'close') {
    const frame = value.frames.find((item) => item.id === flags.id && item.segmentId === segment.id)
    if (!frame) throw new Error(`Frame not found: ${flags.id}`)
    frame.status = 'closed'; frame.updatedAt = timestamp()
    return save(runtime, value, { type: 'frame.closed', id: frame.id })
  }
  throw new Error(`Unknown frame action: ${action}`)
}

async function controlCommand(action, rest, flags, runtime) {
  const value = await state(runtime)
  const scope = flags.scope ?? 'session'
  const segment = activeSegment(value)
  const frame = value.frames.filter((item) => item.segmentId === value.activeSegmentId && item.status === 'open').at(-1)
  const owner = scope === 'session' ? value : scope === 'segment' ? segment : scope === 'frame' ? frame : null
  if (!owner) throw new Error(`No active ${scope} control scope.`)
  owner.controls ??= {}
  if (!action || action === 'show') return { scope, local: owner.controls, effective: effectiveControls(value), limits: [], routes: [] }
  const [key, raw] = rest
  if (!key || !/^[A-Za-z][A-Za-z0-9.-]*$/.test(key)) throw new Error('Usage: hairness work control set|clear <key> [value] --scope session|segment|frame')
  if (action === 'set') {
    if (raw === undefined) throw new Error('Control set requires a value.')
    owner.controls[key] = raw
  } else if (action === 'clear') delete owner.controls[key]
  else throw new Error(`Unknown control action: ${action}`)
  return save(runtime, value, { type: 'control.changed', scope, key, action })
}

function postureIntent(target, action, rest, flags, value) {
  const focus = [action, ...rest].filter(Boolean).join(' ') || flags.focus || null
  const mutation = ['act', 'execute'].includes(target)
  if (['new-frame', 'act'].includes(target) && !focus) throw new Error(`${target} requires a focus.`)
  return { schemaVersion: 2, protocolVersion: '0.2', intent: { action: target, focus, mode: flags.mode ?? (target === 'discuss' ? 'discuss' : 'auto'), budget: flags.budget ?? (['plan', 'execute'].includes(target) ? 'deep' : 'balanced'), presentation: flags.present ?? 'auto' }, work: { missionId: value.mission?.id ?? null, segmentId: value.activeSegmentId }, status: mutation ? 'needs-checkpoint' : 'needs-inference', summary: `Resolved ${target} inside the active work trajectory.`, authority: [], limits: [mutation ? 'Mutation requires a WorkPlan and explicit checkpoint.' : 'Inference remains in the main session.'].filter(Boolean), routes: [] }
}

async function artifactProducer(kind, runtime, value, flags = {}) {
  const segment = activeSegment(value)
  if (!segment) throw new Error('Open a segment first.')
  const stamp = Date.now().toString(36)
  const type = kind === 'recap' ? 'segment-digest' : 'work-plan'
  const planId = `work-${kind}-${stamp}`
  const runId = `${planId}-producer`
  const fanIn = `${planId}-fan-in`
  const operation = { capability: 'hairness/work', id: kind }
  const route = { schemaVersion: 2, protocolVersion: '0.2', id: runId, operation, kind: 'worker', profile: 'producer', requirement: 'required', resultSchema: 'ArtifactEnvelope', fanIn, workload: kind === 'recap' ? 'balanced' : 'deep' }
  await runtime.plans.write({ schemaVersion: 2, protocolVersion: '0.2', id: planId, intent: { schemaVersion: 2, protocolVersion: '0.2', id: `${planId}-intent`, summary: kind === 'recap' ? `Digest segment ${segment.id}.` : `Plan accepted work for segment ${segment.id}.`, outcome: `A typed ${type} artifact.`, targets: [], limits: [] }, routes: [route], fanIn: { id: fanIn, mode: 'mechanical' } })
  const payload = kind === 'recap'
    ? { segmentId: segment.id, summary: segment.summary, decisions: [], artifacts: segment.artifacts, proof: [], openEdges: [], limits: [], routes: [] }
    : workPlanPayload(flags.planKind ?? 'default', value, flags)
  const assignment = { schemaVersion: 2, protocolVersion: '0.2', id: `produce-${type}`, operation, profile: 'producer', goal: kind === 'recap' ? 'Reduce the active segment into its minimum durable meaning.' : 'Turn accepted segment decisions into one executable bounded plan.', outcome: `Artifact work/${segment.id}-${kind} of type ${type}.`, workload: route.workload, budget: 1, inputs: [{ mission: value.mission }, { segment }, { frames: value.frames.filter((frame) => frame.segmentId === segment.id) }, { artifactContract: { id: `work/${segment.id}-${kind}`, type, owner: 'hairness/work-controls', metadata: { labels: ['work'], signals: [kind], relations: [{ type: 'informs', target: { kind: 'segment', id: segment.id } }], freshness: { policy: 'manual' }, provenance: { kind: 'extension', id: 'hairness/work-controls', version: '0.2.0-alpha.0' } }, requiredPayload: payload } }], targets: [], exclusions: ['target mutation', 'Git mutation', 'external source mutation', 'nested subagents', 'transcript storage'], allowedSources: ['artifact:read', 'work:read'], requestedEffects: [], result: { schema: 'ArtifactEnvelope', disposition: 'artifact', artifactOwner: 'hairness/work-controls', artifactType: type } }
  await runtime.runs.create({ id: runId, planId, assignment })
  await runtime.runs.transition(runId, 'ready')
  return { summary: `Prepared one bounded ${type} producer.`, status: 'ready', planId, runId, fanIn, capsule: await runtime.runs.capsule(runId), limits: [], routes: [`hairness worker ${runId} inspect --start --json`, `hairness plan ${planId} reduce --json`] }
}

async function executePlan(action, flags, runtime, value) {
  const artifactId = flags.plan ?? action
  if (!artifactId) throw new Error('execute requires --plan <artifact-id>.')
  const artifact = await runtime.artifacts.read(artifactId)
  if (artifact.owner !== 'hairness/work-controls' || artifact.type !== 'work-plan') throw new Error(`${artifactId} is not a Work Controls WorkPlan.`)
  if (artifact.payload.segmentId !== value.activeSegmentId) throw new Error('WorkPlan does not target the active segment.')
  const constraints = String(flags.constraints ?? '').split(',').filter(Boolean).sort()
  const planned = [...artifact.payload.constraints].sort()
  if (JSON.stringify(constraints) !== JSON.stringify(planned)) return { summary: 'Effective constraints must be resolved before execution.', status: 'needs-input', limits: ['Pass the exact effective constraint set through --constraints.'], routes: ['hairness constraint show --json'] }
  const checkpointId = `work-${createHash('sha256').update(JSON.stringify({ id: artifact.id, revision: artifact.revision, constraints })).digest('hex').slice(0, 12)}`
  if (!flags.checkpoint) return { summary: 'WorkPlan is resolved and needs an explicit operation checkpoint.', status: 'needs-authority', checkpoint: { id: checkpointId, target: artifact.id, constraints, effects: [], exclusions: ['unplanned effects', 'constraint bypass'] }, limits: [], routes: [`hairness work execute --plan ${artifact.id} --constraints ${constraints.join(',')} --checkpoint ${checkpointId}`] }
  if (flags.checkpoint !== checkpointId) throw new Error('WorkPlan checkpoint does not match current plan and constraints.')
  return { summary: 'WorkPlan checkpoint is valid; resolve each step through its owning operation extension.', status: 'ready', plan: artifact, constraints, authority: [], limits: ['Work Controls grants no effects itself.'], routes: artifact.payload.steps }
}

export async function handleCommand({ target, action, rest, flags, runtime }) {
  if (target === 'mission') return missionCommand(action, flags, runtime)
  if (target === 'segment') return segmentCommand(action, flags, runtime)
  if (target === 'frame') return frameCommand(action, flags, runtime)
  if (target === 'control') return controlCommand(action, rest, flags, runtime)
  const value = await state(runtime)
  if (!target || target === 'status') return value
  if (target === 'history') return { events: await runtime.overlay.lines('events.jsonl'), limits: ['Use trace or resume for compact context.'], routes: [] }
  if (target === 'trace') {
    const id = action ?? flags.id
    return { mission: value.mission?.id === id ? value.mission : null, segment: value.segments.find((item) => item.id === id) ?? null, frames: value.frames.filter((item) => item.segmentId === id), limits: [], routes: [] }
  }
  if (target === 'resume') {
    const selected = value.segments.find((item) => item.id === (action ?? flags.id)) ?? activeSegment(value)
    if (!selected) throw new Error('Segment not found.')
    return { summary: selected.summary, status: selected.status, mission: value.mission, segment: selected, frames: value.frames.filter((item) => item.segmentId === selected.id), artifacts: selected.artifacts, proof: [], limits: ['Artifact bodies are not included. Revalidate volatile sources.'], routes: selected.status === 'closed' ? [`hairness work segment open --continues ${selected.id}`] : [] }
  }
  if (target === 'method') return methodCommand(action, rest, runtime)
  if (target === 'show-method') return dashboardPacket(value, 'method')
  if (target === 'show-work') return dashboardPacket(value, 'work')
  if (target === 'show-next') return dashboardPacket(value, 'next')
  if (target === 'ask-next') return dashboardPacket(value, 'question')
  if (target === 'open-frame') return frameCommand('open', { ...flags, summary: [action, ...rest].filter(Boolean).join(' ') || flags.focus || flags.summary }, runtime)
  if (target === 'new-frame') return frameCommand('open', { ...flags, summary: [action, ...rest].filter(Boolean).join(' ') || flags.focus }, runtime)
  if (target === 'make-recap' || target === 'recap') return recapPacket(value)
  if (target === 'save-recap') return artifactProducer('recap', runtime, value, flags)
  if (target === 'make-plan' || target === 'plan') return planPacket(flags.planKind ?? 'default', value, flags)
  if (target === 'save-plan') return artifactProducer('plan', runtime, value, flags)
  if (target === 'plan-system-wire') return planPacket('system-wire', value, { ...flags, focus: [action, ...rest].filter(Boolean).join(' ') || flags.focus })
  if (target === 'plan-system-shape') return planPacket('system-shape', value, { ...flags, focus: [action, ...rest].filter(Boolean).join(' ') || flags.focus })
  if (target === 'do-frame') return postureIntent('act', action, rest, flags, value)
  if (target === 'do-plan') return executePlan(action, flags, runtime, value)
  if (target === 'execute') return executePlan(action, flags, runtime, value)
  if (postures.has(target)) return postureIntent(target, action, rest, flags, value)
  throw new Error(`Unknown work action: ${target}`)
}
