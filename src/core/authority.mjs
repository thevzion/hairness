import { createHash } from 'node:crypto'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { canonicalTarget, createJsonExclusive, now, readJson, userPaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'
import { readRun, runPaths, transitionRun } from './runs.mjs'

function unrestrictedPolicy(effects) {
  return {
    owner: 'protocol/authority',
    requestedEffects: effects,
    allowedEffects: effects,
    deniedEffects: [],
    reasons: [],
    digest: `sha256:${createHash('sha256').update(JSON.stringify(effects)).digest('hex')}`,
    observedAt: now(),
  }
}

async function currentPolicy(effects, resolvePolicy) {
  return resolvePolicy ? resolvePolicy(effects) : unrestrictedPolicy(effects)
}

export async function grantCheckpoint(root, checkpoint, resolvePolicy) {
  await validateContract('Checkpoint', checkpoint)
  if (!checkpoint.approved) {
    throw new HairnessError('checkpoint_not_approved', 'Checkpoint is not approved.', {
      routes: [`hairness run ${checkpoint.runId} show`],
    })
  }
  const policy = await currentPolicy(checkpoint.effects, resolvePolicy)
  const denied = checkpoint.effects.filter((effect) => !policy.allowedEffects.includes(effect))
  if (denied.length) throw new HairnessError('effect_policy_denied', `Effect policy denied: ${denied.join(', ')}.`, { exitCode: 2, details: { policy }, routes: [`hairness run ${checkpoint.runId} show`] })
  const targets = await Promise.all(checkpoint.targets.map(canonicalTarget))
  const grant = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `grant-${checkpoint.id}`,
    runId: checkpoint.runId,
    intent: checkpoint.intent,
    targets: [...new Set(targets)].sort(),
    effects: checkpoint.effects,
    policyDigest: policy.digest,
    exclusions: checkpoint.exclusions,
    proof: checkpoint.proof,
    grantedAt: now(),
  }
  await validateContract('EffectGrant', grant)
  await writeJsonAtomic(runPaths(root, checkpoint.runId).grant, grant)
  return grant
}

export async function proposeCheckpoint(root, checkpoint, resolvePolicy) {
  await validateContract('Checkpoint', checkpoint)
  if (checkpoint.approved) throw new HairnessError('checkpoint_already_approved', 'A checkpoint proposal must not be pre-approved.', { exitCode: 2 })
  const run = await readJson(runPaths(root, checkpoint.runId).task, null)
  if (!run) throw new HairnessError('run_not_found', `Run not found: ${checkpoint.runId}`)
  if (run.state !== 'needs-authority') throw new HairnessError('run_not_waiting_authority', `Run ${checkpoint.runId} is ${run.state}.`, { exitCode: 2 })
  const targets = [...new Set(await Promise.all(checkpoint.targets.map(canonicalTarget)))].sort()
  const assignmentTargets = [...new Set(await Promise.all(run.assignment.targets.map(canonicalTarget)))].sort()
  const undeclaredTargets = targets.filter((target) => !assignmentTargets.includes(target))
  const undeclaredEffects = checkpoint.effects.filter((effect) => !run.assignment.requestedEffects.includes(effect))
  if (undeclaredTargets.length || undeclaredEffects.length) {
    throw new HairnessError('checkpoint_exceeds_assignment', 'Checkpoint target or effect exceeds the Run assignment.', {
      exitCode: 2,
      details: { undeclaredTargets, undeclaredEffects },
    })
  }
  const policy = await currentPolicy(checkpoint.effects, resolvePolicy)
  const denied = checkpoint.effects.filter((effect) => !policy.allowedEffects.includes(effect))
  if (denied.length) throw new HairnessError('effect_policy_denied', `Effect policy denied: ${denied.join(', ')}.`, { exitCode: 2, details: { policy } })
  const value = { ...checkpoint, targets, policyDigest: policy.digest }
  await validateContract('Checkpoint', value)
  const existing = await readJson(runPaths(root, checkpoint.runId).checkpoint, null)
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new HairnessError('checkpoint_changed', `Run ${checkpoint.runId} already has a different checkpoint proposal.`, { exitCode: 2 })
  if (!existing) await writeJsonAtomic(runPaths(root, checkpoint.runId).checkpoint, value)
  return value
}

export async function approveCheckpoint(root, runId, checkpointId, resolvePolicy) {
  const run = await readRun(root, runId)
  if (run.state !== 'needs-authority') throw new HairnessError('run_not_waiting_authority', `Run ${runId} is ${run.state}.`, { exitCode: 2 })
  const checkpoint = await readJson(runPaths(root, runId).checkpoint, null)
  if (!checkpoint) throw new HairnessError('checkpoint_missing', `Run ${runId} has no checkpoint proposal.`, { exitCode: 2 })
  if (checkpoint.id !== checkpointId || checkpoint.runId !== runId) throw new HairnessError('checkpoint_mismatch', 'Checkpoint does not match the active Run.', { exitCode: 2 })
  const policy = await currentPolicy(checkpoint.effects, resolvePolicy)
  if (policy.digest !== checkpoint.policyDigest) throw new HairnessError('checkpoint_stale', 'Authority policy changed after checkpoint preparation.', { exitCode: 2, details: { prepared: checkpoint.policyDigest, current: policy.digest } })
  const targets = await acquireLocks(checkpoint.targets, runId)
  try {
    const grant = await grantCheckpoint(root, { ...checkpoint, approved: true }, resolvePolicy)
    await transitionRun(root, runId, 'ready', { reason: 'checkpoint approved', grantId: grant.id })
    return grant
  } catch (error) {
    await releaseLocks(targets, runId).catch(() => {})
    throw error
  }
}

export async function assertEffectAllowed(root, runId, effect, target, resolvePolicy) {
  const grant = await readJson(runPaths(root, runId).grant, null)
  if (!grant) throw new HairnessError('authority_missing', `Run ${runId} has no effect grant.`, { routes: [`hairness run ${runId} show`] })
  await validateContract('EffectGrant', grant)
  const canonical = await canonicalTarget(target)
  if (!grant.effects.includes(effect) || !grant.targets.includes(canonical)) {
    throw new HairnessError('authority_exceeded', `Effect ${effect} on ${target} is not authorized.`, {
      routes: [`hairness run ${runId} show`],
    })
  }
  const policy = await currentPolicy([effect], resolvePolicy)
  if (!policy.allowedEffects.includes(effect)) {
    throw new HairnessError('authority_revoked', `Effect ${effect} is no longer allowed by the current policy.`, {
      exitCode: 2,
      details: { grantedPolicyDigest: grant.policyDigest, currentPolicy: policy },
      routes: [`hairness run ${runId} show`],
    })
  }
  return grant
}

function lockFile(path) {
  const hash = createHash('sha256').update(path).digest('hex')
  return join(userPaths().locks, `${hash}.json`)
}

export async function acquireLocks(targets, owner) {
  const canonical = [...new Set(await Promise.all(targets.map(canonicalTarget)))].sort()
  const acquired = []
  try {
    for (const target of canonical) {
      const path = lockFile(target)
      await createJsonExclusive(path, { schemaVersion: 2, protocolVersion: '0.2', target, owner, state: 'locked', acquiredAt: now() })
      acquired.push(path)
    }
  } catch (error) {
    await Promise.all(acquired.map((path) => unlink(path).catch(() => {})))
    if (error.code === 'EEXIST') throw new HairnessError('target_locked', 'One or more targets are already locked.')
    throw error
  }
  return canonical
}

export async function releaseLocks(targets, owner) {
  const canonical = [...new Set(await Promise.all(targets.map(canonicalTarget)))].sort()
  for (const target of canonical) {
    const path = lockFile(target)
    const lock = await readJson(path, null)
    if (!lock) continue
    if (lock.owner !== owner) throw new HairnessError('lock_owner_mismatch', `Lock for ${target} belongs to ${lock.owner}.`)
    if (lock.state === 'unknown') throw new HairnessError('target_quarantined', `Target is quarantined: ${target}.`, { routes: ['hairness lock resolve'] })
    await unlink(path)
  }
}

export async function quarantineLocks(targets, owner, reason) {
  const canonical = [...new Set(await Promise.all(targets.map(canonicalTarget)))].sort()
  for (const target of canonical) {
    const path = lockFile(target)
    const lock = await readJson(path, null)
    if (!lock || lock.owner !== owner) throw new HairnessError('lock_owner_mismatch', `Cannot quarantine unowned target: ${target}.`)
    await writeJsonAtomic(path, { ...lock, state: 'unknown', reason, quarantinedAt: now() })
  }
}

export async function listLocks() {
  const directory = userPaths().locks
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'))))
}

export async function resolveLock(target) {
  const canonical = await canonicalTarget(target)
  const path = lockFile(canonical)
  const lock = await readJson(path, null)
  if (!lock) throw new HairnessError('lock_not_found', `No lock for ${canonical}.`)
  await unlink(path)
  return lock
}
