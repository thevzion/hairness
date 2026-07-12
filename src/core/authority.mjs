import { createHash } from 'node:crypto'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { HairnessError } from './errors.mjs'
import { canonicalPath, createJsonExclusive, now, readJson, userPaths, writeJsonAtomic } from './io.mjs'
import { validateContract } from './contracts.mjs'
import { runPaths } from './runs.mjs'

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
  const grant = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `grant-${checkpoint.id}`,
    runId: checkpoint.runId,
    intent: checkpoint.intent,
    targets: checkpoint.targets,
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

export async function assertEffectAllowed(root, runId, effect, target, resolvePolicy) {
  const grant = await readJson(runPaths(root, runId).grant, null)
  if (!grant) throw new HairnessError('authority_missing', `Run ${runId} has no effect grant.`, { routes: [`hairness run ${runId} show`] })
  await validateContract('EffectGrant', grant)
  if (!grant.effects.includes(effect) || !grant.targets.includes(target)) {
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
  const canonical = [...new Set(await Promise.all(targets.map(canonicalPath)))].sort()
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
  const canonical = [...new Set(await Promise.all(targets.map(canonicalPath)))].sort()
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
  const canonical = [...new Set(await Promise.all(targets.map(canonicalPath)))].sort()
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
  const canonical = await canonicalPath(target)
  const path = lockFile(canonical)
  const lock = await readJson(path, null)
  if (!lock) throw new HairnessError('lock_not_found', `No lock for ${canonical}.`)
  await unlink(path)
  return lock
}
