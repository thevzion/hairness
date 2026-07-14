import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, lstat, mkdir, readlink, realpath, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const exec = promisify(execFile)
const VERSION = '0.2.0-alpha.0'
const emptyState = () => ({ schemaVersion: 2, protocolVersion: '0.2', handles: [], leases: [], proposals: [], receipts: [], reconciliations: [], updatedAt: new Date().toISOString() })
const mutatingActions = new Set(['open', 'candidate-checkout', 'adopt', 'sync', 'handoff', 'takeover', 'close', 'repair', 'prune'])
const gitEffects = new Set(['git:worktree', 'git:branch', 'git:rebase', 'git:commit', 'git:push', 'git:tag'])
const actionEffects = {
  open: ['filesystem:write', 'git:worktree', 'git:branch'],
  'candidate-checkout': ['filesystem:write', 'git:worktree'],
  adopt: ['target-mutation'],
  sync: ['git:rebase'],
  handoff: ['filesystem:write'],
  takeover: ['filesystem:write'],
  close: ['filesystem:write', 'git:worktree'],
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

async function state(runtime) { return runtime.overlay.read('state.json', emptyState()) }

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
    placement: configured.placement ?? 'sibling',
    directorySuffix: configured.directorySuffix ?? '-worktrees',
    layout: configured.layout ?? '{type}/{slug}',
    enforcement: configured.enforcement ?? 'required',
    hooks: configured.hooks ?? 'required',
    cleanup: configured.cleanup ?? 'checkpoint',
    root: preferences.worktrees?.root ?? null,
  }
  if (value.placement !== 'sibling') throw new Error(`Unsupported worktree placement: ${value.placement}`)
  if (!/^-[a-z0-9][a-z0-9-]*$/.test(value.directorySuffix)) throw new Error('defaults.worktrees.directorySuffix must be a safe suffix.')
  if (!value.layout.includes('{type}') || !value.layout.includes('{slug}')) throw new Error('defaults.worktrees.layout must include {type} and {slug}.')
  if (!['required', 'optional'].includes(value.enforcement) || !['required', 'optional'].includes(value.hooks) || value.cleanup !== 'checkpoint') throw new Error('Invalid defaults.worktrees policy.')
  if (value.root && !isAbsolute(value.root)) value.root = resolve(root, value.root)
  return { value, digest: digest(value) }
}

async function currentSession(runtime, input = {}) {
  if (input.sessionId) return { id: input.sessionId, limits: [] }
  const flags = input.session ?? {}
  const session = await runtime.extensions.call('hairness/session-intelligence', 'current', flags).catch(() => null)
  if (session?.id) return { id: session.id, limits: session.limits ?? [] }
  const provider = process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_SESSION_ID
  return { id: provider ? `provider-${provider}` : 'session-unbound', limits: provider ? [] : ['provider-session-unbound'] }
}

async function repository(root, request, runtime) {
  const ref = request.repository ?? { kind: 'workspace' }
  if (ref.kind === 'workspace') {
    const path = await realpath(ref.root ?? root)
    const evidence = await source(runtime, 'worktrees', { path })
    return { ref: { kind: 'workspace', root: await realpath(evidence.repositoryRoot), remote: ref.remote ?? null }, path }
  }
  if (ref.kind !== 'codebase' || !ref.id) throw new Error('RepositoryRef must identify the workspace or a registered codebase.')
  const inspected = ref.root ? null : await runtime.extensions.call('hairness/codebase', 'inspect', { id: ref.id, checkout: ref.checkout ?? 'default' })
  const path = await realpath(ref.root ?? inspected?.path)
  return { ref: { kind: 'codebase', id: ref.id, checkout: ref.checkout ?? 'default', root: path, remote: ref.remote ?? inspected?.git?.remote ?? null }, path }
}

async function normalizeRequest(root, raw, runtime) {
  const session = await currentSession(runtime, raw)
  const repo = await repository(root, raw, runtime)
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
  }
  if (!value.planId) throw new Error('CheckoutRequest requires planId.')
  if (value.mode === 'branch' && !value.branch && !value.worktreeId) throw new Error('A branch checkout requires branch.')
  if (value.mode === 'detached' && !value.commit && !value.worktreeId) throw new Error('A detached checkout requires commit.')
  await runtime.contracts.validateSchema('./schemas/checkout-request.schema.json', value, 'CheckoutRequest')
  return { value, sessionLimits: session.limits, repositoryPath: repo.path }
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
  return { id: handle.id, repository: handle.repository, planId: handle.planId, kind: handle.kind, path: handle.path, branch: handle.branch, base: handle.base, head: handle.head, detached: handle.detached, state: handle.state, policyDigest: handle.policyDigest }
}

function leaseMaterial(lease) {
  return lease ? { id: lease.id, handleId: lease.handleId, planId: lease.planId, sessionId: lease.sessionId, mode: lease.mode, state: lease.state } : null
}

function activeLease(value, handleId) {
  return value.leases.findLast((item) => item.handleId === handleId && item.state === 'active') ?? null
}

async function placement(root, request, repositoryPath, runtime) {
  const policy = await effectivePolicy(root, runtime)
  const evidence = await inventory(repositoryPath, runtime)
  const anchor = dirname(evidence.commonDir)
  const placementRoot = policy.value.root ?? join(dirname(anchor), `${basename(anchor)}${policy.value.directorySuffix}`)
  const suffix = policy.value.layout.replaceAll('{type}', request.type).replaceAll('{slug}', request.slug)
  const path = resolve(placementRoot, suffix)
  if (relative(resolve(placementRoot), path).startsWith('..')) throw new Error('Configured worktree layout escapes its placement root.')
  return { policy, evidence, anchor, placementRoot: resolve(placementRoot), path }
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
  const evidence = await inventory(request.repository.root, runtime)
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
  else if (!live.locked || !String(live.lockReason ?? '').endsWith(`:${stored.planId}`)) { status = 'blocked'; limits.push('managed-worktree-lock-missing-or-stale') }
  if (stored.policyDigest !== request.policyDigest) { status = 'blocked'; limits.push('policy-digest-mismatch') }
  if (!lease || lease.state !== 'active') { status = status === 'ready' ? 'observer' : status; limits.push('writer-lease-missing') }
  else if (lease.planId !== request.planId) { status = 'blocked'; limits.push('writer-plan-mismatch') }
  const context = live ? {
    schemaVersion: 2,
    protocolVersion: '0.2',
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
  const placed = await placement(root, request, normalized.repositoryPath, runtime)
  const handle = selectHandle(value, request)
  const existingPath = request.path ?? handle?.path ?? placed.path
  const live = placed.evidence.worktrees.find((item) => resolve(item.path) === resolve(existingPath)) ?? null
  const handleDigest = handle ? digest(handleMaterial(handle)) : null
  const worktreeId = handle?.id ?? request.worktreeId ?? `worktree-${hash({ repository: request.repository, planId: request.planId, path: existingPath }).slice(0, 16)}`
  request.worktreeId = worktreeId
  const limits = [...normalized.sessionLimits.filter((item) => item !== 'provider-session-unbound')]
  const proof = [`git:common-dir:${placed.evidence.commonDir}`, `git:repository-root:${placed.evidence.repositoryRoot}`, `worktree-policy:${placed.policy.digest}`]
  let idSeed = { action, request, worktreePolicy: placed.policy.digest, handleDigest, live: live ? { path: live.path, head: live.head, branch: live.branch, locked: live.locked, prunable: live.prunable } : null }

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
      if (!live?.locked || !String(live.lockReason ?? '').endsWith(`:${request.planId}`)) limits.push('bootstrap-lock-does-not-match-plan')
      proof.push('bootstrap:explicit-target-mutation-compatibility')
    } else if (live?.locked && live.lockReason && live.lockReason !== `hairness:${request.worktreeId}:${request.planId}`) limits.push('worktree-locked-elsewhere')
  } else if (action === 'prune') {
    if (!live?.prunable) limits.push('entry-is-not-prunable')
    if (placed.evidence.worktrees.filter((item) => item.prunable).length !== 1) limits.push('prune-would-affect-multiple-entries')
  } else {
    if (!handle) limits.push('managed-handle-missing')
    if (!live && action !== 'repair') limits.push('git-worktree-missing')
    const lease = handle ? activeLease(value, handle.id) : null
    if (!lease && !['takeover', 'repair'].includes(action)) limits.push('writer-lease-missing')
    if (lease && lease.sessionId !== request.sessionId && !['takeover'].includes(action)) limits.push('writer-session-mismatch')
    if (request.expectedHead && live?.head !== request.expectedHead) limits.push('expected-head-mismatch')
    if (action === 'sync' && (handle?.detached || !handle?.branch)) limits.push('detached-worktree-cannot-sync')
    if (action === 'sync' && request.published && !request.remoteHead) limits.push('force-with-lease-requires-remote-head')
    if (action === 'handoff' && (!request.targetSessionId || request.targetSessionId === request.sessionId)) limits.push('distinct-target-session-required')
    if (action === 'takeover' && (!request.reason || !(request.proof ?? []).some((item) => item.includes('stale')))) limits.push('takeover-requires-stale-proof-and-reason')
  }

  const unresolved = handle ? unresolvedReceipt(value, handle.id) : null
  if (unresolved && !['repair', 'reconcile'].includes(action)) limits.push(`reconciliation-required:${unresolved.id}`)
  const effects = action === 'adopt' && !request.bootstrap ? ['filesystem:write', 'git:worktree'] : [...(actionEffects[action] ?? [])]
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

async function validateLease(runtime, lease) {
  return runtime.contracts.validateSchema('./schemas/worktree-lease.schema.json', lease, 'WorktreeLease')
}

async function makeContext(runtime, handle, lease) {
  const context = { schemaVersion: 2, protocolVersion: '0.2', handleRef: { id: handle.id, digest: digest(handleMaterial(handle)) }, path: handle.path, head: handle.head, branch: handle.branch, leaseRef: lease ? { id: lease.id, digest: digest(leaseMaterial(lease)) } : null, policyDigest: handle.policyDigest }
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
  if (selected.limits.length) throw new Error(`CheckoutProposal is blocked: ${selected.limits.join(', ')}`)
  const fresh = await buildProposal(root, selected.action, selected.request, runtime, { persist: false })
  if (fresh.id !== selected.id || fresh.requestDigest !== selected.requestDigest || fresh.handleDigest !== selected.handleDigest || fresh.policyDigest !== selected.policyDigest) throw new Error('CheckoutProposal is stale; observe and propose again.')
  await authorize(selected, input.runId, runtime)
  const request = selected.request
  const evidence = await inventory(request.repository.root, runtime)
  const targetPath = selected.targets.find((item) => !item.includes('://'))
  let started = false
  let context = null
  let effectProof = [...selected.proof]
  let limits = []
  try {
    if (selected.action === 'open' || selected.action === 'candidate-checkout') {
      started = true
      const reason = `hairness:${request.worktreeId}:${request.planId}`
      if (selected.action === 'candidate-checkout') await git(request.repository.root, ['worktree', 'add', '--detach', '--lock', '--reason', reason, targetPath, request.commit])
      else await git(request.repository.root, ['worktree', 'add', '--lock', '--reason', reason, '-b', request.branch, targetPath, request.base])
      const refs = await source(runtime, 'refs', { path: targetPath })
      const handle = { schemaVersion: 2, protocolVersion: '0.2', id: request.worktreeId, repository: request.repository, planId: request.planId, kind: selected.action === 'candidate-checkout' ? 'candidate' : 'branch', path: targetPath, branch: selected.action === 'candidate-checkout' ? null : request.branch, base: request.base, head: refs.head, detached: selected.action === 'candidate-checkout', state: 'active', policyDigest: request.policyDigest, createdAt: now(), updatedAt: now() }
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
      const handle = value.handles.find((item) => item.id === request.worktreeId) ?? { schemaVersion: 2, protocolVersion: '0.2', id: request.worktreeId, repository: request.repository, planId: request.planId, kind: live.detached ? 'candidate' : 'branch', path: targetPath, branch: live.branch ?? null, base: request.base, head: live.head ?? null, detached: Boolean(live.detached), state: 'active', policyDigest: request.policyDigest, createdAt: now(), updatedAt: now() }
      if (!live.locked) await git(request.repository.root, ['worktree', 'lock', '--reason', `hairness:${handle.id}:${request.planId}`, targetPath])
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
      const handle = value.handles.find((item) => item.id === request.worktreeId)
      const prior = activeLease(value, handle.id)
      if (selected.action === 'handoff' && prior.sessionId !== request.sessionId) throw new Error('Only the active writer can hand off its lease.')
      started = true
      prior.state = 'released'; prior.updatedAt = now()
      const next = newLease(handle, selected.action === 'handoff' ? request.targetSessionId : request.sessionId, prior, request.reason ?? selected.action)
      await validateLease(runtime, next); value.leases.push(next)
      context = await makeContext(runtime, handle, next)
      effectProof.push(`lease:${prior.id}:released`, `lease:${next.id}:active`)
    } else if (selected.action === 'close') {
      const resolved = await assertWriter(root, { ...request, runId: input.runId, effect: 'git:worktree', target: selected.targets[0] }, runtime)
      const status = await source(runtime, 'status', { path: resolved.handle.path })
      if ((status.dirty ?? 0) > 0) throw new Error('Cleanup refused: worktree is dirty.')
      if ((status.ahead ?? 0) > 0) throw new Error('Cleanup refused: worktree has unpushed commits.')
      if (!resolved.handle.detached) {
        const proof = await source(runtime, 'merge-proof', { path: resolved.handle.path, base: resolved.handle.base })
        if (!proof.isIntegrated) throw new Error('Cleanup refused: branch is not integrated in its base.')
      }
      started = true
      await git(request.repository.root, ['worktree', 'unlock', resolved.handle.path]).catch(() => null)
      await git(request.repository.root, ['worktree', 'remove', resolved.handle.path])
      const stored = value.handles.find((item) => item.id === resolved.handle.id)
      stored.state = 'closed'; stored.updatedAt = now()
      const lease = activeLease(value, stored.id); lease.state = 'released'; lease.updatedAt = now()
      if (request.repository.kind === 'codebase') await runtime.extensions.call('hairness/codebase', 'unmount-managed', { runId: input.runId, effect: 'filesystem:write', target: codebaseTarget(request, stored.id), codebaseId: request.repository.id, checkout: stored.id })
      effectProof.push(`git:worktree-removed:${stored.path}`)
    } else if (selected.action === 'repair') {
      started = true
      await git(request.repository.root, ['worktree', 'repair', targetPath])
      const handle = value.handles.find((item) => item.id === request.worktreeId)
      if (handle) {
        limits.push(...await ensureOverlayLink(root, handle, evidence))
        limits.push(...await installGuards(root, handle, evidence))
        const live = (await inventory(request.repository.root, runtime)).worktrees.find((item) => resolve(item.path) === resolve(handle.path))
        if (live) { handle.head = live.head; handle.branch = live.branch; handle.detached = live.detached; handle.state = 'active'; handle.updatedAt = now(); context = await makeContext(runtime, handle, activeLease(value, handle.id)) }
      }
      effectProof.push(`git:worktree-repaired:${targetPath}`)
    } else if (selected.action === 'prune') {
      started = true
      await git(request.repository.root, ['worktree', 'prune', '--expire', 'now'])
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

async function inspect(root, input, runtime) {
  const raw = input?.repository ? input : { ...input, repository: { kind: 'workspace', root }, planId: input?.planId ?? 'inventory', sessionId: input?.sessionId ?? 'observer', policyDigest: input?.policyDigest ?? digest('inventory'), mode: 'branch', branch: input?.branch ?? 'inspect/inventory' }
  const normalized = await normalizeRequest(root, raw, runtime)
  const evidence = await inventory(normalized.repositoryPath, runtime)
  const value = await state(runtime)
  const discovered = evidence.worktrees.map((entry) => {
    const handle = value.handles.findLast((item) => item.state !== 'closed' && resolve(item.path) === resolve(entry.path))
    const lease = handle ? activeLease(value, handle.id) : null
    let classification = entry.prunable ? 'prunable' : handle ? 'managed' : resolve(entry.path) === resolve(evidence.repositoryRoot) ? 'anchor' : 'unmanaged'
    if (handle && (!lease || entry.moved)) classification = 'blocked'
    return { ...entry, classification, handleId: handle?.id ?? null, planId: handle?.planId ?? null, writerSessionId: lease?.sessionId ?? null }
  })
  for (const handle of value.handles.filter((item) => item.state !== 'closed')) if (!discovered.some((item) => item.handleId === handle.id)) discovered.push({ path: handle.path, head: handle.head, branch: handle.branch, detached: handle.detached, locked: false, lockReason: null, prunable: false, prunableReason: null, moved: false, classification: 'orphaned', handleId: handle.id, planId: handle.planId, writerSessionId: activeLease(value, handle.id)?.sessionId ?? null })
  return { schemaVersion: 2, protocolVersion: '0.2', status: discovered.some((item) => ['blocked', 'orphaned'].includes(item.classification)) ? 'blocked' : 'ready', repositoryRoot: evidence.repositoryRoot, commonDir: evidence.commonDir, worktrees: discovered, handles: value.handles, leases: value.leases.filter((item) => item.state === 'active'), limits: [], routes: discovered.some((item) => item.classification === 'prunable') ? ['hairness worktree doctor'] : [] }
}

async function reconcile(root, input, runtime) {
  const value = await state(runtime)
  const request = (await normalizeRequest(root, input, runtime)).value
  const handle = selectHandle(value, request)
  const unresolved = handle ? unresolvedReceipt(value, handle.id) : null
  if (!unresolved) return { status: 'ready', summary: 'No unresolved worktree effect.', limits: [], routes: [] }
  const live = (await inventory(request.repository.root, runtime)).worktrees.find((item) => resolve(item.path) === resolve(handle.path)) ?? null
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
    repository: flags.codebase ? { kind: 'codebase', id: flags.codebase, ...(flags.path ? { root: flags.path } : {}) } : { kind: 'workspace', root },
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
  }
}

export async function handleCommand({ root, target, action, flags, runtime }) {
  const mode = target ?? 'status'
  if (mode === 'status') return inspect(root, {}, runtime)
  if (mode === 'show') {
    const dashboard = await inspect(root, {}, runtime)
    const id = action ?? flags.id
    if (!id) return dashboard
    const handle = dashboard.handles.find((item) => item.id === id || item.planId === id || resolve(item.path) === resolve(id))
    if (!handle) throw new Error(`Worktree handle not found: ${id}`)
    return services.resolve({ root, input: { ...handle, repository: handle.repository, planId: handle.planId, worktreeId: handle.id, sessionId: flags.session, policyDigest: handle.policyDigest }, runtime })
  }
  if (mode === 'doctor') return inspect(root, {}, runtime)
  if (mode === 'guard') {
    const path = await realpath(flags.path)
    const value = await state(runtime)
    const handle = value.handles.find((item) => item.state !== 'closed' && resolve(item.path) === path)
    if (!handle) throw new Error('Commit or push refused: checkout is unmanaged.')
    const lease = activeLease(value, handle.id)
    if (!lease) throw new Error('Commit or push refused: writer lease is missing.')
    const evidence = await inventory(handle.repository.root, runtime)
    if (resolve(evidence.repositoryRoot) === path) throw new Error('Commit or push refused from the repository anchor.')
    const live = evidence.worktrees.find((item) => resolve(item.path) === path)
    if (!live || live.branch !== handle.branch || Boolean(live.detached) !== handle.detached) throw new Error('Commit or push refused: checkout branch no longer matches its handle.')
    if (!live.locked || !String(live.lockReason ?? '').endsWith(`:${handle.planId}`)) throw new Error('Commit or push refused: managed worktree lock is missing or stale.')
    if (flags.event === 'pre-push' && handle.branch === 'main') throw new Error('Direct pushes to main are forbidden.')
    return { status: 'ready', handleId: handle.id, planId: handle.planId, leaseId: lease.id }
  }
  const request = flagsRequest(root, flags, mode)
  if (mode === 'reconcile') return reconcile(root, request, runtime)
  if (!mutatingActions.has(mode)) throw new Error(`Unknown worktree action: ${mode}`)
  if (flags.auto && flags.checkpoint) return { status: 'blocked', summary: '--auto never grants worktree authority.', limits: ['explicit-checkpoint-required'], routes: [] }
  if (!flags.checkpoint) {
    const proposal = await buildProposal(root, mode, request, runtime)
    return { status: proposal.limits.length ? 'blocked' : 'needs-authority', summary: `${mode} preview for ${proposal.request.worktreeId}.`, proposal, checkpoint: { id: proposal.id, targets: proposal.targets, effects: proposal.effects, exclusions: ['main mutation', 'implicit cleanup', 'forced worktree removal'], risk: 'Mutates only the exact proposed managed checkout.' }, limits: proposal.limits, routes: proposal.limits.length ? ['hairness worktree doctor'] : [`hairness worktree ${mode} --checkpoint ${proposal.id} --run <run-id>`] }
  }
  if (!flags.run) throw new Error('Executing a worktree checkpoint requires --run <run-id>.')
  return executeProposal(root, { proposal: flags.checkpoint, runId: flags.run, checkpointId: flags.checkpoint }, runtime)
}

export const contracts = { VERSION, handleMaterial, leaseMaterial }
