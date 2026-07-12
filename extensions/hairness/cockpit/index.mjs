import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function attentionSignals({ root, runtime }) {
  let onboarding = null
  try { onboarding = JSON.parse(await readFile(join(root, '.overlay', 'onboarding.json'), 'utf8')) } catch {}
  const signals = []
  if (onboarding?.state !== 'applied') signals.push({ state: 'blocked', priority: 100, summary: 'Local onboarding is incomplete.', route: 'hairness onboarding next' })
  const runs = await runtime.runs.list()
  const incompatible = runs.find((run) => run.incompatible)
  if (incompatible) signals.push({ state: 'blocked', priority: 80, summary: 'An incompatible local run needs explicit review.', route: `hairness run ${incompatible.id} show` })
  if (runs.some((run) => !['succeeded', 'failed', 'invalid', 'cancelled'].includes(run.state))) signals.push({ state: 'active', priority: 55, summary: 'A local run needs attention.', route: 'hairness metrics' })
  return signals
}

export async function sessionContributions({ runtime, manifest }) {
  const signals = (await runtime.extensions.collect('attention')).sort((left, right) => right.priority - left.priority).slice(0, 1).map((signal) => ({ state: signal.state, priority: signal.priority, summary: signal.summary.slice(0, 80), route: signal.route.slice(0, 80) }))
  return [{
    owner: manifest.id,
    section: 'attention',
    priority: 100,
    summary: (signals[0]?.summary ?? 'Hairness is ready.').slice(0, 64),
    data: { signals },
    routes: signals.map((signal) => signal.route),
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
    const commands = extensions.flatMap((extension) => extension.providerCommands ?? []).sort((a, b) => a.name.localeCompare(b.name))
    const groups = Object.groupBy(commands, (command) => command.classification ?? 'specialized')
    return { summary: `${distribution.displayName} exposes ${commands.length} provider commands.`, providerInvocations: { codex: '$<command>', claude: '/<command>' }, primary: groups.primary ?? [], accelerators: groups.accelerator ?? [], specialized: flags?.all ? groups.specialized ?? [] : [], limits: flags?.all ? [] : ['Use --all to show specialized commands.'], routes: ['hairness wake-up'] }
  }
  const signals = (await runtime.extensions.collect('attention', { intent: flags?.intent ?? null })).sort((a, b) => b.priority - a.priority).slice(0, 20)
  return { summary: signals.length ? signals[0].summary : 'Hairness is ready; no active attention signal.', status: signals.some((signal) => signal.state === 'blocked') ? 'blocked' : 'ready', attention: signals, next: signals[0]?.route ?? 'hairness help', limits: [], routes: signals[0] ? [signals[0].route] : [] }
}
