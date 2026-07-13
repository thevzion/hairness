import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function contextPacket(intent, summary, results, limits = [], routes = [], status = 'succeeded') {
  const value = { schemaVersion: 2, protocolVersion: '0.2', planId: `cockpit-${Date.now().toString(36)}`, intent, status, summary, results, proof: [], effects: [], tests: [], limits, routes, byteSize: 0 }
  value.byteSize = Buffer.byteLength(JSON.stringify(value))
  return value
}

async function attentionIndex(runtime, limit = 20) {
  const collected = await runtime.extensions.collect('attention')
  const deduplicated = new Map()
  for (const item of collected) {
    const key = item.id ?? `${item.work?.segmentId ?? ''}:${item.route}:${item.summary}`
    const current = deduplicated.get(key)
    if (!current || item.priority > current.priority || (item.priority === current.priority && (item.lastActivityAt ?? '') > (current.lastActivityAt ?? ''))) deduplicated.set(key, item)
  }
  const items = [...deduplicated.values()].sort((left, right) => right.priority - left.priority || (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '') || (left.id ?? left.route).localeCompare(right.id ?? right.route)).slice(0, limit)
  return runtime.contracts.validate('AttentionIndex', { schemaVersion: 2, protocolVersion: '0.2', items, generatedAt: new Date().toISOString(), limits: [], routes: items.map((item) => item.route) })
}

export async function attentionSignals({ root, runtime }) {
  let onboarding = null
  try { onboarding = JSON.parse(await readFile(join(root, '.overlay', 'onboarding.json'), 'utf8')) } catch {}
  const signals = []
  if (onboarding?.state !== 'applied') signals.push({ state: 'blocked', priority: 100, summary: 'Local onboarding is incomplete.', route: 'hairness onboarding next' })
  const invocations = await runtime.invocations.list({ state: 'open' })
  for (const invocation of invocations) signals.push({ id: invocation.id, kind: 'invocation', state: invocation.state === 'needs-authority' || invocation.state === 'needs-input' ? 'blocked' : 'active', priority: invocation.state === 'needs-authority' ? 100 : invocation.state === 'needs-input' ? 95 : 75, summary: invocation.request.summary, route: `hairness invoke show ${invocation.id}`, lastActivityAt: invocation.updatedAt, work: invocation.request.work, limits: invocation.preview.limits })
  const completed = (await runtime.invocations.list({ state: 'terminal' })).filter((item) => !item.legacy && item.state === 'completed').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5)
  for (const invocation of completed) signals.push({ id: `result-${invocation.id}`, kind: 'result', state: 'ready', priority: 25, summary: invocation.request.summary, route: `hairness invoke show ${invocation.id}`, lastActivityAt: invocation.updatedAt, work: invocation.request.work, limits: [] })
  const runs = await runtime.runs.list()
  const incompatible = runs.filter((item) => item.incompatible)
  if (incompatible.length) signals.push({ id: 'legacy-runs', kind: 'run', state: 'blocked', priority: 90, summary: `${incompatible.length} incompatible legacy Run(s) need review.`, route: 'hairness maintain metrics', lastActivityAt: new Date(0).toISOString(), limits: ['run-protocol-incompatible'] })
  for (const run of runs.filter((item) => !item.incompatible && !['succeeded', 'failed', 'invalid', 'cancelled'].includes(item.state))) signals.push({ id: run.id, kind: 'run', state: ['needs-authority', 'needs-input', 'needs-budget', 'needs-split'].includes(run.state) ? 'blocked' : 'active', priority: run.state === 'needs-authority' ? 100 : run.state === 'needs-input' ? 95 : 70, summary: run.assignment?.goal ?? `Run ${run.id} needs attention.`, route: `hairness run ${run.id} show`, lastActivityAt: run.updatedAt ?? new Date(0).toISOString(), limits: run.limits ?? [] })
  if (runtime.artifacts) for (const artifact of (await runtime.artifacts.list()).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5)) signals.push({ id: `artifact-${artifact.id.replace('/', '-')}`, kind: 'artifact', state: 'ready', priority: 20, summary: artifact.summary, route: `hairness artifact ${artifact.id} show`, lastActivityAt: artifact.createdAt, limits: [] })
  return signals
}

export async function sessionContributions({ runtime, manifest }) {
  const indexed = (await attentionIndex(runtime, 3)).items
  const signals = indexed.map((signal) => ({ state: signal.state, summary: signal.summary.slice(0, 24) }))
  return [{
    owner: manifest.id,
    section: 'attention',
    priority: 100,
    summary: (indexed[0]?.summary ?? 'Hairness is ready.').slice(0, 32),
    data: { signals },
    routes: indexed[0] ? [indexed[0].route] : [],
    limits: [],
    freshness: new Date().toISOString(),
    byteSize: 0,
  }]
}

export async function renderSessionOpening({ input }) {
  const opening = input.opening
  const lines = [
    '# Hairness session opening',
    '',
    opening.instruction,
    `${opening.distribution.displayName} (${opening.distribution.role}) · implementation ${opening.distribution.implementationVersion} · protocol ${opening.protocolVersion}`,
    `Profile: ${opening.profile.name ?? 'unset'} · language ${opening.profile.language} · timezone ${opening.profile.timezone}`,
  ]
  for (const contribution of opening.contributions) lines.push(`${contribution.section}: ${contribution.summary}`)
  if (opening.limits.length) lines.push(`Limits: ${opening.limits.join(', ')}`)
  if (opening.routes[0]) lines.push(`Next: ${opening.routes[0]}`)
  lines.push('', 'Artifacts orient. Live sources prove. Checkpoints grant operation-scoped authority.')
  return `${lines.join('\n')}\n`
}

export async function providerHooks() {
  return [{ id: 'session-opening', event: 'SessionStart', command: 'hairness session prologue', timeout: 5 }]
}

export async function handleCommand({ namespace, flags, runtime }) {
  if (namespace === 'help') {
    const distribution = await runtime.distribution.read()
    const extensions = await runtime.extensions.list()
    const commands = extensions.flatMap((extension) => extension.commandSurfaces ?? []).sort((a, b) => a.name.localeCompare(b.name))
    const groups = Object.groupBy(commands, (command) => command.classification ?? 'specialized')
    const surfaces = Object.groupBy(commands, (command) => command.surface ?? 'specialized')
    return contextPacket('show command surface', `${distribution.displayName} exposes ${commands.length} command surfaces.`, [{ providerInvocations: { codex: '$<command>', claude: '/<command>' }, surfaces, primary: groups.primary ?? [], accelerators: groups.accelerator ?? [], specialized: flags?.all ? groups.specialized ?? [] : [] }], flags?.all ? [] : ['Command surfaces are projections; CLI routes remain the machine interface.', 'Use --all to show specialized commands.'], ['hairness wake-up'])
  }
  const index = await attentionIndex(runtime, namespace === 'topics' ? 20 : 3)
  const summary = index.items.length ? index.items[0].summary : 'Hairness is ready; no active attention signal.'
  return contextPacket(namespace === 'topics' ? 'show recoverable topics' : 'wake up', summary, [{ attention: index.items, next: index.items[0]?.route ?? 'hairness help' }], index.limits, index.items.map((item) => item.route), index.items.some((item) => item.state === 'blocked') ? 'blocked' : 'succeeded')
}
