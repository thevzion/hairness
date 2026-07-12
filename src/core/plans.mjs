import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { assertSafeId, ensureOverlay, readJson, workspacePaths, writeJsonAtomic } from './io.mjs'
import { reducePlan, validateContextPlan } from './fan-in.mjs'
import { readRunResult } from './runs.mjs'

export async function writePlan(root, plan) {
  await validateContextPlan(plan)
  await ensureOverlay(root)
  assertSafeId(plan.id, 'plan id')
  await writeJsonAtomic(join(workspacePaths(root).plans, `${plan.id}.json`), plan)
  return plan
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
  return reducePlan(plan, results)
}
