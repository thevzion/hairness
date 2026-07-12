import { createHash } from 'node:crypto'

const now = () => new Date().toISOString()
const empty = () => ({ schemaVersion: 2, protocolVersion: '0.2', plans: [], receipts: [], updatedAt: now() })
const split = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
async function state(runtime) { return runtime.overlay.read('state.json', empty()) }
async function save(runtime, value, event) {
  value.updatedAt = now()
  await runtime.contracts.validateSchema('./schemas/delivery-state.schema.json', value, 'Delivery state')
  await runtime.overlay.append('events.jsonl', { at: value.updatedAt, ...event })
  return runtime.overlay.write('state.json', value)
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function releaseCandidate(plan, receipt, runtime) {
  const planId = `release-${plan.id}`; const runId = `${planId}-producer`; const fanIn = `${planId}-fan-in`
  const operation = { capability: 'hairness/delivery', id: 'release-candidate' }
  await runtime.plans.write({ schemaVersion: 2, protocolVersion: '0.2', id: planId, intent: { schemaVersion: 2, protocolVersion: '0.2', id: `${planId}-intent`, summary: `Prepare release candidate for ${plan.initiativeId}.`, outcome: 'A typed release candidate and launch kit.', targets: [], limits: [] }, routes: [{ schemaVersion: 2, protocolVersion: '0.2', id: runId, operation, kind: 'worker', profile: 'producer', requirement: 'required', resultSchema: 'ArtifactEnvelope', fanIn, workload: 'deep' }], fanIn: { id: fanIn, mode: 'mechanical' } })
  await runtime.runs.create({ id: runId, planId, assignment: { schemaVersion: 2, protocolVersion: '0.2', id: `produce-${planId}`, operation, profile: 'producer', goal: 'Reduce accepted delivery proof into a release candidate and launch kit.', outcome: `Artifact release/${plan.id} of type release-candidate.`, workload: 'deep', budget: 1, inputs: [{ plan }, { receipt }, { requiredPayload: { planId: plan.id, version: '0.2.0-alpha.0', changes: [], checks: receipt.proof, limitations: [], launchKit: { messages: [], audiences: [], faq: [], drafts: {}, order: [] } } }], targets: [], exclusions: ['Git mutation', 'npm publish', 'tag', 'release', 'social post', 'nested subagents'], allowedSources: ['artifact:read', 'git:read'], requestedEffects: [], result: { schema: 'ArtifactEnvelope', disposition: 'artifact', artifactOwner: 'hairness/delivery-controls', artifactType: 'release-candidate' } } })
  await runtime.runs.transition(runId, 'ready')
  return { summary: 'Prepared one bounded release-candidate producer.', status: 'ready', planId, runId, capsule: await runtime.runs.capsule(runId), limits: ['No publication or social post occurred.'], routes: [`hairness worker ${runId} inspect --start --json`, `hairness plan ${planId} reduce --json`] }
}

export async function handleCommand({ target, action, flags, runtime }) {
  const value = await state(runtime)
  const mode = target ?? 'status'
  if (mode === 'status') return { plans: value.plans, receipts: value.receipts, limits: [], routes: [] }
  if (mode === 'plan') {
    const initiative = action ? { id: action } : await runtime.extensions.call('hairness/initiative-controls', 'active')
    if (!initiative?.id) throw new Error('Open an initiative or pass its id before planning delivery.')
    const steps = ['check', 'commit', 'push', 'pull-request', 'ci', 'release-candidate']
    const id = `delivery-${initiative.id}-${hash({ initiative: initiative.id, steps }).slice(0, 12)}`
    const existing = value.plans.find((item) => item.id === id)
    if (existing) return existing
    const at = now(); const plan = { id, initiativeId: initiative.id, state: 'planned', steps, exclusions: ['automatic Git mutation', 'automatic merge', 'automatic tag', 'automatic publish'], createdAt: at, updatedAt: at }
    value.plans.push(plan); await save(runtime, value, { type: 'delivery.planned', id }); return plan
  }
  const plan = value.plans.find((item) => item.id === action)
  if (!plan) throw new Error(`Delivery plan not found: ${action}`)
  if (mode === 'checkpoint') {
    const step = flags.step ?? plan.steps.find((candidate) => !value.receipts.some((receipt) => receipt.planId === plan.id && receipt.summary.startsWith(`${candidate}:`)))
    if (!step || !plan.steps.includes(step)) throw new Error('No pending delivery step.')
    const checkpointId = `delivery-${hash({ plan: plan.id, step, head: flags.head ?? null }).slice(0, 16)}`
    return { summary: `${step} needs explicit external authority.`, status: 'needs-authority', checkpoint: { id: checkpointId, planId: plan.id, step, targets: split(flags.targets), effects: step === 'check' || step === 'ci' ? [] : ['git:write', 'remote:write'], exclusions: plan.exclusions }, limits: [], routes: [`dispatch executor for ${step}`, `hairness delivery receipt ${plan.id} --summary '${step}: ...' --proof <evidence>`] }
  }
  if (mode === 'receipt') {
    const proof = split(flags.proof)
    if (!flags.summary || !proof.length) throw new Error('Receipt requires --summary and --proof.')
    const receipt = { planId: plan.id, summary: flags.summary, proof, observedAt: now() }
    value.receipts.push(receipt); plan.state = 'in-progress'; plan.updatedAt = receipt.observedAt; await save(runtime, value, { type: 'delivery.received', id: plan.id }); return receipt
  }
  if (mode === 'release-candidate') {
    const receipt = value.receipts.findLast((item) => item.planId === plan.id)
    if (!receipt) return { summary: 'Delivery proof is missing.', status: 'blocked', limits: ['Submit at least one typed receipt.'], routes: [`hairness delivery receipt ${plan.id}`] }
    return releaseCandidate(plan, receipt, runtime)
  }
  throw new Error(`Unknown delivery action: ${mode}`)
}
