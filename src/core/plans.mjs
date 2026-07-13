import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { assertSafeId, ensureOverlay, readJson, workspacePaths, writeJsonAtomic } from './io.mjs'
import { reducePlan, validateContextPlan } from './fan-in.mjs'
import { readRunResult } from './runs.mjs'
import { acceptInvocationResult, createSyntheticPlanInvocation, readInvocationReceipt } from './invocations.mjs'

export async function writePlan(root, plan) {
  const value = { ...plan }
  value.parentInvocationId ??= await createSyntheticPlanInvocation(root, value)
  await validateContextPlan(value)
  await ensureOverlay(root)
  assertSafeId(value.id, 'plan id')
  await writeJsonAtomic(join(workspacePaths(root).plans, `${value.id}.json`), value)
  return value
}

export async function readPlan(root, planId) {
  assertSafeId(planId, 'plan id')
  const plan = await readJson(join(workspacePaths(root).plans, `${planId}.json`), null)
  if (!plan) throw new HairnessError('plan_not_found', `Plan not found: ${planId}`)
  return validateContextPlan(plan)
}

export async function reduceStoredPlan(root, planId) {
  const plan = await readPlan(root, planId)
  const results = (await Promise.all(plan.routes.map((route) => readRunResult(root, route.id)))).filter(Boolean)
  const packet = await reducePlan(plan, results)
  if (plan.parentInvocationId && !await readInvocationReceipt(root, plan.parentInvocationId)) await acceptInvocationResult(root, { schemaVersion: 2, protocolVersion: '0.2', invocationId: plan.parentInvocationId, resultId: 'fan-in', summary: packet.summary, payload: packet, proof: packet.proof, limits: packet.limits, routes: packet.routes }, { schema: 'ContextPacket', disposition: 'response' })
  return packet
}
