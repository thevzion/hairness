import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, lstat, mkdir, readlink, realpath, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const exec = promisify(execFile)
const VERSION = '0.2.0-alpha.0'
const emptyState = () => ({ schemaVersion: 2, protocolVersion: '0.2', controller: null, controllerDraft: null, handles: [], leases: [], proposals: [], receipts: [], reconciliations: [], updatedAt: new Date().toISOString() })
const mutatingActions = new Set(['open', 'candidate-checkout', 'adopt', 'sync', 'handoff', 'takeover', 'close', 'repair', 'prune'])
const gitEffects = new Set(['git:worktree', 'git:branch', 'git:rebase', 'git:commit', 'git:push', 'git:tag'])
const actionEffects = {
  open: ['filesystem:write', 'git:worktree', 'git:branch'],
  'candidate-checkout': ['filesystem:write', 'git:worktree'],
  adopt: ['target-mutation'],
  sync: ['git:rebase'],
  handoff: ['filesystem:write'],
  takeover: ['filesystem:write'],
  close: ['filesystem:write', 'git:worktree', 'git:branch'],
  repair: ['filesystem:write', 'git:worktree'],
  prune: ['filesystem:write', 'git:worktree'],
}

const now = () => new Date().toISOString()
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
const digest = (value) => `sha256:${hash(value)}`
const slug = (value, fallback = 'worktree') => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || fallback
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

async function state(runtime) {
  const value = await runtime.overlay.read('state.json', emptyState())
  return { ...emptyState(), ...value, controller: value.controller ?? null, controllerDraft: value.controllerDraft ?? null }
}

async function save(runtime, value, event) {
  value.updatedAt = now()
  await runtime.contracts.validateSchema('./schemas/worktree-state.schema.json', value, 'Worktree state')
  await runtime.overlay.write('state.json', value)
  await runtime.overlay.append('events.jsonl', { at: value.updatedAt, ...event })
  return value
}

async function source(runtime, operation, input) {
  return runtime.extensions.call('hairness/sources', 'read', { source: 'git', operation, input }).then((value) => value.data)
}

async function effectivePolicy(root, runtime) {
  const distribution = await runtime.distribution.read()
  const preferences = await runtime.distribution.preferences()
  const configured = distribution.defaults?.worktrees ?? {}
  const value = {
    placement: configured.placement ?? 'anchor-sibling',
    directorySuffix: configured.directorySuffix ?? '-worktrees',
    layout: configured.layout ?? '{repository}/{type}/{slug}',
    enforcement: configured.enforcement ?? 'required',
    hooks: configured.hooks ?? 'required',
    cleanup: configured.cleanup ?? 'checkpoint',
    root: preferences.worktrees?.root ?? null,
    repositoryRoots: preferences.worktrees?.repositoryRoots ?? {},
  }
  if (value.placement !== 'anchor-sibling') throw new Error(`Unsupported worktree placement: ${value.placement}`)
  if (!/^-[a-z0-9][a-z0-9-]*$/.test(value.directorySuffix)) throw new Error('defaults.worktrees.directorySuffix must be a safe suffix.')
  if (!value.layout.includes('{repository}') || !value.layout.includes('{type}') || !value.layout.includes('{slug}')) throw new Error('defaults.worktrees.layout must include {repository}, {type} and {slug}.')
  if (!['required', 'optional'].includes(value.enforcement) || !['required', 'optional'].includes(value.hooks) || value.cleanup !== 'checkpoint') throw new Error('Invalid defaults.worktrees policy.')
  if (value.root && !isAbsolute(value.root)) value.root = resolve(root, value.root)
  if (!value.repositoryRoots || Array.isArray(value.repositoryRoots) || typeof value.repositoryRoots !== 'object') throw new Error('preferences.worktrees.repositoryRoots must be an object.')
  for (const [key, path] of Object.entries(value.repositoryRoots)) {
    if (key !== 'workspace' && !/^codebase:[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error(`Invalid worktree repository root key: ${key}`)
    if (typeof path !== 'string' || !path.trim()) throw new Error(`Invalid worktree repository root for ${key}.`)
    value.repositoryRoots[key] = isAbsolute(path) ? resolve(path) : resolve(root, path)
  }
  return { value, digest: digest(value) }
}

async function anchorObservation(root) {
  const overlayRoot = await realpath(join(root, '.overlay'))
  return { overlayRoot, anchorRoot: dirname(overlayRoot) }
}

function controllerMaterial(controller) {
  return controller ? { id: controller.id, anchorRoot: controller.anchorRoot, overlayRoot: controller.overlayRoot, poolRoot: controller.poolRoot } : null
}

function controllerRef(controller) {
  return controller ? { id: controller.id, digest: digest(controllerMaterial(controller)) } : null
}

function repositoryKey(ref) {
  return ref.kind === 'workspace' ? 'workspace' : `codebase:${ref.id}`
}

function repositorySegment(ref) {
  return ref.kind === 'workspace' ? 'workspace' : `codebases/${ref.id}`
}

function sameRepository(left, right) {
  return repositoryKey(left) === repositoryKey(right) && (left.checkout ?? 'default') === (right.checkout ?? 'default')
}

function logicalRepository(ref = { kind: 'workspace' }) {
  return ref.kind === 'codebase' ? { kind: 'codebase', id: ref.id, checkout: ref.checkout ?? 'default' } : { kind: 'workspace' }
}

function parseHairnessLock(reason) {
  const match = /^hairness:([^:]+):([^:]+):(.+)$/.exec(String(reason ?? ''))
  return match ? { controllerId: match[1], worktreeId: match[2], planId: match[3] } : null
}

function exactLockReason(controllerId, worktreeId, planId) {
  return `hairness:${controllerId}:${worktreeId}:${planId}`
}

async function observeController(root, runtime, value = null) {
  value ??= await state(runtime)
  const observed = await anchorObservation(root)
  const policy = await effectivePolicy(observed.anchorRoot, runtime)
  const desiredPoolRoot = policy.value.root ?? join(dirname(observed.anchorRoot), `${basename(observed.anchorRoot)}${policy.value.directorySuffix}`)
  if (!value.controller) return { status: 'uninitialized', controller: null, draft: value.controllerDraft, observed, desiredPoolRoot: resolve(desiredPoolRoot), policy, limits: ['controller-uninitialized'] }
  const controller = value.controller
  const limits = []
  if (resolve(controller.anchorRoot) !== resolve(observed.anchorRoot) || resolve(controller.overlayRoot) !== resolve(observed.overlayRoot)) limits.push('controller-relocation-required')
  if (resolve(controller.poolRoot) !== resolve(desiredPoolRoot)) limits.push('controller-pool-repair-required')
  return { status: limits.length ? 'blocked' : 'ready', controller, draft: value.controllerDraft, observed, desiredPoolRoot: resolve(desiredPoolRoot), policy, limits }
}

function ensureControllerDraft(value, observation) {
  if (value.controller) return value.controller
  if (!value.controllerDraft) {
    const at = now()
    value.controllerDraft = {
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: `controller-${randomUUID()}`,
      anchorRoot: observation.observed.anchorRoot,
      overlayRoot: observation.observed.overlayRoot,
      poolRoot: observation.desiredPoolRoot,
      state: 'pending',
      createdAt: at,
      updatedAt: at,
    }
  }
  return value.controllerDraft
}

async function currentSession(runtime, input = {}) {
  if (input.sessionId) return { id: input.sessionId, limits: [] }
  const flags = input.session ?? {}
  const session = await runtime.extensions.call('hairness/session-intelligence', 'current', flags).catch(() => null)
  if (session?.id) return { id: session.id, limits: session.limits ?? [] }
  const provider = process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_SESSION_ID
  return { id: provider ? `provider-${provider}` : 'session-unbound', limits: provider ? [] : ['provider-session-unbound'] }
}

async function repository(root, request, runtime, controllerObservation = null) {
  const ref = request.repository ?? { kind: 'workspace' }
  if (ref.kind === 'workspace') {
    const observed = controllerObservation ?? await observeController(root, runtime)
    return { ref: { kind: 'workspace' }, path: observed.observed.anchorRoot }
  }
  if (ref.kind !== 'codebase' || !ref.id) throw new Error('RepositoryRef must identify the workspace or a registered codebase.')
  const inspected = await runtime.extensions.call('hairness/codebase', 'inspect', { id: ref.id, checkout: ref.checkout ?? 'default' })
  if (!inspected?.mounted || !inspected.path) throw new Error(`Codebase is not mounted: ${ref.id}/${ref.checkout ?? 'default'}`)
  return { ref: { kind: 'codebase', id: ref.id, checkout: ref.checkout ?? 'default' }, path: await realpath(inspected.path) }
}

async function normalizeRequest(root, raw, runtime) {
  const session = await currentSession(runtime, raw)
  const controller = await observeController(root, runtime)
  const repo = await repository(root, raw, runtime, controller)
  const branch = raw.branch ?? null
  const inferred = branch?.split('/') ?? []
  const type = slug(raw.type ?? inferred[0] ?? (raw.mode === 'detached' ? 'candidate' : 'change'))
  const name = slug(raw.slug ?? inferred.slice(1).join('-') ?? raw.planId)
  const policy = raw.policyDigest ?? digest({ source: 'worktree-controls', planId: raw.planId })
  const value = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    repository: repo.ref,
    planId: String(raw.planId ?? '').trim(),
    sessionId: session.id,
    policyDigest: policy,
    ...(raw.worktreeId ? { worktreeId: raw.worktreeId } : {}),
    type,
    slug: name,
    branch,
    base: raw.base ?? 'main',
    mode: raw.mode ?? (raw.commit && !branch ? 'detached' : 'branch'),
    ...(raw.commit ? { commit: raw.commit } : {}),
    ...(raw.path ? { path: await realpath(raw.path).catch(() => resolve(raw.path)) } : {}),
    ...(raw.targetSessionId ? { targetSessionId: raw.targetSessionId } : {}),
    ...(raw.expectedHead ? { expectedHead: raw.expectedHead } : {}),
    ...(raw.remoteHead ? { remoteHead: raw.remoteHead } : {}),
    ...(raw.published !== undefined ? { published: Boolean(raw.published) } : {}),
    ...(raw.reason ? { reason: raw.reason } : {}),
    ...(raw.proof?.length ? { proof: [...new Set(raw.proof)] } : {}),
    ...(raw.bootstrap !== undefined ? { bootstrap: Boolean(raw.bootstrap) } : {}),
    ...(raw.controller !== undefined ? { controller: Boolean(raw.controller) } : {}),
  }
  if (!value.planId) throw new Error('CheckoutRequest requires planId.')
  if (value.mode === 'branch' && !value.branch && !value.worktreeId) throw new Error('A branch checkout requires branch.')
  if (value.mode === 'detached' && !value.commit && !value.worktreeId) throw new Error('A detached checkout requires commit.')
  await runtime.contracts.validateSchema('./schemas/checkout-request.schema.json', value, 'CheckoutRequest')
  return { value, sessionLimits: session.limits, repositoryPath: repo.path, controller }
}

async function inventory(repositoryPath, runtime) {
  const value = await source(runtime, 'worktrees', { path: repositoryPath })
  return {
    repositoryRoot: await realpath(value.repositoryRoot),
    commonDir: await realpath(value.commonDir),
    worktrees: await Promise.all(value.worktrees.map(async (entry) => ({ ...entry, path: await realpath(entry.path).catch(() => resolve(entry.path)) }))),
  }
}

function handleMaterial(handle) {
  return { id: handle.id, controllerRef: handle.controllerRef ?? null, repository: handle.repository, planId: handle.planId, kind: handle.kind, placement: handle.placement ?? 'external', path: handle.path, branch: handle.branch, base: handle.base, head: handle.head, detached: handle.detached, state: handle.state, cleanupProof: handle.cleanupProof ?? null, policyDigest: handle.policyDigest }
}

function leaseMaterial(lease) {
  return lease ? { id: lease.id, handleId: lease.handleId, planId: lease.planId, sessionId: lease.sessionId, mode: lease.mode, state: lease.state } : null
}

function activeLease(value, handleId) {
  return value.leases.findLast((item) => item.handleId === handleId && item.state === 'active') ?? null
}

async function placement(root, request, repositoryPath, runtime, controllerObservation = null) {
  const controller = controllerObservation ?? await observeController(root, runtime)
  const policy = controller.policy
  const evidence = await inventory(repositoryPath, runtime)
  const key = repositoryKey(request.repository)
  const specificRoot = policy.value.repositoryRoots[key] ?? null
  const placementRoot = specificRoot ?? policy.value.root ?? controller.controller?.poolRoot ?? controller.desiredPoolRoot
  const layout = specificRoot ? '{type}/{slug}' : policy.value.layout
  const suffix = layout.replaceAll('{repository}', repositorySegment(request.repository)).replaceAll('{type}', request.type).replaceAll('{slug}', request.slug)
  const path = resolve(placementRoot, suffix)
  if (relative(resolve(placementRoot), path).startsWith('..')) throw new Error('Configured worktree layout escapes its placement root.')
  return { policy, evidence, anchor: controller.observed.anchorRoot, controller, placementRoot: resolve(placementRoot), path, canonical: !request.path || resolve(request.path) === path }
}

function targetUri(evidence, id) {
  return `git-worktree://local/${hash(evidence.commonDir).slice(0, 16)}/${encodeURIComponent(id)}`
}

function codebaseTarget(request, id) {
  return request.repository.kind === 'codebase' ? `codebase://${request.repository.id}/checkouts/${encodeURIComponent(id)}` : null
}

function selectHandle(value, request) {
  if (request.worktreeId) return value.handles.find((item) => item.id === request.worktreeId) ?? null
  return value.handles.findLast((item) => item.planId === request.planId && item.state !== 'closed') ?? null
}

function unresolvedReceipt(value, handleId) {
  return value.receipts.findLast((item) => {
    if (item.context?.handleRef?.id !== handleId || !['partial', 'unknown'].includes(item.status)) return false
    return !value.reconciliations.some((reconciliation) => reconciliation.receiptId === item.id && ['safe-retry', 'observed-succeeded'].includes(reconciliation.decision))
  }) ?? null
}

async function liveResolution(root, request, runtime, value = null) {
  value ??= await state(runtime)
  const stored = selectHandle(value, request)
  if (!stored) return { status: 'missing', handle: null, lease: null, context: null, digest: null, limits: ['managed-handle-missing'] }
  const observedController = await observeController(root, runtime, value)
  const resolvedRepository = await repository(root, { repository: stored.repository }, runtime, observedController)
  const evidence = await inventory(resolvedRepository.path, runtime)
  const live = evidence.worktrees.find((item) => resolve(item.path) === resolve(stored.path)) ?? null
  const lease = activeLease(value, stored.id)
  const current = live ? { ...stored, head: live.head ?? null, branch: live.branch ?? null, detached: Boolean(live.detached) } : stored
  const currentDigest = digest(handleMaterial(current))
  const leaseDigest = lease ? digest(leaseMaterial(lease)) : null
  const limits = []
  let status = 'ready'
  if (!live) { status = 'orphaned'; limits.push('git-worktree-missing') }
  else if (live.prunable) { status = 'prunable'; limits.push(`prunable:${live.prunableReason ?? 'unknown'}`) }
  else if (live.moved) { status = 'blocked'; limits.push('worktree-moved') }
  else if (live.branch !== stored.branch || Boolean(live.detached) !== stored.detached) { status = 'stale'; limits.push('handle-branch-changed') }
  else if (!live.locked || live.lockReason !== exactLockReason(stored.controllerRef?.id, stored.id, stored.planId)) { status = 'blocked'; limits.push('managed-worktree-lock-missing-or-stale') }
  if (!stored.controllerRef || stored.controllerRef.id !== observedController.controller?.id) { status = 'blocked'; limits.push('controller-mismatch') }
  if (observedController.limits.length) { status = 'blocked'; limits.push(...observedController.limits) }
  if (stored.policyDigest !== request.policyDigest) { status = 'blocked'; limits.push('policy-digest-mismatch') }
  if (!lease || lease.state !== 'active') { status = status === 'ready' ? 'observer' : status; limits.push('writer-lease-missing') }
  else if (lease.planId !== request.planId) { status = 'blocked'; limits.push('writer-plan-mismatch') }
  const context = live ? {
    schemaVersion: 2,
    protocolVersion: '0.2',
    controllerRef: stored.controllerRef,
    repositoryRef: stored.repository,
    handleRef: { id: stored.id, digest: currentDigest },
    path: resolve(live.path),
    head: live.head ?? null,
    branch: live.branch ?? null,
    leaseRef: lease ? { id: lease.id, digest: leaseDigest } : null,
    policyDigest: stored.policyDigest,
  } : null
  if (context) await runtime.contracts.validateSchema('./schemas/checkout-context.schema.json', context, 'CheckoutContext')
  return { status, handle: current, lease, context, digest: currentDigest, limits, evidence }
}

async function assertWriter(root, input, runtime) {
  const normalized = await normalizeRequest(root, input, runtime)
  const resolved = await liveResolution(root, normalized.value, runtime)
  const limits = [...resolved.limits]
  if (resolved.handle && resolve(resolved.handle.path) === resolve(resolved.evidence.repositoryRoot)) limits.push('anchor-mutation-forbidden')
  if (resolved.handle && resolved.handle.state !== 'active' && resolved.handle.state !== 'cleanup-ready') limits.push(`handle-${resolved.handle.state}`)
  if (input.sessionId && resolved.lease?.sessionId !== normalized.value.sessionId) limits.push('writer-session-mismatch')
  if (resolved.status !== 'ready' || limits.length) throw new Error(`Managed writer lease is not valid: ${[...new Set(limits)].join(', ')}`)
  if (input.runId && input.effect && input.target) await runtime.authority.assert(input.runId, input.effect, input.target)
  return resolved
}

async function buildProposal(root, action, rawRequest, runtime, { persist = true } = {}) {
  if (!mutatingActions.has(action) && action !== 'reconcile') throw new Error(`Unknown worktree proposal action: ${action}`)
  const normalized = await normalizeRequest(root, rawRequest, runtime)
  const request = normalized.value
  const value = await state(runtime)
  let selectedController = normalized.controller.controller ?? ensureControllerDraft(value, normalized.controller)
  if (action === 'repair' && request.controller && normalized.controller.controller && normalized.controller.limits.length) {
    selectedController = { ...normalized.controller.controller, anchorRoot: normalized.controller.observed.anchorRoot, overlayRoot: normalized.controller.observed.overlayRoot, poolRoot: normalized.controller.desiredPoolRoot, state: 'active', updatedAt: now() }
  }
  const selectedControllerRef = controllerRef(selectedController)
  const placed = await placement(root, request, normalized.repositoryPath, runtime, { ...normalized.controller, controller: selectedController })
  const handle = selectHandle(value, request)
  const existingPath = request.path ?? handle?.path ?? placed.path
  const live = placed.evidence.worktrees.find((item) => resolve(item.path) === resolve(existingPath)) ?? null
  const foreignLock = live?.locked ? parseHairnessLock(live.lockReason) : null
  const handleDigest = handle ? digest(handleMaterial(handle)) : null
  const worktreeId = handle?.id ?? request.worktreeId ?? (action === 'takeover' ? foreignLock?.worktreeId : null) ?? `worktree-${hash({ repository: request.repository, planId: request.planId, path: existingPath }).slice(0, 16)}`
  request.worktreeId = worktreeId
  const limits = [...normalized.sessionLimits.filter((item) => item !== 'provider-session-unbound')]
  const proof = [`controller:${selectedController.id}`, `git:common-dir:${placed.evidence.commonDir}`, `git:repository-root:${placed.evidence.repositoryRoot}`, `worktree-policy:${placed.policy.digest}`]
  let idSeed = { action, request, worktreePolicy: placed.policy.digest, handleDigest, live: live ? { path: live.path, head: live.head, branch: live.branch, locked: live.locked, prunable: live.prunable } : null }
  let foreignTakeover = false

  if (normalized.controller.limits.length && action !== 'repair' && normalized.controller.status !== 'uninitialized') limits.push(...normalized.controller.limits)
  if (normalized.controller.status === 'uninitialized') proof.push('controller:initialize-on-checkpoint')

  if (action === 'open' || action === 'candidate-checkout') {
    if (handle) limits.push('plan-already-has-worktree')
    if (live) limits.push('placement-already-registered')
    if (placed.evidence.worktrees.some((item) => request.branch && item.branch === request.branch)) limits.push('branch-already-checked-out')
    if (action === 'candidate-checkout' && request.mode !== 'detached') limits.push('candidate-must-be-detached')
  } else if (action === 'adopt') {
    if (!request.path) limits.push('adoption-path-required')
    if (!live) limits.push('adoption-target-not-registered')
    if (resolve(existingPath) === resolve(placed.evidence.repositoryRoot)) limits.push('anchor-adoption-forbidden')
    if (handle && resolve(handle.path) !== resolve(existingPath)) limits.push('plan-already-has-different-worktree')
    const owner = value.handles.find((item) => item.state !== 'closed' && item.planId !== request.planId && resolve(item.path) === resolve(existingPath))
    if (owner) limits.push(`worktree-owned-by:${owner.planId}`)
    if (request.bootstrap) {
      const bootstrapLock = parseHairnessLock(live?.lockReason)
      const legacyBootstrapLock = live?.lockReason === `hairness:${request.planId}` || String(live?.lockReason ?? '').endsWith(`:${request.planId}`)
      if (!live?.locked || (!legacyBootstrapLock && bootstrapLock?.planId !== request.planId)) limits.push('bootstrap-lock-does-not-match-plan')
      proof.push('bootstrap:explicit-target-mutation-compatibility')
    } else if (live?.locked && live.lockReason && live.lockReason !== exactLockReason(selectedController.id, request.worktreeId, request.planId)) limits.push('worktree-locked-elsewhere')
  } else if (action === 'prune') {
    if (!live?.prunable) limits.push('entry-is-not-prunable')
    if (placed.evidence.worktrees.filter((item) => item.prunable).length !== 1) limits.push('prune-would-affect-multiple-entries')
  } else {
    foreignTakeover = Boolean(action === 'takeover' && !handle && foreignLock && foreignLock.controllerId !== selectedController.id)
    if (!handle && !(action === 'repair' && request.controller) && !foreignTakeover) limits.push('managed-handle-missing')
    if (!live && action !== 'repair') limits.push('git-worktree-missing')
    const lease = handle ? activeLease(value, handle.id) : null
    if (!lease && !['takeover', 'repair'].includes(action)) limits.push('writer-lease-missing')
    if (lease && lease.sessionId !== request.sessionId && !['takeover', 'repair'].includes(action)) limits.push('writer-session-mismatch')
    if (request.expectedHead && live?.head !== request.expectedHead) limits.push('expected-head-mismatch')
    if (action === 'sync' && (handle?.detached || !handle?.branch)) limits.push('detached-worktree-cannot-sync')
    if (action === 'sync' && request.published && !request.remoteHead) limits.push('force-with-lease-requires-remote-head')
    if (action === 'handoff' && (!request.targetSessionId || request.targetSessionId === request.sessionId)) limits.push('distinct-target-session-required')
    if (action === 'takeover' && (!request.reason || !(request.proof ?? []).some((item) => item.includes('stale') || item.includes('controller-unavailable')))) limits.push('takeover-requires-stale-proof-and-reason')
    if (foreignTakeover) {
      if (foreignLock.planId !== request.planId) limits.push('foreign-plan-mismatch')
      if (!(request.proof ?? []).includes(`controller-unavailable:${foreignLock.controllerId}`)) limits.push('foreign-controller-proof-missing')
      proof.push(`foreign-controller:${foreignLock.controllerId}`, `foreign-lock:${live.lockReason}`)
    }
    if (action === 'close' && handle) {
      if (handle.state !== 'cleanup-ready') limits.push('cleanup-not-ready')
      if (!handle.cleanupProof) limits.push('cleanup-proof-missing')
      else {
        const maxAge = Number(handle.cleanupProof.maxAgeMinutes ?? 30)
        if (Date.now() - Date.parse(handle.cleanupProof.observedAt) > maxAge * 60_000) limits.push('cleanup-proof-stale')
        request.proof = [...new Set([...(request.proof ?? []), ...(handle.cleanupProof.proof ?? [])])]
      }
    }
  }

  const unresolved = handle ? unresolvedReceipt(value, handle.id) : null
  if (unresolved && !['repair', 'reconcile'].includes(action)) limits.push(`reconciliation-required:${unresolved.id}`)
  const effects = action === 'adopt' && !request.bootstrap ? ['filesystem:write', 'git:worktree'] : [...(actionEffects[action] ?? [])]
  if (foreignTakeover && !effects.includes('git:worktree')) effects.push('git:worktree')
  if (normalized.controller.status === 'uninitialized' && !effects.includes('filesystem:write')) effects.unshift('filesystem:write')
  if (action === 'sync' && request.published) effects.push('git:push')
  const targets = [targetUri(placed.evidence, worktreeId), resolve(existingPath)]
  const mountTarget = codebaseTarget(request, worktreeId)
  if (mountTarget) targets.push(mountTarget)
  const proposal = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `checkout-proposal-${hash({ ...idSeed, targets, effects, proof, limits }).slice(0, 20)}`,
    action,
    request: { ...request, worktreeId },
    requestDigest: digest(request),
    policyDigest: request.policyDigest,
    controllerRef: selectedControllerRef,
    handleDigest,
    targets: [...new Set(targets)],
    effects,
    proof,
    limits: [...new Set(limits)],
    createdAt: now(),
  }
  await runtime.contracts.validateSchema('./schemas/checkout-proposal.schema.json', proposal, 'CheckoutProposal')
  if (persist) {
    const existing = value.proposals.find((item) => item.id === proposal.id)
    if (!existing) { value.proposals.push(proposal); await save(runtime, value, { type: 'worktree.proposed', proposalId: proposal.id, action }) }
    else proposal.createdAt = existing.createdAt
  }
  return proposal
}

async function buildCloseBatchProposal(root, rawRequest, runtime, { persist = true } = {}) {
  const value = await state(runtime)
  const requestedRepository = rawRequest.repository ? logicalRepository(rawRequest.repository) : null
  const handles = value.handles.filter((item) => item.state === 'cleanup-ready' && (!requestedRepository || sameRepository(item.repository, requestedRepository)))
  const items = []
  const limits = []
  for (const handle of handles) {
    const lease = activeLease(value, handle.id)
    if (!lease) { limits.push(`${handle.id}:writer-lease-missing`); continue }
    try {
      const item = await buildProposal(root, 'close', {
        repository: logicalRepository(handle.repository),
        planId: handle.planId,
        sessionId: lease.sessionId,
        policyDigest: handle.policyDigest,
        worktreeId: handle.id,
        branch: handle.branch,
        base: handle.base,
        mode: handle.detached ? 'detached' : 'branch',
        ...(handle.detached ? { commit: handle.head } : {}),
        expectedHead: handle.head,
        proof: handle.cleanupProof?.proof ?? [],
      }, runtime, { persist: false })
      items.push(item)
      limits.push(...item.limits.map((limit) => `${handle.id}:${limit}`))
    } catch (error) {
      limits.push(`${handle.id}:${error.message}`)
    }
  }
  if (!handles.length) limits.push('no-cleanup-ready-worktrees')
  const observedController = await observeController(root, runtime, value)
  const selectedController = observedController.controller ?? ensureControllerDraft(value, observedController)
  const request = { allReady: true, ...(requestedRepository ? { repository: requestedRepository } : {}), handleIds: handles.map((item) => item.id) }
  const targets = [...new Set(items.flatMap((item) => item.targets))]
  const effects = [...new Set(items.flatMap((item) => item.effects))]
  const proof = [...new Set(items.flatMap((item) => item.proof))]
  const policyDigest = digest(items.map((item) => item.policyDigest))
  const proposal = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `checkout-proposal-${hash({ action: 'close-batch', request, items: items.map((item) => item.id), targets, effects, limits }).slice(0, 20)}`,
    action: 'close-batch',
    request,
    requestDigest: digest(request),
    policyDigest,
    controllerRef: controllerRef(selectedController),
    handleDigest: null,
    targets,
    effects,
    proof,
    limits: [...new Set(limits)],
    createdAt: now(),
    items,
  }
  await runtime.contracts.validateSchema('./schemas/checkout-proposal.schema.json', proposal, 'CheckoutProposal')
  if (persist) {
    const existing = value.proposals.find((item) => item.id === proposal.id)
    if (!existing) { value.proposals.push(proposal); await save(runtime, value, { type: 'worktree.proposed', proposalId: proposal.id, action: proposal.action }) }
    else proposal.createdAt = existing.createdAt
  }
  return proposal
}

async function git(path, args, options = {}) {
  return exec('git', ['-C', path, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options })
}

async function ensureOverlayLink(root, handle, evidence) {
  if (handle.repository.kind !== 'workspace') return []
  const target = join(handle.path, '.overlay')
  const anchorOverlay = await realpath(join(root, '.overlay'))
  const prior = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (prior) {
    if (!prior.isSymbolicLink()) return ['overlay-entry-preexisting']
    const linked = resolve(dirname(target), await readlink(target))
    return (await realpath(linked)) === anchorOverlay ? [] : ['overlay-link-points-elsewhere']
  }
  try { await git(handle.path, ['check-ignore', '-q', '.overlay']) }
  catch { return ['overlay-not-ignored'] }
  await symlink(anchorOverlay, target, 'dir')
  return []
}

async function installGuards(root, handle, evidence) {
  const configured = await git(handle.path, ['config', '--get', 'core.hooksPath']).then(({ stdout }) => stdout.trim()).catch(() => '')
  const anchorOverlay = await realpath(join(root, '.overlay'))
  const stableRoot = dirname(anchorOverlay)
  const hooks = join(anchorOverlay, 'extensions-state', 'hairness', 'worktree-controls', 'hooks')
  if (configured && resolve(evidence.repositoryRoot, configured) !== hooks) return ['hook-integration-required']
  await mkdir(hooks, { recursive: true })
  const selectRoot = `stable_root=${shellQuote(stableRoot)}\nbootstrap_root=${shellQuote(root)}\nif grep -q '\"id\": \"hairness/worktree-controls\"' \"$stable_root/hairness.json\" 2>/dev/null; then\n  hairness_root=\"$stable_root\"\nelse\n  hairness_root=\"$bootstrap_root\"\nfi\n`
  const guard = 'exec env HAIRNESS_ROOT="$hairness_root" node "$hairness_root/bin/hairness.mjs" worktree guard --path "$(git rev-parse --show-toplevel)"'
  const preCommit = `#!/bin/sh\n${selectRoot}${guard} --event pre-commit\n`
  const prePush = `#!/bin/sh\nwhile read local_ref local_sha remote_ref remote_sha; do\n  if [ \"$remote_ref\" = \"refs/heads/main\" ]; then\n    echo \"Hairness refuses direct pushes to main.\" >&2\n    exit 1\n  fi\ndone\n${selectRoot}${guard} --event pre-push\n`
  await writeFile(join(hooks, 'pre-commit'), preCommit, { mode: 0o700 })
  await writeFile(join(hooks, 'pre-push'), prePush, { mode: 0o700 })
  await chmod(join(hooks, 'pre-commit'), 0o700)
  await chmod(join(hooks, 'pre-push'), 0o700)
  if (!configured) await git(handle.path, ['config', 'core.hooksPath', hooks])
  return []
}

function newLease(handle, sessionId, previous = null, reason = null) {
  const at = now()
  return { schemaVersion: 2, protocolVersion: '0.2', id: `lease-${hash({ handle: handle.id, sessionId, previous: previous?.id ?? null, at }).slice(0, 18)}`, handleId: handle.id, planId: handle.planId, sessionId, mode: 'writer', state: 'active', previousLeaseId: previous?.id ?? null, reason, acquiredAt: at, updatedAt: at }
}

async function validateHandle(runtime, handle) {
  await runtime.contracts.validateSchema('./schemas/repository-ref.schema.json', handle.repository, 'RepositoryRef')
  return runtime.contracts.validateSchema('./schemas/worktree-handle.schema.json', handle, 'WorktreeHandle')
}

async function validateController(runtime, controller) {
  return runtime.contracts.validateSchema('./schemas/worktree-controller.schema.json', controller, 'WorktreeController')
}

async function validateLease(runtime, lease) {
  return runtime.contracts.validateSchema('./schemas/worktree-lease.schema.json', lease, 'WorktreeLease')
}

async function makeContext(runtime, handle, lease) {
  const context = { schemaVersion: 2, protocolVersion: '0.2', controllerRef: handle.controllerRef, repositoryRef: handle.repository, handleRef: { id: handle.id, digest: digest(handleMaterial(handle)) }, path: handle.path, head: handle.head, branch: handle.branch, leaseRef: lease ? { id: lease.id, digest: digest(leaseMaterial(lease)) } : null, policyDigest: handle.policyDigest }
  await runtime.contracts.validateSchema('./schemas/checkout-context.schema.json', context, 'CheckoutContext')
  return context
}

async function receipt(runtime, value, proposal, input, status, summary, context, proof, limits = []) {
  const observedAt = now()
  const document = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `checkout-receipt-${hash({ proposal: proposal.id, run: input.runId, checkpoint: input.checkpointId, status, proof }).slice(0, 20)}`,
    proposalId: proposal.id,
    action: proposal.action,
    runId: input.runId,
    checkpointId: input.checkpointId,
    status,
    summary,
    targets: proposal.targets,
    effects: proposal.effects,
    proof,
    head: context?.head ?? null,
    policyDigest: proposal.policyDigest,
    controllerRef: proposal.controllerRef,
    observedAt,
    limits,
    context,
  }
  await runtime.contracts.validateSchema('./schemas/checkout-receipt.schema.json', document, 'CheckoutReceipt')
  value.receipts.push(document)
  await save(runtime, value, { type: 'worktree.received', receiptId: document.id, action: proposal.action, status })
  return document
}

async function authorize(proposal, runId, runtime) {
  for (const effect of proposal.effects) {
    const target = effect === 'target-mutation' || effect === 'filesystem:write' ? proposal.targets.find((item) => !item.includes('://')) : proposal.targets[0]
    await runtime.authority.assert(runId, effect, target)
  }
}

async function executeProposal(root, input, runtime) {
  if (!input.runId || !input.checkpointId) throw new Error('Worktree execution requires runId and checkpointId.')
  const value = await state(runtime)
  const selected = typeof input.proposal === 'string' ? value.proposals.find((item) => item.id === input.proposal) : input.proposal
  if (!selected) throw new Error('CheckoutProposal not found.')
  if (selected.action === 'close-batch') return executeCloseBatchProposal(root, input, selected, runtime)
  if (selected.limits.length) throw new Error(`CheckoutProposal is blocked: ${selected.limits.join(', ')}`)
  const fresh = await buildProposal(root, selected.action, selected.request, runtime, { persist: false })
  if (fresh.id !== selected.id || fresh.requestDigest !== selected.requestDigest || fresh.handleDigest !== selected.handleDigest || fresh.policyDigest !== selected.policyDigest) throw new Error('CheckoutProposal is stale; observe and propose again.')
  await authorize(selected, input.runId, runtime)
  const request = selected.request
  let activeController = value.controller
  if (!activeController) {
    const draft = value.controllerDraft
    if (!draft || selected.controllerRef?.id !== draft.id) throw new Error('Controller proposal is missing or stale.')
    activeController = { ...draft, state: 'active', updatedAt: now() }
    await validateController(runtime, activeController)
    value.controller = activeController
    value.controllerDraft = null
  }
  if (request.controller && activeController && selected.controllerRef?.digest !== controllerRef(activeController).digest) {
    const observed = await anchorObservation(root)
    const policy = await effectivePolicy(observed.anchorRoot, runtime)
    activeController = { ...activeController, anchorRoot: observed.anchorRoot, overlayRoot: observed.overlayRoot, poolRoot: policy.value.root ?? join(dirname(observed.anchorRoot), `${basename(observed.anchorRoot)}${policy.value.directorySuffix}`), state: 'active', updatedAt: now() }
    await validateController(runtime, activeController)
    value.controller = activeController
  }
  const currentControllerRef = controllerRef(activeController)
  if (selected.controllerRef?.id !== currentControllerRef.id) throw new Error('CheckoutProposal controller no longer matches the active controller.')
  const resolvedRepository = await repository(root, request, runtime, await observeController(root, runtime, value))
  const repositoryPath = resolvedRepository.path
  const evidence = await inventory(repositoryPath, runtime)
  const targetPath = selected.targets.find((item) => !item.includes('://'))
  let started = false
  let context = null
  let effectProof = [...selected.proof]
  let limits = []
  try {
    if (selected.action === 'open' || selected.action === 'candidate-checkout') {
      started = true
      const reason = exactLockReason(activeController.id, request.worktreeId, request.planId)
      if (selected.action === 'candidate-checkout') await git(repositoryPath, ['worktree', 'add', '--detach', '--lock', '--reason', reason, targetPath, request.commit])
      else await git(repositoryPath, ['worktree', 'add', '--lock', '--reason', reason, '-b', request.branch, targetPath, request.base])
      const refs = await source(runtime, 'refs', { path: targetPath })
      const handle = { schemaVersion: 2, protocolVersion: '0.2', id: request.worktreeId, controllerRef: currentControllerRef, repository: request.repository, planId: request.planId, kind: selected.action === 'candidate-checkout' ? 'candidate' : 'branch', placement: 'canonical', path: targetPath, branch: selected.action === 'candidate-checkout' ? null : request.branch, base: request.base, head: refs.head, detached: selected.action === 'candidate-checkout', state: 'active', policyDigest: request.policyDigest, createdAt: now(), updatedAt: now() }
      await validateHandle(runtime, handle)
      const lease = newLease(handle, request.sessionId)
      await validateLease(runtime, lease)
      value.handles.push(handle); value.leases.push(lease)
      if (request.repository.kind === 'codebase') await runtime.extensions.call('hairness/codebase', 'mount-managed', { runId: input.runId, effect: 'filesystem:write', target: codebaseTarget(request, handle.id), codebaseId: request.repository.id, checkout: handle.id, path: handle.path })
      limits.push(...await ensureOverlayLink(root, handle, evidence))
      limits.push(...await installGuards(root, handle, evidence))
      context = await makeContext(runtime, handle, lease)
      effectProof.push(`git:worktree:${handle.path}`, `git:head:${handle.head}`, `lease:${lease.id}`)
    } else if (selected.action === 'adopt') {
      started = true
      const live = evidence.worktrees.find((item) => resolve(item.path) === resolve(targetPath))
      const handle = value.handles.find((item) => item.id === request.worktreeId) ?? { schemaVersion: 2, protocolVersion: '0.2', id: request.worktreeId, controllerRef: currentControllerRef, repository: request.repository, planId: request.planId, kind: live.detached ? 'candidate' : 'branch', placement: resolve(targetPath) === resolve((await placement(root, request, repositoryPath, runtime, await observeController(root, runtime, value))).path) ? 'canonical' : 'external', path: targetPath, branch: live.branch ?? null, base: request.base, head: live.head ?? null, detached: Boolean(live.detached), state: 'active', policyDigest: request.policyDigest, createdAt: now(), updatedAt: now() }
      handle.controllerRef = currentControllerRef
      handle.repository = request.repository
      handle.placement ??= 'external'
      const expectedReason = exactLockReason(activeController.id, handle.id, request.planId)
      if (live.locked && live.lockReason !== expectedReason) await git(repositoryPath, ['worktree', 'unlock', targetPath])
      if (!live.locked || live.lockReason !== expectedReason) await git(repositoryPath, ['worktree', 'lock', '--reason', expectedReason, targetPath])
      await validateHandle(runtime, handle)
      let lease = activeLease(value, handle.id)
      if (!value.handles.some((item) => item.id === handle.id)) value.handles.push(handle)
      if (!lease) { lease = newLease(handle, request.sessionId); await validateLease(runtime, lease); value.leases.push(lease) }
      limits.push(...await ensureOverlayLink(root, handle, evidence))
      limits.push(...await installGuards(root, handle, evidence))
      context = await makeContext(runtime, handle, lease)
      effectProof.push(`git:worktree-adopted:${handle.path}`, `lease:${lease.id}`)
    } else if (selected.action === 'sync') {
      const resolved = await assertWriter(root, { ...request, runId: input.runId, effect: 'git:rebase', target: selected.targets[0] }, runtime)
      started = true
      await git(resolved.handle.path, ['rebase', `origin/${resolved.handle.base}`])
      if (request.published) await git(resolved.handle.path, ['push', `--force-with-lease=refs/heads/${resolved.handle.branch}:${request.remoteHead}`, 'origin', `HEAD:refs/heads/${resolved.handle.branch}`])
      const refs = await source(runtime, 'refs', { path: resolved.handle.path })
      const stored = value.handles.find((item) => item.id === resolved.handle.id)
      stored.head = refs.head; stored.updatedAt = now(); stored.state = 'active'
      context = await makeContext(runtime, stored, resolved.lease)
      effectProof.push(`git:rebased:${resolved.handle.base}`, `git:head:${stored.head}`)
    } else if (selected.action === 'handoff' || selected.action === 'takeover') {
      let handle = value.handles.find((item) => item.id === request.worktreeId)
      let prior = handle ? activeLease(value, handle.id) : null
      if (selected.action === 'takeover' && !handle) {
        const live = evidence.worktrees.find((item) => resolve(item.path) === resolve(targetPath))
        const foreignLock = parseHairnessLock(live?.lockReason)
        if (!foreignLock || foreignLock.controllerId === activeController.id) throw new Error('Foreign takeover target is not controlled by another Hairness controller.')
        const expectedProof = `controller-unavailable:${foreignLock.controllerId}`
        if (!(request.proof ?? []).includes(expectedProof)) throw new Error('Foreign takeover requires exact controller-unavailable proof.')
        started = true
        await git(repositoryPath, ['worktree', 'unlock', targetPath])
        await git(repositoryPath, ['worktree', 'lock', '--reason', exactLockReason(activeController.id, foreignLock.worktreeId, foreignLock.planId), targetPath])
        handle = { schemaVersion: 2, protocolVersion: '0.2', id: foreignLock.worktreeId, controllerRef: currentControllerRef, previousControllerId: foreignLock.controllerId, repository: request.repository, planId: foreignLock.planId, kind: live.detached ? 'candidate' : 'branch', placement: 'external', path: targetPath, branch: live.branch ?? null, base: request.base, head: live.head ?? null, detached: Boolean(live.detached), state: 'active', cleanupProof: null, policyDigest: request.policyDigest, createdAt: now(), updatedAt: now() }
        await validateHandle(runtime, handle)
        value.handles.push(handle)
      }
      if (!handle) throw new Error('Managed takeover handle is missing.')
      if (selected.action === 'handoff' && prior?.sessionId !== request.sessionId) throw new Error('Only the active writer can hand off its lease.')
      started = true
      if (prior) { prior.state = 'released'; prior.updatedAt = now() }
      const next = newLease(handle, selected.action === 'handoff' ? request.targetSessionId : request.sessionId, prior, request.reason ?? selected.action)
      await validateLease(runtime, next); value.leases.push(next)
      context = await makeContext(runtime, handle, next)
      if (prior) effectProof.push(`lease:${prior.id}:released`)
      effectProof.push(`lease:${next.id}:active`)
    } else if (selected.action === 'close') {
      const resolved = await assertWriter(root, { ...request, runId: input.runId, effect: 'git:worktree', target: selected.targets[0] }, runtime)
      const status = await source(runtime, 'status', { path: resolved.handle.path })
      if ((status.dirty ?? 0) > 0) throw new Error('Cleanup refused: worktree is dirty.')
      if ((status.ahead ?? 0) > 0) throw new Error('Cleanup refused: worktree has unpushed commits.')
      started = true
      const integration = resolved.handle.detached ? { isIntegrated: true } : await source(runtime, 'merge-proof', { path: resolved.handle.path, head: resolved.handle.head, base: `origin/${resolved.handle.base}` })
      const squashProof = !resolved.handle.detached && !integration.isIntegrated && (request.proof ?? []).includes('github:pr-merged') && (request.proof ?? []).includes(`published-head:${resolved.handle.head}`) && (request.proof ?? []).some((item) => item.startsWith('verify-main:'))
      if (!resolved.handle.detached && !integration.isIntegrated && !squashProof) throw new Error('Cleanup refused: branch lacks fresh integration or squash-merge proof.')
      await git(repositoryPath, ['worktree', 'unlock', resolved.handle.path]).catch(() => null)
      await git(repositoryPath, ['worktree', 'remove', resolved.handle.path])
      if (resolved.handle.branch) await git(repositoryPath, ['branch', integration.isIntegrated ? '-d' : '-D', resolved.handle.branch])
      const stored = value.handles.find((item) => item.id === resolved.handle.id)
      stored.state = 'closed'; stored.cleanupProof = null; stored.updatedAt = now()
      const lease = activeLease(value, stored.id); lease.state = 'released'; lease.updatedAt = now()
      if (request.repository.kind === 'codebase') await runtime.extensions.call('hairness/codebase', 'unmount-managed', { runId: input.runId, effect: 'filesystem:write', target: codebaseTarget(request, stored.id), codebaseId: request.repository.id, checkout: stored.id })
      effectProof.push(`git:worktree-removed:${stored.path}`)
    } else if (selected.action === 'repair') {
      started = true
      await git(repositoryPath, ['worktree', 'repair', targetPath])
      const handle = value.handles.find((item) => item.id === request.worktreeId)
      if (handle) {
        handle.repository = request.repository
        handle.controllerRef = currentControllerRef
        handle.path = targetPath
        handle.placement ??= 'external'
        await validateHandle(runtime, handle)
        const liveBefore = evidence.worktrees.find((item) => resolve(item.path) === resolve(targetPath))
        const expectedReason = exactLockReason(activeController.id, handle.id, handle.planId)
        if (liveBefore?.locked && liveBefore.lockReason !== expectedReason) await git(repositoryPath, ['worktree', 'unlock', handle.path])
        if (!liveBefore?.locked || liveBefore.lockReason !== expectedReason) await git(repositoryPath, ['worktree', 'lock', '--reason', expectedReason, handle.path])
        limits.push(...await ensureOverlayLink(root, handle, evidence))
        limits.push(...await installGuards(root, handle, evidence))
        const live = (await inventory(repositoryPath, runtime)).worktrees.find((item) => resolve(item.path) === resolve(handle.path))
        if (live) { handle.head = live.head; handle.branch = live.branch; handle.detached = live.detached; handle.state = 'active'; handle.updatedAt = now(); context = await makeContext(runtime, handle, activeLease(value, handle.id)) }
      }
      effectProof.push(`git:worktree-repaired:${targetPath}`)
    } else if (selected.action === 'prune') {
      started = true
      await git(repositoryPath, ['worktree', 'prune', '--expire', 'now'])
      effectProof.push(`git:worktree-pruned:${targetPath}`)
    }
    const document = await receipt(runtime, value, selected, input, 'succeeded', `${selected.action} completed for ${request.worktreeId}.`, context, effectProof, limits)
    return { ...document, checkoutContext: context }
  } catch (error) {
    const status = started ? 'unknown' : 'failed'
    const document = await receipt(runtime, value, selected, input, status, `${selected.action} did not complete: ${error.message}`, context, [...effectProof, `error:${error.message}`], [started ? 'reconciliation-required-before-retry' : 'no-effect-observed'])
    return { ...document, checkoutContext: context }
  }
}

async function executeCloseBatchProposal(root, input, selected, runtime) {
  const fresh = await buildCloseBatchProposal(root, selected.request, runtime, { persist: false })
  if (fresh.id !== selected.id || fresh.requestDigest !== selected.requestDigest || fresh.policyDigest !== selected.policyDigest) throw new Error('Batch cleanup proposal is stale; observe all targets again.')
  if (fresh.limits.length) throw new Error(`Batch cleanup proposal is blocked: ${fresh.limits.join(', ')}`)
  const children = []
  for (const item of selected.items) {
    const child = await executeProposal(root, { proposal: item, runId: input.runId, checkpointId: input.checkpointId }, runtime)
    children.push(child)
    if (child.status !== 'succeeded') break
  }
  const succeeded = children.filter((item) => item.status === 'succeeded').length
  const uncertain = children.some((item) => ['partial', 'unknown'].includes(item.status))
  const status = succeeded === selected.items.length ? 'succeeded' : succeeded ? 'partial' : uncertain ? 'unknown' : 'failed'
  const value = await state(runtime)
  const limits = status === 'succeeded' ? [] : ['batch-cleanup-reconciliation-required']
  const document = await receipt(runtime, value, selected, input, status, status === 'succeeded' ? `Closed ${succeeded} cleanup-ready worktree(s).` : `Batch cleanup stopped after ${children.length} of ${selected.items.length} child receipt(s).`, null, [...selected.proof, ...children.map((item) => `child-receipt:${item.id}:${item.status}`)], limits)
  return { ...document, children }
}

async function inspect(root, input, runtime) {
  const value = await state(runtime)
  const controller = await observeController(root, runtime, value)
  const refs = []
  if (input?.repository) refs.push(logicalRepository(input.repository))
  else {
    refs.push({ kind: 'workspace' })
    const listed = await runtime.extensions.call('hairness/codebase', 'list', { mountedOnly: true }).catch(() => ({ codebases: [] }))
    for (const codebase of listed.codebases ?? []) if (codebase.mounted && codebase.checkout === 'default') refs.push({ kind: 'codebase', id: codebase.id, checkout: codebase.checkout })
    for (const handle of value.handles) refs.push(logicalRepository(handle.repository))
  }
  const uniqueRefs = [...new Map(refs.map((ref) => [`${repositoryKey(ref)}:${ref.checkout ?? 'default'}`, ref])).values()]
  const repositories = []
  const discovered = []
  const seenHandles = new Set()

  for (const ref of uniqueRefs) {
    try {
      const resolvedRepository = await repository(root, { repository: ref }, runtime, controller)
      const evidence = await inventory(resolvedRepository.path, runtime)
      const entries = evidence.worktrees.map((entry) => {
        const handle = value.handles.findLast((item) => item.state !== 'closed' && sameRepository(logicalRepository(item.repository), ref) && resolve(item.path) === resolve(entry.path))
        const lease = handle ? activeLease(value, handle.id) : null
        const lock = parseHairnessLock(entry.lockReason)
        let classification = 'unmanaged'
        if (entry.prunable) classification = 'prunable'
        else if (resolve(entry.path) === resolve(evidence.repositoryRoot)) classification = 'anchor'
        else if (handle) {
          seenHandles.add(handle.id)
          const expected = exactLockReason(handle.controllerRef?.id, handle.id, handle.planId)
          classification = handle.placement === 'external' ? 'managed-external' : 'managed'
          if (!lease || entry.moved || !entry.locked || entry.lockReason !== expected || handle.controllerRef?.id !== controller.controller?.id) classification = 'blocked'
        } else if (lock) classification = lock.controllerId === controller.controller?.id ? 'orphaned' : 'foreign-managed'
        return { ...entry, repositoryRef: ref, classification, controllerId: handle?.controllerRef?.id ?? lock?.controllerId ?? null, handleId: handle?.id ?? lock?.worktreeId ?? null, planId: handle?.planId ?? lock?.planId ?? null, writerSessionId: lease?.sessionId ?? null }
      })
      discovered.push(...entries)
      repositories.push({ repositoryRef: ref, status: entries.some((item) => ['blocked', 'orphaned'].includes(item.classification)) ? 'blocked' : 'ready', repositoryRoot: evidence.repositoryRoot, commonDir: evidence.commonDir, worktrees: entries, limits: [] })
    } catch (error) {
      repositories.push({ repositoryRef: ref, status: 'blocked', repositoryRoot: null, commonDir: null, worktrees: [], limits: [error.message] })
    }
  }

  for (const handle of value.handles.filter((item) => item.state !== 'closed' && !seenHandles.has(item.id))) {
    const item = { repositoryRef: logicalRepository(handle.repository), path: handle.path, head: handle.head, branch: handle.branch, detached: handle.detached, locked: false, lockReason: null, prunable: false, prunableReason: null, moved: false, classification: 'orphaned', controllerId: handle.controllerRef?.id ?? null, handleId: handle.id, planId: handle.planId, writerSessionId: activeLease(value, handle.id)?.sessionId ?? null }
    discovered.push(item)
    const group = repositories.find((candidate) => sameRepository(candidate.repositoryRef, item.repositoryRef))
    if (group) { group.worktrees.push(item); group.status = 'blocked' }
  }

  const limits = [...controller.limits, ...repositories.flatMap((item) => item.limits.map((limit) => `${repositoryKey(item.repositoryRef)}:${limit}`))]
  const status = limits.length || discovered.some((item) => ['blocked', 'orphaned'].includes(item.classification)) ? 'blocked' : 'ready'
  const routes = []
  if (controller.status === 'uninitialized') routes.push('hairness worktree repair --controller')
  if (controller.limits.includes('controller-relocation-required') || controller.limits.includes('controller-pool-repair-required')) routes.push('hairness worktree repair --controller')
  if (discovered.some((item) => item.classification === 'prunable')) routes.push('hairness worktree doctor')
  const workspace = repositories.find((item) => item.repositoryRef.kind === 'workspace')
  return { schemaVersion: 2, protocolVersion: '0.2', status, controller: controller.controller ? { ...controller.controller, digest: digest(controllerMaterial(controller.controller)) } : null, repositoryRoot: workspace?.repositoryRoot ?? null, commonDir: workspace?.commonDir ?? null, repositories, worktrees: discovered, handles: value.handles, leases: value.leases.filter((item) => item.state === 'active'), limits: [...new Set(limits)], routes: [...new Set(routes)] }
}

async function reconcile(root, input, runtime) {
  const value = await state(runtime)
  const normalized = await normalizeRequest(root, input, runtime)
  const request = normalized.value
  const handle = selectHandle(value, request)
  const unresolved = handle ? unresolvedReceipt(value, handle.id) : null
  if (!unresolved) return { status: 'ready', summary: 'No unresolved worktree effect.', limits: [], routes: [] }
  const live = (await inventory(normalized.repositoryPath, runtime)).worktrees.find((item) => resolve(item.path) === resolve(handle.path)) ?? null
  const proof = [...new Set(request.proof ?? [])]
  if (!request.reason || !proof.length) return { status: 'blocked', summary: `${unresolved.id} requires a reason and fresh proof.`, receipt: unresolved, limits: ['reconciliation-reason-and-proof-required'], routes: [`hairness worktree reconcile --id ${handle.id} --reason <reason> --proof <proof>`] }
  let decision = null
  if (['open', 'candidate-checkout', 'adopt', 'repair'].includes(unresolved.action) && live) decision = 'observed-succeeded'
  else if (['close', 'prune'].includes(unresolved.action) && !live) decision = 'observed-succeeded'
  else if (proof.includes('effect:not-applied')) decision = 'safe-retry'
  if (!decision) return { status: 'blocked', summary: `${unresolved.id} remains ambiguous after live observation.`, receipt: unresolved, limits: ['effect-result-still-unknown'], routes: [`hairness worktree repair ${handle.id}`, `hairness worktree doctor ${handle.id}`] }
  const record = { id: `worktree-reconciliation-${hash({ receipt: unresolved.id, decision, proof, head: live?.head ?? null }).slice(0, 18)}`, receiptId: unresolved.id, handleId: handle.id, decision, reason: request.reason, proof: [...proof, live ? `git:worktree-present:${live.head}` : 'git:worktree-absent'], policyDigest: request.policyDigest, observedAt: now() }
  if (!value.reconciliations.some((item) => item.id === record.id)) value.reconciliations.push(record)
  await save(runtime, value, { type: 'worktree.reconciled', reconciliationId: record.id, receiptId: unresolved.id, decision })
  return { status: 'ready', summary: `${unresolved.id} reconciled as ${decision}.`, receipt: unresolved, reconciliation: record, limits: [], routes: decision === 'safe-retry' ? [`hairness worktree ${unresolved.action} --id ${handle.id}`] : ['hairness worktree status'] }
}

export const services = {
  inspect: ({ root, input, runtime }) => inspect(root, input, runtime),
  propose: ({ root, input, runtime }) => buildProposal(root, input.action, input.request ?? input, runtime),
  resolve: async ({ root, input, runtime }) => {
    const request = (await normalizeRequest(root, input, runtime)).value
    const result = await liveResolution(root, request, runtime)
    if (input.requireWriter) {
      if (!result.lease || result.lease.sessionId !== request.sessionId) result.limits.push('exact-writer-lease-required')
      if (result.status !== 'ready' || result.limits.length) result.status = 'blocked'
    }
    return result
  },
  execute: ({ root, input, runtime }) => executeProposal(root, input, runtime),
  'assert-writer': ({ root, input, runtime }) => assertWriter(root, input, runtime),
  'mark-cleanup-ready': async ({ root, input, runtime }) => {
    const value = await state(runtime)
    const handles = value.handles.filter((item) => item.planId === input.planId && item.state !== 'closed' && (!input.handleIds?.length || input.handleIds.includes(item.id)))
    if (!handles.length) return { status: 'ready', handles: [], limits: ['no-managed-handle'] }
    if (!input.head || !(input.proof ?? []).includes('github:pr-merged') || !(input.proof ?? []).includes(`published-head:${input.head}`) || !(input.proof ?? []).some((item) => item.startsWith('verify-main:'))) throw new Error('Cleanup readiness requires exact merge, published-head and verify-main proof.')
    const observedAt = input.observedAt ?? now()
    for (const handle of handles) {
      if (handle.kind === 'branch' && handle.head !== input.head) throw new Error(`Cleanup proof head does not match ${handle.id}.`)
      handle.state = 'cleanup-ready'
      handle.cleanupProof = { head: input.head, proof: [...new Set(input.proof)], observedAt, maxAgeMinutes: input.maxAgeMinutes ?? 30 }
      handle.updatedAt = observedAt
      await validateHandle(runtime, handle)
    }
    await save(runtime, value, { type: 'worktree.cleanup-ready', planId: input.planId, handles: handles.map((item) => item.id) })
    return { status: 'cleanup-ready', handles: handles.map((item) => item.id), limits: [], routes: handles.map((item) => `hairness worktree close --id ${item.id}`) }
  },
}

export async function authorityPolicy({ root, input, runtime, manifest }) {
  const requestedEffects = input.requestedEffects ?? []
  const run = input.runId ? await runtime.runs.read(input.runId).catch(() => null) : null
  const localTargets = (run?.assignment?.targets ?? []).filter((target) => !String(target).includes('://'))
  const canonicalLocalTargets = await Promise.all(localTargets.map((target) => realpath(target).catch(() => resolve(target))))
  const checkout = run?.assignment?.inputs?.find?.((item) => item.checkoutContext)?.checkoutContext
  const evidence = requestedEffects.includes('filesystem:write') && canonicalLocalTargets.length ? await inventory(root, runtime).catch(() => null) : null
  const versionedWrite = Boolean(checkout) || canonicalLocalTargets.some((target) => evidence?.worktrees.some((item) => {
    const from = resolve(item.path)
    const to = resolve(target)
    const nested = relative(from, to)
    return !nested || (!nested.startsWith('..') && !isAbsolute(nested))
  }))
  const relevant = requestedEffects.filter((effect) => gitEffects.has(effect) || effect === 'target-mutation' || (effect === 'filesystem:write' && versionedWrite))
  let deniedEffects = []
  const reasons = []
  if (relevant.length && input.runId) {
    if (!run) { deniedEffects = relevant; reasons.push('worktree-run-missing') }
    else if (run.assignment?.operation?.capability !== 'hairness/worktree') {
      if (!checkout?.handleRef) {
        const branch = run.assignment?.inputs?.find((item) => item.branch)?.branch ?? null
        const bootstrapEvidence = canonicalLocalTargets.length === 1 && relevant.every((effect) => effect === 'target-mutation') ? await inventory(root, runtime).catch(() => null) : null
        const live = bootstrapEvidence?.worktrees.find((item) => resolve(item.path) === resolve(canonicalLocalTargets[0])) ?? null
        const exactReason = `hairness:${run.id}:${run.planId}`
        const safeBootstrap = Boolean(live && resolve(live.path) !== resolve(bootstrapEvidence.repositoryRoot) && live.locked && live.lockReason === exactReason && (!branch || live.branch === branch))
        if (safeBootstrap) reasons.push('exact-locked-bootstrap-worktree')
        else { deniedEffects = relevant; reasons.push('managed-worktree-context-missing') }
      }
      else {
        const value = await state(runtime)
        const handle = value.handles.find((item) => item.id === checkout.handleRef.id && item.state !== 'closed')
        const lease = handle ? activeLease(value, handle.id) : null
        const resolved = handle && lease ? await liveResolution(root, { repository: handle.repository, planId: handle.planId, sessionId: lease.sessionId, policyDigest: handle.policyDigest, worktreeId: handle.id }, runtime, value).catch(() => null) : null
        if (!resolved || resolved.status !== 'ready' || resolved.digest !== checkout.handleRef.digest) { deniedEffects = relevant; reasons.push('managed-worktree-context-stale') }
        else if (resolve(resolved.handle.path) === resolve(resolved.evidence.repositoryRoot)) { deniedEffects = relevant; reasons.push('anchor-mutation-forbidden') }
      }
    }
  } else if (relevant.length) reasons.push('worktree-revalidation-deferred-to-executor')
  const allowedEffects = requestedEffects.filter((effect) => !deniedEffects.includes(effect))
  return [{ owner: manifest.id, requestedEffects, allowedEffects, deniedEffects, reasons, digest: digest({ requestedEffects, allowedEffects, deniedEffects, reasons }), observedAt: now() }]
}

export async function attentionSignals({ root, runtime }) {
  const dashboard = await inspect(root, {}, runtime).catch(() => null)
  if (!dashboard) return [{ state: 'blocked', priority: 90, summary: 'Worktree evidence is unavailable.', route: 'hairness worktree doctor' }]
  const signals = []
  const prunable = dashboard.worktrees.filter((item) => item.classification === 'prunable').length
  const orphaned = dashboard.worktrees.filter((item) => item.classification === 'orphaned').length
  const cleanup = dashboard.handles.filter((item) => item.state === 'cleanup-ready').length
  if (orphaned) signals.push({ state: 'blocked', priority: 88, summary: `${orphaned} managed worktree(s) are orphaned.`, route: 'hairness worktree doctor' })
  if (prunable) signals.push({ state: 'active', priority: 72, summary: `${prunable} prunable Git worktree entr${prunable === 1 ? 'y' : 'ies'} require a checkpoint.`, route: 'hairness worktree doctor' })
  if (cleanup) signals.push({ state: 'ready', priority: 55, summary: `${cleanup} completed worktree(s) are cleanup-ready.`, route: 'hairness worktree status' })
  return signals
}

export async function sessionContributions({ root, runtime, manifest }) {
  const dashboard = await inspect(root, {}, runtime).catch(() => null)
  const managed = dashboard?.worktrees.filter((item) => item.classification === 'managed').length ?? 0
  const attention = dashboard?.worktrees.filter((item) => ['blocked', 'orphaned', 'prunable'].includes(item.classification)).length ?? 0
  const summary = dashboard ? `${managed} managed worktree(s)${attention ? ` · ${attention} need attention` : ''}.` : 'Worktree inventory unavailable.'
  const value = { owner: manifest.id, section: 'worktrees', priority: attention ? 85 : 58, summary, data: { managed, attention }, routes: ['hairness worktree status'], limits: dashboard ? [] : ['worktree-evidence-unavailable'], freshness: now(), byteSize: 0 }
  value.byteSize = Buffer.byteLength(JSON.stringify(value.data))
  return [value]
}

function flagsRequest(root, flags, action) {
  const proof = String(flags.proof ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return {
    repository: flags.codebase ? { kind: 'codebase', id: flags.codebase, checkout: flags.checkout ?? 'default' } : { kind: 'workspace' },
    planId: flags.plan ?? flags['plan-id'] ?? `manual-${slug(flags.branch ?? flags.id ?? action)}`,
    sessionId: flags.session,
    policyDigest: flags.policy ?? flags['policy-digest'],
    worktreeId: flags.id,
    type: flags.type,
    slug: flags.slug,
    branch: flags.branch,
    base: flags.base,
    mode: flags.detached ? 'detached' : flags.mode,
    commit: flags.commit,
    path: flags.path,
    targetSessionId: flags.to,
    expectedHead: flags.head,
    remoteHead: flags['remote-head'],
    published: flags.published,
    reason: flags.reason,
    proof,
    bootstrap: flags.bootstrap,
    controller: flags.controller,
  }
}

async function prepareActionRun(proposal, runtime) {
  const action = proposal.action === 'close-batch' ? 'close' : proposal.action
  const runId = `run-${proposal.id}`
  const planId = `worktree-${proposal.id}`
  let run = await runtime.runs.read(runId).catch(() => null)
  if (!run) {
    const fanIn = `fan-in-${proposal.id}`
    const operation = { capability: 'hairness/worktree', id: action }
    await runtime.plans.write({
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: planId,
      intent: { schemaVersion: 2, protocolVersion: '0.2', id: `${planId}-intent`, summary: `Execute ${proposal.action} for the exact checkout proposal.`, outcome: 'One correlated CheckoutReceipt.', targets: proposal.targets, limits: proposal.limits },
      routes: [{ schemaVersion: 2, protocolVersion: '0.2', id: runId, operation, kind: 'deterministic', requirement: 'required', resultSchema: 'CheckoutReceipt', fanIn }],
      fanIn: { id: fanIn, mode: 'mechanical' },
    })
    run = await runtime.runs.create({ id: runId, planId, assignment: {
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: `execute-${proposal.id}`,
      operation,
      profile: 'executor',
      goal: `Execute only ${proposal.action} for the exact proposed checkout target(s).`,
      outcome: 'One typed CheckoutReceipt correlated to this Run and checkpoint.',
      workload: 'fast',
      budget: 1,
      inputs: [{ checkoutProposal: proposal }],
      targets: proposal.targets,
      exclusions: ['scope expansion', 'main mutation', 'implicit cleanup', 'forced worktree removal', 'nested subagents'],
      allowedSources: ['git:read'],
      requestedEffects: proposal.effects,
      result: { schema: 'CheckoutReceipt', disposition: 'effect' },
    } })
    await runtime.runs.transition(runId, 'ready')
    run = await runtime.runs.transition(runId, 'needs-authority')
  }
  const checkpoint = await runtime.runs.proposeCheckpoint({ schemaVersion: 2, protocolVersion: '0.2', id: proposal.id, runId, mode: 'mutation', intent: `Execute ${proposal.action} for the exact proposed checkout target(s).`, targets: proposal.targets, effects: proposal.effects, exclusions: ['scope expansion', 'main mutation', 'implicit cleanup', 'forced worktree removal'], risk: 'Mutates only the exact proposed managed checkout target(s).', proof: proposal.proof, approved: false })
  return { run, runId, planId, checkpoint, capsule: await runtime.runs.capsule(runId) }
}

async function executeActionRun(root, proposalId, runId, runtime) {
  const run = await runtime.runs.read(runId)
  if (run.state !== 'ready') throw new Error(`Worktree Run ${runId} is ${run.state}; approve its exact checkpoint first.`)
  const proposal = (await state(runtime)).proposals.find((item) => item.id === proposalId)
  if (!proposal) throw new Error(`CheckoutProposal not found: ${proposalId}`)
  await runtime.runs.transition(runId, 'running')
  const result = await executeProposal(root, { proposal, runId, checkpointId: proposalId }, runtime)
  if (result.status === 'succeeded' || result.status === 'failed') await runtime.authority.releaseLocks(proposal.targets, runId)
  else await runtime.authority.quarantineLocks(proposal.targets, runId, `worktree receipt: ${result.status}`)
  const runStatus = result.status === 'partial' ? 'unknown' : result.status
  await runtime.runs.result(runId, { schemaVersion: 2, protocolVersion: '0.2', runId, status: runStatus, summary: result.summary, outcome: { receipt: result, checkoutContext: result.checkoutContext ?? null }, proof: result.proof, limits: result.limits, routes: result.status === 'succeeded' ? ['hairness worktree status'] : ['hairness worktree reconcile'] })
  return result
}

export async function handleCommand({ root, target, action, flags, runtime }) {
  const mode = target ?? 'status'
  const requestedRepository = flags.codebase ? { kind: 'codebase', id: flags.codebase, checkout: flags.checkout ?? 'default' } : null
  if (mode === 'status') return inspect(root, requestedRepository ? { repository: requestedRepository } : {}, runtime)
  if (mode === 'show') {
    const dashboard = await inspect(root, {}, runtime)
    const id = action ?? flags.id
    if (!id) return dashboard
    const handle = dashboard.handles.find((item) => item.id === id || item.planId === id || resolve(item.path) === resolve(id))
    if (!handle) throw new Error(`Worktree handle not found: ${id}`)
    return services.resolve({ root, input: { ...handle, repository: handle.repository, planId: handle.planId, worktreeId: handle.id, sessionId: flags.session, policyDigest: handle.policyDigest }, runtime })
  }
  if (mode === 'doctor') {
    const dashboard = await inspect(root, requestedRepository ? { repository: requestedRepository } : {}, runtime)
    const value = await state(runtime)
    const activeHandle = flags.id
      ? value.handles.find((item) => item.id === flags.id || item.planId === flags.id)
      : value.handles.find((item) => item.state !== 'closed' && resolve(item.path) === resolve(process.cwd())) ?? value.handles.find((item) => item.state !== 'closed')
    if (!dashboard.controller || dashboard.limits.some((item) => item.startsWith('controller-')) || activeHandle && (!activeHandle.controllerRef || activeHandle.repository?.root)) {
      const request = {
        repository: logicalRepository(activeHandle?.repository ?? requestedRepository ?? { kind: 'workspace' }),
        planId: activeHandle?.planId ?? flags.plan ?? 'controller-repair',
        worktreeId: activeHandle?.id,
        sessionId: flags.session,
        policyDigest: activeHandle?.policyDigest ?? flags.policy,
        path: activeHandle?.path,
        branch: activeHandle?.branch,
        base: activeHandle?.base ?? 'main',
        mode: activeHandle?.detached ? 'detached' : 'branch',
        commit: activeHandle?.detached ? activeHandle.head : undefined,
        controller: true,
      }
      const proposal = await buildProposal(root, 'repair', request, runtime)
      const prepared = proposal.limits.length ? null : await prepareActionRun(proposal, runtime)
      return { ...dashboard, migration: { status: proposal.limits.length ? 'blocked' : 'needs-authority', proposal, checkpoint: prepared?.checkpoint ?? null, runId: prepared?.runId ?? null, capsule: prepared?.capsule ?? null }, routes: proposal.limits.length ? dashboard.routes : [`hairness run ${prepared.runId} approve --checkpoint ${proposal.id} --json`, `hairness worktree repair --controller${activeHandle ? ` --id ${activeHandle.id}` : ''} --checkpoint ${proposal.id} --run ${prepared.runId}`] }
    }
    return dashboard
  }
  if (mode === 'guard') {
    const path = await realpath(flags.path)
    const value = await state(runtime)
    const handle = value.handles.find((item) => item.state !== 'closed' && resolve(item.path) === path)
    if (!handle) throw new Error('Commit or push refused: checkout is unmanaged.')
    const lease = activeLease(value, handle.id)
    if (!lease) throw new Error('Commit or push refused: writer lease is missing.')
    const observedController = await observeController(root, runtime, value)
    const resolvedRepository = await repository(root, { repository: handle.repository }, runtime, observedController)
    const evidence = await inventory(resolvedRepository.path, runtime)
    if (resolve(evidence.repositoryRoot) === path) throw new Error('Commit or push refused from the repository anchor.')
    const live = evidence.worktrees.find((item) => resolve(item.path) === path)
    if (!live || live.branch !== handle.branch || Boolean(live.detached) !== handle.detached) throw new Error('Commit or push refused: checkout branch no longer matches its handle.')
    if (!handle.controllerRef || handle.controllerRef.id !== observedController.controller?.id) throw new Error('Commit or push refused: checkout controller is missing or stale.')
    if (!live.locked || live.lockReason !== exactLockReason(handle.controllerRef.id, handle.id, handle.planId)) throw new Error('Commit or push refused: managed worktree lock is missing or stale.')
    if (flags.event === 'pre-push' && handle.branch === 'main') throw new Error('Direct pushes to main are forbidden.')
    return { status: 'ready', handleId: handle.id, planId: handle.planId, leaseId: lease.id }
  }
  const request = flagsRequest(root, flags, mode)
  if (mode === 'reconcile') return reconcile(root, request, runtime)
  if (!mutatingActions.has(mode)) throw new Error(`Unknown worktree action: ${mode}`)
  if (flags.auto && flags.checkpoint) return { status: 'blocked', summary: '--auto never grants worktree authority.', limits: ['explicit-checkpoint-required'], routes: [] }
  if (!flags.checkpoint) {
    const proposal = mode === 'close' && flags['all-ready'] ? await buildCloseBatchProposal(root, requestedRepository ? { repository: requestedRepository } : {}, runtime) : await buildProposal(root, mode, request, runtime)
    if (proposal.limits.length) return { status: 'blocked', summary: `${proposal.action} preview is blocked.`, proposal, limits: proposal.limits, routes: ['hairness worktree doctor'] }
    const prepared = await prepareActionRun(proposal, runtime)
    return { status: 'needs-authority', summary: proposal.action === 'close-batch' ? `Batch cleanup preview for ${proposal.items.length} worktree(s).` : `${mode} preview for ${proposal.request.worktreeId}.`, proposal, checkpoint: prepared.checkpoint, runId: prepared.runId, capsule: prepared.capsule, limits: ['No target effect occurred.'], routes: [`hairness run ${prepared.runId} approve --checkpoint ${proposal.id} --json`, `hairness worktree ${mode}${proposal.action === 'close-batch' ? ' --all-ready' : ''} --checkpoint ${proposal.id} --run ${prepared.runId}`] }
  }
  if (!flags.run) throw new Error('Executing a worktree checkpoint requires --run <run-id>.')
  return executeActionRun(root, flags.checkpoint, flags.run, runtime)
}

export const contracts = { VERSION, handleMaterial, leaseMaterial }
