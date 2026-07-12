import { HairnessError } from './errors.mjs'
import { validateContract } from './contracts.mjs'

const terminalSuccess = new Set(['succeeded'])

export async function validateContextPlan(plan) {
  await validateContract('ContextPlan', plan)
  const ids = new Set()
  for (const route of plan.routes) {
    if (ids.has(route.id)) throw new HairnessError('duplicate_route', `Duplicate route: ${route.id}`, { exitCode: 2 })
    ids.add(route.id)
    if (route.fanIn !== plan.fanIn.id) {
      throw new HairnessError('fan_in_missing', `Route ${route.id} does not return to fan-in ${plan.fanIn.id}.`, { exitCode: 2 })
    }
  }
  if (plan.fanIn.mode === 'semantic') {
    const reducer = plan.routes.find((route) => route.id === plan.fanIn.routeId)
    if (!reducer || reducer.kind !== 'producer') {
      throw new HairnessError('semantic_reducer_missing', 'Semantic fan-in requires a producer reducer route.', { exitCode: 2 })
    }
  }
  return plan
}

function stableByteSize(packet) {
  let size = 0
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = Buffer.byteLength(JSON.stringify({ ...packet, byteSize: size }))
    if (next === size) return size
    size = next
  }
  return size
}

export async function reducePlan(plan, resultValues) {
  await validateContextPlan(plan)
  const byRun = new Map(resultValues.map((result) => [result.runId, result]))
  const results = []
  const proof = []
  const limits = []
  const routes = []
  let blocked = false

  for (const route of plan.routes) {
    const result = byRun.get(route.id)
    if (!result) {
      if (route.requirement === 'required') blocked = true
      limits.push(`${route.id}: no result`)
      continue
    }
    await validateContract('RunResult', result)
    results.push({ routeId: route.id, status: result.status, summary: result.summary.slice(0, 320) })
    proof.push(...result.proof)
    limits.push(...result.limits)
    routes.push(...result.routes)
    if (!terminalSuccess.has(result.status)) {
      if (route.requirement === 'required') blocked = true
      else limits.push(`${route.id}: optional route ${result.status}`)
    }
  }

  const packet = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    planId: plan.id,
    intent: plan.intent.summary,
    status: blocked ? 'blocked' : 'succeeded',
    summary: blocked ? 'Required work did not complete.' : 'All required routes completed.',
    results,
    proof: [...new Set(proof)].slice(0, 32),
    effects: [],
    tests: [],
    limits: [...new Set(limits)].slice(0, 32),
    routes: [...new Set(routes)].slice(0, 16),
    byteSize: 0,
  }
  packet.byteSize = stableByteSize(packet)
  if (packet.byteSize > 8192) throw new HairnessError('context_budget_exceeded', `ContextPacket is ${packet.byteSize} bytes.`, { exitCode: 2 })
  await validateContract('ContextPacket', packet)
  return packet
}
