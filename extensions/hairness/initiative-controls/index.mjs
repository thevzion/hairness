import { createHash } from 'node:crypto'

const now = () => new Date().toISOString()
const empty = () => ({ schemaVersion: 2, protocolVersion: '0.2', initiatives: [], updatedAt: now() })
const split = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
async function state(runtime) { return runtime.overlay.read('state.json', empty()) }
async function save(runtime, value, event) {
  value.updatedAt = now()
  await runtime.contracts.validateSchema('./schemas/initiative-state.schema.json', value, 'Initiative state')
  await runtime.overlay.append('events.jsonl', { at: value.updatedAt, ...event })
  return runtime.overlay.write('state.json', value)
}
const active = (value) => value.initiatives.find((item) => item.state === 'active') ?? null

export const services = {
  active: async ({ runtime }) => active(await state(runtime)),
  list: async ({ runtime }) => (await state(runtime)).initiatives,
}

export async function attentionSignals({ runtime }) {
  const current = active(await state(runtime))
  return current ? [{ state: 'active', priority: 45, summary: `${current.id}: ${current.gate}`, route: 'hairness initiative status' }] : []
}

function snapshot(value) {
  const sections = ['# Hairness Status', '', '## Now', '']
  const current = active(value)
  sections.push(current ? `- \`${current.id}\` — ${current.outcome}\n  - Gate: ${current.gate}` : '- None.')
  sections.push('', '## Next', '')
  const next = value.initiatives.filter((item) => item.state === 'planned').slice(0, 3)
  sections.push(...(next.length ? next.map((item) => `- \`${item.id}\` — ${item.outcome}\n  - Gate: ${item.gate}`) : ['- None.']))
  return `${sections.join('\n')}\n`
}

export async function handleCommand({ target, action, flags, runtime }) {
  const value = await state(runtime)
  const mode = target ?? 'status'
  if (mode === 'status') return { active: active(value), next: value.initiatives.filter((item) => item.state === 'planned').slice(0, 3), blocked: value.initiatives.filter((item) => item.state === 'blocked'), limits: [], routes: [] }
  if (mode === 'list') return { initiatives: value.initiatives, limits: [], routes: [] }
  if (mode === 'show') return value.initiatives.find((item) => item.id === action) ?? null
  if (mode === 'open') {
    const id = action ?? flags.id
    if (!id || !flags.outcome || !flags.gate) throw new Error('Usage: hairness initiative open <id> --outcome <text> --gate <text>')
    if (value.initiatives.some((item) => item.id === id)) throw new Error(`Initiative already exists: ${id}`)
    if (active(value)) throw new Error('Close or block the active initiative before opening another.')
    const at = now(); const item = { id, outcome: flags.outcome, state: 'active', gate: flags.gate, evidence: [], links: split(flags.links), createdAt: at, updatedAt: at }
    value.initiatives.push(item); await save(runtime, value, { type: 'initiative.opened', id }); return item
  }
  if (mode === 'close') {
    const item = value.initiatives.find((candidate) => candidate.id === action)
    if (!item || item.state !== 'active') throw new Error(`Active initiative not found: ${action}`)
    const evidence = split(flags.evidence)
    if (!evidence.length) throw new Error('Closing an initiative requires --evidence.')
    item.state = 'closed'; item.evidence.push(...evidence); item.updatedAt = now(); await save(runtime, value, { type: 'initiative.closed', id: item.id }); return item
  }
  if (mode === 'publish') {
    const content = snapshot(value)
    const checkpointId = `initiative-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
    if (flags.checkpoint !== checkpointId) return { summary: 'Roadmap snapshot needs explicit filesystem authority.', status: 'needs-authority', checkpoint: { id: checkpointId, target: 'STATUS.md', effects: ['filesystem:write'], exclusions: ['Git mutation', 'push', 'merge', 'release'] }, preview: content, limits: [], routes: [`hairness initiative publish --checkpoint ${checkpointId}`] }
    return { summary: 'Roadmap snapshot is ready for one bounded executor.', status: 'ready', operation: { target: 'STATUS.md', content, digest: `sha256:${createHash('sha256').update(content).digest('hex')}` }, limits: ['No file was written and no Git action occurred.'], routes: ['dispatch executor and submit ChangeReceipt'] }
  }
  throw new Error(`Unknown initiative action: ${mode}`)
}
