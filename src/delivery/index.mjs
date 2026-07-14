import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { saveArtifact, showArtifact } from '../artifacts/index.mjs'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { prepareEffect } from '../operations/index.mjs'
import { activeScratch } from '../scratch/index.mjs'
import { ensureRuntime, runtimePaths, targetBindings } from '../runtime/index.mjs'
import { git, inspectGit } from '../runtime/git.mjs'

export const deliveryStages = Object.freeze(['after-implementation', 'before-publish-pr', 'before-merge', 'after-merge'])

export async function acceptDeliveryBrief(root, options) {
  if (!options.accepted) throw new HairnessError('delivery_hypothesis_unaccepted', 'Accept the delivery hypothesis before saving a DeliveryBrief.')
  const scratch = options.scratch ?? await activeScratch(root, options.session)
  if (!scratch) throw new HairnessError('scratch_not_attached', 'Delivery needs an active Scratch as its work identity.')
  const payload = {
    outcome: required(options.outcome, 'outcome'),
    acceptanceCriteria: nonEmptyArray(options.acceptanceCriteria, 'acceptanceCriteria'),
    scope: nonEmptyArray(options.scope, 'scope'),
    nonGoals: options.nonGoals ?? [],
    target: required(options.target, 'target'),
    base: required(options.base, 'base'),
    releaseImpact: options.releaseImpact ?? 'none',
    requiredChecks: options.requiredChecks ?? [],
  }
  return saveArtifact(root, {
    owner: 'hairness/delivery', type: 'delivery-brief', id: options.id ?? scratch,
    mediaType: 'application/json', payload, provenance: { scratch, accepted: true },
    validatePayload: validateDeliveryBrief,
  })
}

export async function selectCheckout(root, options) {
  const home = await loadHome(root)
  const scratch = required(options.scratch ?? await activeScratch(root, options.session), 'scratch')
  const bindings = await targetBindings(home)
  const binding = bindings.targets[options.target]
  if (!binding) throw new HairnessError('target_unbound', `Target ${options.target} has no local binding.`)
  const runtime = await ensureRuntime(home)
  const lockPath = checkoutLockPath(runtime, options.target, scratch)
  const existingLock = await readJson(lockPath, null)
  if (existingLock) return { strategy: existingLock.worktree ? 'isolate' : 'reuse', ...existingLock }
  const targetLocks = await checkoutLocks(runtime, options.target)
  const evidence = await inspectGit(binding.path)
  const baseCommit = await git(['rev-parse', options.base ?? 'HEAD'], { cwd: binding.path })
  const compatible = evidence.head === baseCommit
  const occupied = targetLocks.some((lock) => lock.scratch !== scratch && !lock.worktree)
  const isolate = Boolean(options.parallel || !evidence.clean || !compatible || occupied)

  if (!isolate) {
    const lock = { scratch, target: options.target, path: evidence.root, worktree: false, head: evidence.head, base: baseCommit, createdAt: new Date().toISOString() }
    await writeJsonAtomic(lockPath, lock)
    return { strategy: 'reuse', ...lock }
  }

  const path = join(runtime.checkouts, `${slug(scratch)}-${slug(options.target)}`)
  if (await exists(path)) throw new HairnessError('checkout_exists', `Isolated checkout already exists: ${path}.`)
  const branch = options.branch ?? `hairness/${slug(scratch)}`
  if (await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: binding.path }).then(() => true).catch(() => false)) {
    throw new HairnessError('checkout_branch_exists', `Branch ${branch} already exists; choose another delivery branch.`)
  }
  await mkdir(runtime.checkouts, { recursive: true })
  await git(['worktree', 'add', '--quiet', '-b', branch, path, baseCommit], { cwd: binding.path })
  const checkoutEvidence = await inspectGit(path)
  const lock = { scratch, target: options.target, path, worktree: true, branch, head: checkoutEvidence.head, base: baseCommit, createdAt: new Date().toISOString() }
  await writeJsonAtomic(lockPath, lock)
  return { strategy: 'isolate', reason: { dirty: !evidence.clean, incompatible: !compatible, occupied: Boolean(occupied), parallel: Boolean(options.parallel) }, ...lock }
}

export async function releaseCheckout(root, target, scratch) {
  const home = await loadHome(root)
  const runtime = runtimePaths(home.metadata.id)
  const lockPath = checkoutLockPath(runtime, target, scratch)
  const lock = await readJson(lockPath, null)
  if (!lock || lock.scratch !== scratch) throw new HairnessError('checkout_not_owned', `Scratch ${scratch} does not own the ${target} checkout lock.`)
  const evidence = await inspectGit(lock.path)
  if (!evidence.clean) throw new HairnessError('checkout_dirty', 'Cleanup refuses a dirty checkout; preserve or commit the work explicitly.')
  if (lock.worktree) {
    const bindings = await targetBindings(home)
    const repository = bindings.targets[target]?.path
    if (!repository) throw new HairnessError('target_unbound', `Target ${target} is unbound.`)
    await git(['worktree', 'remove', lock.path], { cwd: repository })
    await git(['branch', '-d', lock.branch], { cwd: repository }).catch((error) => {
      throw new HairnessError('checkout_branch_unmerged', `Worktree was removed but branch ${lock.branch} was not safely deletable.`, { cause: error, exitCode: 5 })
    })
  }
  await rm(lockPath, { force: true })
  return { status: 'released', target, scratch, worktree: lock.worktree }
}

export async function runDeliveryGates(root, stage, context = {}) {
  if (!deliveryStages.includes(stage)) throw new HairnessError('gate_stage_invalid', `Unknown delivery stage: ${stage}.`)
  const home = await loadHome(root)
  const extensions = await activeExtensions(root, home)
  const gates = extensions.flatMap((extension) => extension.manifest.spec.gates.filter((gate) => gate.stage === stage).map((gate) => ({ ...gate, owner: extension.manifest.metadata.id })))
  return { stage, status: 'passed', gates: gates.map((gate) => ({ owner: gate.owner, id: gate.id, status: gate.adapter ? 'declared' : 'passed' })), contextDigest: digest(context) }
}

export async function preparePullRequest(root, options) {
  const artifact = await showArtifact(root, 'hairness/delivery', 'delivery-brief', options.brief)
  await validateDeliveryBrief(artifact.payload)
  const checkout = await inspectGit(options.checkout)
  const baseCommit = await git(['rev-parse', artifact.payload.base], { cwd: options.checkout })
  const files = (await git(['diff', '--name-only', `${baseCommit}...${checkout.head}`], { cwd: options.checkout })).split('\n').filter(Boolean)
  const drift = files.filter((file) => !artifact.payload.scope.some((scope) => file === scope || file.startsWith(`${scope.replace(/\/$/, '')}/`)))
  if (drift.length) throw new HairnessError('delivery_scope_drift', `Diff contains files outside the accepted DeliveryBrief: ${drift.join(', ')}.`, { exitCode: 5, details: { drift } })
  const missingChecks = artifact.payload.requiredChecks.filter((check) => options.checks?.[check] !== 'passed')
  if (missingChecks.length) throw new HairnessError('delivery_checks_missing', `Required checks have not passed: ${missingChecks.join(', ')}.`)
  const gates = await runDeliveryGates(root, 'before-publish-pr', { brief: artifact.payload, files, head: checkout.head })
  return prepareEffect(root, {
    operation: 'delivery.publish-pr',
    adapter: 'hairness/delivery:publish-pr',
    inputs: { title: options.title, body: options.body, base: artifact.payload.base, head: checkout.branch },
    evidence: { head: checkout.head, base: baseCommit, files, porcelain: checkout.porcelain },
    policy: { brief: options.brief, gates },
    target: { id: artifact.payload.target, head: checkout.head, base: baseCommit },
  })
}

export async function proveMerged(repository, evidence) {
  const currentHead = await git(['rev-parse', evidence.mergeCommit], { cwd: repository })
  if (currentHead !== evidence.mergeCommit) throw new HairnessError('merge_proof_invalid', 'Merge commit does not resolve exactly.')
  const ancestor = await git(['merge-base', '--is-ancestor', evidence.prHead, evidence.mergeCommit], { cwd: repository }).then(() => true).catch(() => false)
  if (!ancestor) throw new HairnessError('merge_proof_invalid', 'The PR head is not an ancestor of the claimed merge commit.')
  return { status: 'proved', prHead: evidence.prHead, mergeCommit: evidence.mergeCommit }
}

async function validateDeliveryBrief(value) {
  required(value.outcome, 'outcome')
  nonEmptyArray(value.acceptanceCriteria, 'acceptanceCriteria')
  nonEmptyArray(value.scope, 'scope')
  required(value.target, 'target')
  required(value.base, 'base')
  if (!Array.isArray(value.requiredChecks) || !Array.isArray(value.nonGoals)) throw new HairnessError('delivery_brief_invalid', 'DeliveryBrief lists are invalid.')
}

function required(value, name) {
  if (!String(value ?? '').trim()) throw new HairnessError('delivery_brief_invalid', `${name} is required.`)
  return value
}

function nonEmptyArray(value, name) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !String(item).trim())) throw new HairnessError('delivery_brief_invalid', `${name} must be a non-empty list.`)
  return value
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function checkoutLockPath(runtime, target, scratch) {
  return join(runtime.locks, `checkout-${slug(target)}-${slug(scratch)}.json`)
}

async function checkoutLocks(runtime, target) {
  const prefix = `checkout-${slug(target)}-`
  const names = (await readdir(runtime.locks).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
  return Promise.all(names.map((name) => readJson(join(runtime.locks, name))))
}
