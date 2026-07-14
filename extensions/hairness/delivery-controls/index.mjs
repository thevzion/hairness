import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const now = () => new Date().toISOString()
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const digest = (value) => `sha256:${hash(value)}`
const split = (value, separator = ',') => String(value ?? '').split(separator).map((item) => item.trim()).filter(Boolean)
const slug = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'change'
const empty = () => ({ schemaVersion: 2, protocolVersion: '0.2', drafts: [], plans: [], receipts: [], reconciliationCheckpoints: [], reconciliations: [], activePlanId: null, updatedAt: now() })
const changeStages = ['prepare', 'implement', 'sync-base', 'qualify', 'publish-pr', 'ci', 'merge', 'verify-main']
const releaseStages = ['collect', 'prepare', 'release-pr', 'ci', 'sync-base', 'merge', 'verify-main', 'candidate-checkout', 'qualify', 'npm-publish', 'git-tag-create', 'git-tag-push', 'github-release']
const observeStages = new Set(['qualify', 'ci', 'verify-main', 'collect'])
const worktreeStages = new Map([
  ['prepare', 'open'],
  ['sync-base', 'sync'],
  ['candidate-checkout', 'candidate-checkout'],
])
const reconciliationDecisions = new Set(['accept-deviation', 'retry', 'abort'])
const effectsByStage = {
  implement: ['filesystem:write'],
  'publish-pr': ['git:commit', 'git:push', 'github:pull-request'],
  merge: ['github:merge'],
  'release-pr': ['filesystem:write', 'git:commit', 'git:push', 'github:pull-request'],
  'npm-publish': ['npm:publish'],
  'git-tag-create': ['git:tag'],
  'git-tag-push': ['git:push'],
  // Preserve already-started legacy plans without silently splitting their grant.
  'git-tag': ['git:tag', 'git:push'],
  'github-release': ['github:release'],
}

function normalizeLegacy(value) {
  const receipts = value.receipts ?? []
  const normalizePlan = (plan) => {
    const defaults = { versionRecommendation: 'none', baseline: null, evidenceMaxAgeMinutes: 30, runs: {}, checkpoints: {}, artifacts: [], changes: [], checkoutContext: null, candidateCheckoutContext: null }
    const normalized = { ...defaults, ...plan }
    const legacyTagStarted = normalized.runs['git-tag'] || normalized.checkpoints['git-tag'] || receipts.some((receipt) => receipt.planId === normalized.id && receipt.stage === 'git-tag')
    if (normalized.kind === 'release' && normalized.stages.includes('git-tag') && !legacyTagStarted) {
      normalized.stages = normalized.stages.flatMap((stage) => stage === 'git-tag' ? ['git-tag-create', 'git-tag-push'] : [stage])
    }
    return normalized
  }
  if (Array.isArray(value.drafts) && Object.hasOwn(value, 'activePlanId')) return {
    ...value,
    plans: (value.plans ?? []).map(normalizePlan),
    reconciliationCheckpoints: value.reconciliationCheckpoints ?? [],
    reconciliations: value.reconciliations ?? [],
  }
  const legacyDigest = 'sha256:legacy-delivery-plan'
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    drafts: [],
    plans: (value.plans ?? []).map((plan) => normalizePlan({
      id: plan.id,
      kind: 'change',
      initiativeId: plan.initiativeId ?? null,
      briefArtifact: null,
      state: plan.state === 'ready' || plan.state === 'completed' ? plan.state : 'blocked',
      repository: 'legacy/unknown',
      base: 'main',
      branch: null,
      version: null,
      versionRecommendation: 'none',
      baseline: null,
      policyDigest: legacyDigest,
      evidenceMaxAgeMinutes: 30,
      checkoutContext: null,
      candidateCheckoutContext: null,
      stages: plan.steps ?? [],
      runs: {},
      checkpoints: {},
      artifacts: [],
      changes: [],
      createdAt: plan.createdAt ?? now(),
      updatedAt: plan.updatedAt ?? now(),
    })),
    receipts: (value.receipts ?? []).map((receipt, index) => ({
      id: `legacy-receipt-${index + 1}`,
      planId: receipt.planId,
      stage: String(receipt.summary ?? 'legacy').split(':')[0],
      checkpointId: null,
      runId: null,
      status: 'succeeded',
      summary: receipt.summary,
      targets: [],
      effects: [],
      proof: receipt.proof?.length ? receipt.proof : ['legacy-receipt'],
      head: null,
      policyDigest: legacyDigest,
      observedAt: receipt.observedAt ?? now(),
    })),
    reconciliationCheckpoints: [],
    reconciliations: [],
    activePlanId: null,
    updatedAt: value.updatedAt ?? now(),
  }
}

async function state(runtime) { return normalizeLegacy(await runtime.overlay.read('state.json', empty())) }
async function save(runtime, value, event) {
  value.updatedAt = now()
  await runtime.contracts.validateSchema('./schemas/delivery-state.schema.json', value, 'Delivery state')
  await runtime.overlay.append('events.jsonl', { at: value.updatedAt, ...event })
  return runtime.overlay.write('state.json', value)
}

async function deliveryPolicy(runtime) {
  const distribution = await runtime.distribution.read()
  const value = distribution.defaults?.delivery
  if (!value) throw new Error('The active distribution does not configure defaults.delivery.')
  await runtime.contracts.validateSchema('./schemas/delivery-policy.schema.json', value, 'Delivery policy')
  return { value, digest: digest(value) }
}

function packet(intent, summary, results, limits = [], routes = [], proof = []) {
  const value = { schemaVersion: 2, protocolVersion: '0.2', planId: `delivery-${hash({ intent, summary, results }).slice(0, 16)}`, intent, status: 'succeeded', summary, results, proof, effects: [], tests: [], limits, routes, byteSize: 0 }
  value.byteSize = Buffer.byteLength(JSON.stringify(value))
  return value
}

function releaseImpact(type, explicit) {
  if (explicit) return explicit
  return ['feat', 'fix', 'perf', 'refactor', 'docs'].includes(type) ? 'user' : ['test', 'build', 'ci', 'chore'].includes(type) ? 'internal' : 'none'
}

async function buildBrief(subject, flags, runtime) {
  const policy = await deliveryPolicy(runtime)
  const type = flags.type ?? 'feat'
  if (!policy.value.branchTypes.includes(type)) throw new Error(`Unsupported delivery type: ${type}`)
  const branch = flags.branch ?? `${type}/${slug(subject)}`
  if (!new RegExp(policy.value.branchPattern).test(branch)) throw new Error(`Branch does not satisfy delivery policy: ${branch}`)
  const brief = {
    id: `brief-${hash({ subject, type, branch, policy: policy.digest }).slice(0, 16)}`,
    subject,
    type,
    outcome: flags.outcome ?? subject,
    acceptance: split(flags.acceptance, '|').length ? split(flags.acceptance, '|') : [`${subject} is implemented and validated.`],
    scope: split(flags.scope).length ? split(flags.scope) : [subject],
    nonGoals: split(flags['non-goals'] ?? flags.nonGoals, '|'),
    releaseImpact: releaseImpact(type, flags['release-impact'] ?? flags.releaseImpact),
    repository: policy.value.repository,
    base: flags.base ?? policy.value.baseBranch,
    branch,
    checks: policy.value.requiredChecks,
    risks: split(flags.risks, '|'),
    confidence: flags.confidence ?? 'medium',
    policyDigest: policy.digest,
    createdAt: now(),
  }
  await runtime.contracts.validateSchema('./schemas/delivery-brief.schema.json', brief, 'Delivery brief')
  return brief
}

function semverRecommendation(changes) {
  const titles = changes.map((item) => (typeof item === 'string' ? item : item.title).replace(/^#\d+\s+/, ''))
  if (titles.some((title) => /!\s*:|BREAKING CHANGE/i.test(title))) return 'major'
  if (titles.some((title) => /^feat(?:\([^)]*\))?:/i.test(title))) return 'minor'
  if (titles.some((title) => /^(fix|perf|refactor)(?:\([^)]*\))?:/i.test(title))) return 'patch'
  return 'none'
}

function releaseChanges(flags) {
  const raw = flags['changes-json'] ? JSON.parse(flags['changes-json']) : split(flags.changes, '|')
  if (!Array.isArray(raw)) throw new Error('changes-json must be an array.')
  return raw.filter((item) => {
    const title = typeof item === 'string' ? item : item.title
    const impact = typeof item === 'string' ? null : item.releaseImpact
    return /^(feat|fix|docs|refactor|perf|test|build|ci|chore)(?:\([^)]*\))?!?:\s+/.test(title ?? '') && impact !== 'none'
  }).map((item) => typeof item === 'string' ? item : `${item.number ? `#${item.number} ` : ''}${item.title}`)
}

async function packageManifest(root, policy) {
  const target = resolve(root, policy.release.versionSource)
  if (relative(root, target).startsWith('..')) throw new Error('release.versionSource escapes the distribution root.')
  const value = JSON.parse(await readFile(target, 'utf8'))
  if (value.name !== policy.release.package) throw new Error(`Release policy package ${policy.release.package} does not match ${value.name}.`)
  return value
}

async function artifact(runtime, { id, type, revision, summary, payload, labels, signals, relations = [] }) {
  const existing = await runtime.artifacts.read(id, revision).catch((error) => ['artifact_not_found', 'artifact_revision_not_found'].includes(error.code) ? null : Promise.reject(error))
  if (existing) return existing
  const envelope = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id,
    type,
    owner: 'hairness/delivery-controls',
    revision,
    runId: revision,
    summary,
    metadata: { labels, signals, relations, freshness: { policy: 'manual' }, provenance: { kind: 'extension', id: 'hairness/delivery-controls', version: '0.2.0-alpha.0' } },
    payload,
    createdAt: now(),
  }
  await runtime.artifacts.stage(revision, envelope)
  await runtime.artifacts.promote(revision)
  return envelope
}

async function changePlan(brief, briefArtifact, runtime, value) {
  const initiative = await runtime.extensions.call('hairness/initiative-controls', 'active').catch(() => null)
  const id = `change-${hash({ kind: 'change', repository: brief.repository, base: brief.base, branch: brief.branch, brief: brief.id }).slice(0, 16)}`
  const existing = value.plans.find((item) => item.id === id)
  if (existing) { value.activePlanId = existing.id; return existing }
  const at = now()
  const policy = await deliveryPolicy(runtime)
  const plan = { id, kind: 'change', initiativeId: initiative?.id ?? null, briefArtifact, state: 'planned', repository: brief.repository, base: brief.base, branch: brief.branch, version: null, versionRecommendation: semverRecommendation([`${brief.type}: ${brief.subject}`]), baseline: null, policyDigest: brief.policyDigest, evidenceMaxAgeMinutes: policy.value.evidenceMaxAgeMinutes, checkoutContext: null, candidateCheckoutContext: null, stages: changeStages, runs: {}, checkpoints: {}, artifacts: [briefArtifact], changes: [brief.subject], createdAt: at, updatedAt: at }
  value.plans.push(plan)
  value.activePlanId = plan.id
  await save(runtime, value, { type: 'delivery.change-planned', id })
  return plan
}

async function acceptBrief(id, runtime, value) {
  const brief = value.drafts.find((item) => item.id === id)
  if (!brief) throw new Error(`Delivery brief draft not found: ${id}`)
  const envelope = await artifact(runtime, { id: `delivery/${brief.id}`, type: 'delivery-brief', revision: brief.id, summary: brief.subject, payload: brief, labels: ['delivery', 'change'], signals: ['delivery.brief'] })
  const plan = await changePlan(brief, envelope.id, runtime, value)
  return { summary: `Accepted ${brief.id} and opened ${plan.id}.`, status: 'ready', artifact: { id: envelope.id, revision: envelope.revision }, plan, limits: [], routes: [`hairness delivery next ${plan.id}`] }
}

async function releasePlan(root, flags, runtime, value) {
  const policy = await deliveryPolicy(runtime)
  const version = flags.version
  if (!version) throw new Error('Release plan requires --version.')
  const manifest = await packageManifest(root, policy.value)
  if (version !== manifest.version) throw new Error(`Release version ${version} does not match ${policy.value.release.versionSource}: ${manifest.version}.`)
  const branch = flags.branch ?? `release/${version}`
  if (!new RegExp(policy.value.branchPattern).test(branch)) throw new Error(`Branch does not satisfy delivery policy: ${branch}`)
  const id = `release-${hash({ kind: 'release', repository: policy.value.repository, base: policy.value.baseBranch, version, policy: policy.digest }).slice(0, 16)}`
  const existing = value.plans.find((item) => item.id === id)
  if (existing) { value.activePlanId = id; return existing }
  const initiative = await runtime.extensions.call('hairness/initiative-controls', 'active').catch(() => null)
  const at = now()
  const changes = releaseChanges(flags)
  const plan = { id, kind: 'release', initiativeId: initiative?.id ?? null, briefArtifact: null, state: 'planned', repository: policy.value.repository, base: policy.value.baseBranch, branch, version, versionRecommendation: semverRecommendation(changes), baseline: flags.baseline ?? policy.value.release.bootstrapBaseline, policyDigest: policy.digest, evidenceMaxAgeMinutes: policy.value.evidenceMaxAgeMinutes, checkoutContext: null, candidateCheckoutContext: null, stages: releaseStages, runs: {}, checkpoints: {}, artifacts: [], changes, createdAt: at, updatedAt: at }
  value.plans.push(plan); value.activePlanId = id
  await save(runtime, value, { type: 'delivery.release-planned', id })
  return plan
}

function compactCheckoutContext(value) {
  if (!value?.handleRef?.id || !value.handleRef.digest || !value.policyDigest) return null
  return { handleRef: { id: value.handleRef.id, digest: value.handleRef.digest }, policyDigest: value.policyDigest }
}

async function resolveCheckout(plan, runtime, { candidate = false, requireWriter = true, sessionId = null } = {}) {
  const stored = candidate ? plan.candidateCheckoutContext : plan.checkoutContext
  if (!stored) return { status: 'blocked', summary: `${candidate ? 'Candidate' : 'Branch'} checkout is not prepared.`, limits: ['Complete the corresponding Worktree boundary first.'] }
  const resolved = await runtime.extensions.call('hairness/worktree-controls', 'resolve', { planId: plan.id, worktreeId: stored.handleRef.id, requireWriter, ...(sessionId ? { sessionId } : {}) })
  const liveDigest = resolved.digest ?? resolved.context?.handleRef?.digest ?? resolved.handle?.digest
  if (resolved.status !== 'ready' && resolved.status !== 'managed') return { status: 'blocked', summary: resolved.summary ?? 'Managed checkout is unavailable.', limits: resolved.limits?.length ? resolved.limits : ['Reconcile the worktree before continuing.'] }
  if (!resolved.handle || !resolved.context || liveDigest !== stored.handleRef.digest) return { status: 'blocked', summary: 'Managed checkout evidence changed after the last accepted receipt.', limits: ['Resolve or reconcile the new WorktreeHandle before continuing.'] }
  if (resolved.handle.planId !== plan.id || resolved.context.policyDigest !== plan.policyDigest || resolved.handle.policyDigest !== plan.policyDigest) return { status: 'blocked', summary: 'Managed checkout ownership or policy is stale.', limits: ['Re-plan or reconcile the checkout under the current delivery policy.'] }
  if (candidate) {
    if (!resolved.handle.detached || resolved.handle.kind !== 'candidate') return { status: 'blocked', summary: 'Release qualification requires the detached candidate checkout.', limits: ['Create the exact candidate checkout before qualifying.'] }
  } else if (resolved.handle.branch !== plan.branch || resolved.handle.detached) return { status: 'blocked', summary: 'Managed checkout no longer matches the delivery branch.', limits: ['Reconcile the branch WorktreeHandle before continuing.'] }
  if (requireWriter && (!resolved.lease || resolved.lease.mode !== 'writer' || resolved.lease.state !== 'active' || resolved.lease.planId !== plan.id)) return { status: 'blocked', summary: 'The delivery plan does not hold the exact writer lease.', limits: ['Handoff or takeover the managed checkout explicitly.'] }
  return { status: 'ready', ...resolved }
}

async function refreshCheckoutReference(plan, runtime, { candidate = false, expectedHead = null } = {}) {
  const stored = candidate ? plan.candidateCheckoutContext : plan.checkoutContext
  if (!stored) return null
  const resolved = await runtime.extensions.call('hairness/worktree-controls', 'resolve', { planId: plan.id, worktreeId: stored.handleRef.id, requireWriter: true })
  const compact = compactCheckoutContext(resolved.context)
  if (!compact || !resolved.handle || resolved.handle.planId !== plan.id || compact.policyDigest !== plan.policyDigest) throw new Error('Managed checkout changed ownership or policy while recording its effect receipt.')
  if (expectedHead && resolved.context.head !== expectedHead) throw new Error('Managed checkout HEAD does not match the correlated effect receipt.')
  if (candidate) plan.candidateCheckoutContext = compact
  else plan.checkoutContext = compact
  return resolved
}

function worktreeRequest(plan, stage, flags) {
  if (stage === 'prepare') return { repository: { kind: 'workspace' }, planId: plan.id, branch: plan.branch, base: plan.base, mode: 'branch', policyDigest: plan.policyDigest }
  if (stage === 'sync-base') return { repository: { kind: 'workspace' }, planId: plan.id, worktreeId: plan.checkoutContext?.handleRef.id, base: plan.base, mode: 'branch', expectedHead: flags.head, published: Boolean(flags.published), ...(flags['remote-head'] ? { remoteHead: flags['remote-head'] } : {}), proof: flags['base-head'] ? [`base-head:${flags['base-head']}`] : [], policyDigest: plan.policyDigest }
  if (stage === 'candidate-checkout') return { repository: { kind: 'workspace' }, planId: plan.id, commit: flags.head, base: plan.base, mode: 'detached', policyDigest: plan.policyDigest }
  return null
}

function reconciliationFor(value, plan, receipt) {
  return value.reconciliations.findLast((item) => item.planId === plan.id && item.receiptId === receipt.id && item.policyDigest === plan.policyDigest)
}

function latestStageReceipt(value, plan, stage) {
  return value.receipts.findLast((item) => item.planId === plan.id && item.stage === stage && item.policyDigest === plan.policyDigest) ?? null
}

function acceptedReceipt(value, plan, item) {
  return item.status === 'succeeded' || reconciliationFor(value, plan, item)?.decision === 'accept-deviation'
}

function latestAcceptedHead(value, plan, stage) {
  return value.receipts.findLast((item) => item.planId === plan.id && item.stage === stage && item.policyDigest === plan.policyDigest && acceptedReceipt(value, plan, item) && item.head)?.head ?? null
}

function latestBranchHead(value, plan) {
  const stages = new Set(['sync-base', 'publish-pr', 'release-pr'])
  return value.receipts.findLast((item) => item.planId === plan.id && stages.has(item.stage) && item.policyDigest === plan.policyDigest && acceptedReceipt(value, plan, item) && item.head)?.head ?? null
}

function expectedHead(value, plan, stage, supplied) {
  const branchHeadStages = plan.kind === 'release'
    ? new Set(['release-pr', 'ci', 'sync-base', 'merge'])
    : new Set(['sync-base', 'qualify', 'publish-pr', 'ci', 'merge'])
  const candidateHeadStages = new Set(['candidate-checkout', 'qualify', 'npm-publish', 'git-tag-create', 'git-tag-push', 'github-release'])
  if (supplied && stage === 'verify-main') return supplied
  if (stage === 'sync-base') return latestAcceptedHead(value, plan, 'sync-base')
  if (stage === 'qualify' && plan.kind === 'change') return latestAcceptedHead(value, plan, 'sync-base')
  if (branchHeadStages.has(stage)) return latestBranchHead(value, plan)
  if (plan.kind === 'release' && candidateHeadStages.has(stage)) return latestAcceptedHead(value, plan, 'candidate-checkout')
  return null
}

function successfulReceipt(value, plan, stage, head) {
  const requiredHead = expectedHead(value, plan, stage, head)
  const item = value.receipts.findLast((candidate) => candidate.planId === plan.id && candidate.stage === stage && candidate.policyDigest === plan.policyDigest)
  if (!item) return null
  const reconciliation = reconciliationFor(value, plan, item)
  const accepted = item.status === 'succeeded' || reconciliation?.decision === 'accept-deviation'
  const observedAt = reconciliation?.observedAt ?? item.observedAt
  const stale = observeStages.has(stage) && Date.now() - Date.parse(observedAt) > plan.evidenceMaxAgeMinutes * 60_000
  const headMatches = !requiredHead || ['prepare', 'implement'].includes(stage) || item.head === requiredHead
  return accepted && !stale && headMatches ? item : null
}

function pendingStage(value, plan) {
  return plan.stages.find((stage) => !successfulReceipt(value, plan, stage)) ?? null
}

function pendingReconciliation(value, plan, stage) {
  const receipt = latestStageReceipt(value, plan, stage)
  if (!receipt || receipt.status === 'succeeded') return null
  return { receipt, reconciliation: reconciliationFor(value, plan, receipt) ?? null }
}

async function refreshRunReceipt(plan, stage, runtime, value) {
  const runId = plan.runs[stage]
  if (!runId || value.receipts.some((item) => item.planId === plan.id && item.stage === stage && item.runId === runId && acceptedReceipt(value, plan, item))) return null
  const result = await runtime.runs.result(runId)
  if (!result) return null
  const outcome = result.outcome ?? result
  const receipt = outcome?.receipt ?? outcome
  if (!receipt?.status) return null
  if (receipt.status === 'succeeded' && worktreeStages.has(stage)) {
    if (receipt.runId !== runId || receipt.checkpointId !== plan.checkpoints[stage] || receipt.action !== worktreeStages.get(stage)) throw new Error(`${stage} CheckoutReceipt is not correlated to its exact Run, checkpoint and action.`)
    const context = outcome.checkoutContext ?? receipt.context
    const compact = compactCheckoutContext(context)
    if (!compact) throw new Error(`${stage} succeeded without a typed CheckoutContext.`)
    if (compact.policyDigest !== plan.policyDigest || receipt.policyDigest !== plan.policyDigest) throw new Error(`${stage} returned a CheckoutContext for a stale policy.`)
    if (stage === 'candidate-checkout') plan.candidateCheckoutContext = compact
    else plan.checkoutContext = compact
  } else if (receipt.status === 'succeeded' && checkoutKindForStage(plan, stage)) {
    await refreshCheckoutReference(plan, runtime, { candidate: checkoutKindForStage(plan, stage) === 'candidate', expectedHead: receipt.head })
  }
  return recordReceipt(plan, stage, { runId, checkpointId: plan.checkpoints[stage], status: receipt.status, summary: receipt.summary ?? result.summary, targets: receipt.targets ?? [], effects: receipt.effects ?? [], proof: receipt.proof?.length ? receipt.proof : result.proof, head: receipt.head ?? null }, runtime, value)
}

async function recordReceipt(plan, stage, input, runtime, value) {
  if (!plan.stages.includes(stage)) throw new Error(`${stage} is not part of ${plan.id}.`)
  const proof = input.proof ?? []
  if (!proof.length) throw new Error('Delivery receipt requires proof.')
  if (!observeStages.has(stage)) {
    if (!plan.runs[stage] || input.runId !== plan.runs[stage] || input.checkpointId !== plan.checkpoints[stage]) throw new Error(`Receipt for ${stage} is not correlated to its exact Run and checkpoint.`)
    const expectedEffects = effectsByStage[stage] ?? []
    if (input.status === 'succeeded' && expectedEffects.some((effect) => !(input.effects ?? []).includes(effect))) throw new Error(`Receipt for ${stage} is missing an expected effect.`)
  }
  const id = `receipt-${hash({ plan: plan.id, stage, checkpoint: input.checkpointId ?? null, run: input.runId ?? null, proof }).slice(0, 16)}`
  const existing = value.receipts.find((item) => item.id === id)
  if (existing) return existing
  const receipt = { id, planId: plan.id, stage, checkpointId: input.checkpointId ?? null, runId: input.runId ?? null, status: input.status ?? 'succeeded', summary: input.summary ?? `${stage}: completed`, targets: input.targets ?? [], effects: input.effects ?? [], proof, head: input.head ?? null, policyDigest: plan.policyDigest, observedAt: now() }
  value.receipts.push(receipt)
  plan.updatedAt = receipt.observedAt
  plan.state = receipt.status === 'succeeded' ? (pendingStage(value, plan) ? 'in-progress' : 'completed') : 'blocked'
  await save(runtime, value, { type: 'delivery.received', id: plan.id, stage, receipt: id, status: receipt.status })
  return receipt
}

function reconciliationTarget(plan, stage, receiptId) {
  return `delivery://local/${encodeURIComponent(plan.repository)}/${encodeURIComponent(plan.id)}/${encodeURIComponent(stage)}/${encodeURIComponent(receiptId)}`
}

async function reconcileReceipt(plan, flags, runtime, value) {
  if (flags.checkpoint) {
    if (flags.auto) return { summary: 'Automatic progression cannot accept a reconciliation decision.', status: 'blocked', limits: ['Remove --auto and approve the exact displayed checkpoint.'], routes: [`hairness delivery reconcile ${plan.id} --checkpoint ${flags.checkpoint}`] }
    const checkpoint = value.reconciliationCheckpoints.find((item) => item.id === flags.checkpoint && item.planId === plan.id)
    if (!checkpoint) throw new Error(`Reconciliation checkpoint not found: ${flags.checkpoint}`)
    const policy = await deliveryPolicy(runtime)
    if (policy.digest !== plan.policyDigest || checkpoint.policyDigest !== plan.policyDigest) return { summary: 'Reconciliation policy changed after checkpoint preparation.', status: 'blocked', limits: ['Re-plan or prepare a new reconciliation checkpoint.'], routes: [`hairness delivery next ${plan.id}`] }
    if (Date.now() - Date.parse(checkpoint.createdAt) > plan.evidenceMaxAgeMinutes * 60_000) return { summary: 'Reconciliation proof is stale.', status: 'blocked', limits: ['Re-observe the external target and prepare a new checkpoint.'], routes: [`hairness delivery reconcile ${plan.id} --stage ${checkpoint.stage} --receipt ${checkpoint.receiptId} --decision ${checkpoint.decision}`] }
    const receipt = value.receipts.find((item) => item.id === checkpoint.receiptId && item.planId === plan.id && item.stage === checkpoint.stage)
    if (!receipt || digest(receipt) !== checkpoint.receiptDigest || latestStageReceipt(value, plan, checkpoint.stage)?.id !== receipt.id) return { summary: 'The receipt changed after reconciliation preparation.', status: 'blocked', limits: ['Re-observe the latest receipt before deciding.'], routes: [`hairness delivery next ${plan.id}`] }
    const existing = reconciliationFor(value, plan, receipt)
    if (existing) return { summary: `Receipt ${receipt.id} is already reconciled.`, status: existing.decision === 'abort' ? 'blocked' : 'ready', reconciliation: existing, limits: [], routes: [`hairness delivery next ${plan.id}`] }
    const observedAt = now()
    const reconciliation = {
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: `reconciliation-${hash({ checkpoint: checkpoint.id, receipt: checkpoint.receiptDigest }).slice(0, 16)}`,
      planId: plan.id,
      stage: checkpoint.stage,
      receiptId: receipt.id,
      checkpointId: checkpoint.id,
      decision: checkpoint.decision,
      reason: checkpoint.reason,
      proof: checkpoint.proof,
      target: checkpoint.target,
      receiptDigest: checkpoint.receiptDigest,
      policyDigest: checkpoint.policyDigest,
      observedAt,
    }
    value.reconciliations.push(reconciliation)
    if (reconciliation.decision === 'retry') {
      delete plan.runs[reconciliation.stage]
      delete plan.checkpoints[reconciliation.stage]
      plan.state = 'in-progress'
    } else if (reconciliation.decision === 'abort') plan.state = 'blocked'
    else plan.state = pendingStage(value, plan) ? 'in-progress' : 'completed'
    plan.updatedAt = observedAt
    await save(runtime, value, { type: 'delivery.reconciled', id: plan.id, stage: reconciliation.stage, receipt: receipt.id, reconciliation: reconciliation.id, decision: reconciliation.decision })
    const retryLimit = reconciliation.decision === 'retry' ? ['Retry requires fresh source proof; a quarantined target lock must be resolved separately before another effect grant.'] : []
    return { summary: `${receipt.id} reconciled with ${reconciliation.decision}.`, status: reconciliation.decision === 'abort' ? 'blocked' : 'ready', reconciliation, limits: retryLimit, routes: reconciliation.decision === 'abort' ? [] : [`hairness delivery next ${plan.id}`] }
  }

  const stage = flags.stage ?? pendingStage(value, plan)
  if (!stage || !plan.stages.includes(stage)) throw new Error(`Reconciliation stage is not part of ${plan.id}: ${stage}`)
  const receipt = flags.receipt
    ? value.receipts.find((item) => item.id === flags.receipt && item.planId === plan.id && item.stage === stage)
    : latestStageReceipt(value, plan, stage)
  if (!receipt) throw new Error(`No receipt is available to reconcile for ${stage}.`)
  if (latestStageReceipt(value, plan, stage)?.id !== receipt.id) throw new Error(`Reconciliation requires the latest ${stage} receipt.`)
  if (receipt.status === 'succeeded') throw new Error(`Receipt ${receipt.id} already succeeded.`)
  const existing = reconciliationFor(value, plan, receipt)
  if (existing) return { summary: `Receipt ${receipt.id} is already reconciled.`, status: existing.decision === 'abort' ? 'blocked' : 'ready', reconciliation: existing, limits: [], routes: [`hairness delivery next ${plan.id}`] }
  const decision = flags.decision
  if (!reconciliationDecisions.has(decision)) throw new Error('Reconciliation requires --decision accept-deviation|retry|abort.')
  if (decision === 'accept-deviation' && !['partial', 'unknown'].includes(receipt.status)) throw new Error(`A ${receipt.status} receipt cannot be accepted as a deviation.`)
  const reason = String(flags.reason ?? '').trim()
  const proof = split(flags.proof)
  if (!reason || !proof.length) throw new Error('Reconciliation requires --reason and fresh --proof.')
  const policy = await deliveryPolicy(runtime)
  if (policy.digest !== plan.policyDigest || receipt.policyDigest !== plan.policyDigest) return { summary: 'Reconciliation policy or receipt is stale.', status: 'blocked', limits: ['Re-plan before accepting a changed policy.'], routes: [`hairness delivery next ${plan.id}`] }
  const target = reconciliationTarget(plan, stage, receipt.id)
  const receiptDigest = digest(receipt)
  const checkpoint = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `reconcile-${hash({ plan: plan.id, stage, receipt: receipt.id, decision, reason, proof, policy: plan.policyDigest }).slice(0, 20)}`,
    planId: plan.id,
    stage,
    receiptId: receipt.id,
    decision,
    reason,
    proof,
    target,
    receiptDigest,
    policyDigest: plan.policyDigest,
    createdAt: now(),
  }
  const stored = value.reconciliationCheckpoints.find((item) => item.id === checkpoint.id)
  if (!stored) {
    value.reconciliationCheckpoints.push(checkpoint)
    await save(runtime, value, { type: 'delivery.reconciliation-prepared', id: plan.id, stage, receipt: receipt.id, checkpoint: checkpoint.id, decision })
  }
  return {
    summary: `${decision} is prepared for ${receipt.id} and needs exact authority.`,
    status: 'needs-authority',
    planId: plan.id,
    stage,
    receipt,
    checkpoint: stored ?? checkpoint,
    effects: [],
    limits: ['No external target effect occurred. --auto cannot apply this decision.'],
    routes: [`hairness delivery reconcile ${plan.id} --checkpoint ${(stored ?? checkpoint).id}`],
  }
}

function checkoutKindForStage(plan, stage) {
  if (plan.kind === 'release' && ['qualify', 'npm-publish', 'git-tag-create', 'git-tag-push', 'github-release'].includes(stage)) return 'candidate'
  if (['implement', 'sync-base', 'publish-pr', 'release-pr', 'ci', 'merge'].includes(stage) || (plan.kind === 'change' && stage === 'qualify')) return 'branch'
  return null
}

function defaultTargets(root, plan, stage, policy, checkout = null) {
  const repository = `github://${plan.repository}`
  if (stage === 'prepare') return [`${repository}/branches/${plan.branch}`]
  if (stage === 'candidate-checkout') return [`${repository}/commits/${encodeURIComponent(plan.version ?? 'candidate')}`]
  if (stage === 'implement' || stage === 'sync-base') return checkout?.context?.path ? [checkout.context.path] : [root]
  if (stage === 'publish-pr' || stage === 'release-pr') return [checkout?.context?.path ?? root, `${repository}/branches/${plan.branch}`, `${repository}/pulls/${plan.branch}`]
  if (stage === 'merge') return [`${repository}/pulls/${plan.branch}`]
  if (stage === 'npm-publish') return [`npm://${new URL(policy.release.registry).host}/${encodeURIComponent(policy.release.package)}/${plan.version}`]
  if (stage === 'git-tag-create') return [checkout?.context?.path ?? root]
  if (stage === 'git-tag-push') return [`${repository}/tags/${policy.release.gitTagFormat.replace('{version}', plan.version)}`]
  if (stage === 'git-tag') return [root, `${repository}/tags/${policy.release.gitTagFormat.replace('{version}', plan.version)}`]
  if (stage === 'github-release') return [`${repository}/releases/${policy.release.gitTagFormat.replace('{version}', plan.version)}`]
  return []
}

async function pullRequestProposal(plan, stage, checkpointId, flags, policy, runtime) {
  const brief = plan.briefArtifact ? await runtime.artifacts.read(plan.briefArtifact).catch(() => null) : null
  const files = split(flags.files)
  const releaseImpact = brief?.payload?.releaseImpact ?? (plan.kind === 'release' ? 'none' : 'internal')
  const suppliedBody = flags.body ?? ''
  const body = /(?:^|\n)releaseImpact:\s*(?:user|internal|none)(?:\n|$)/i.test(suppliedBody) ? suppliedBody : `${suppliedBody}${suppliedBody ? '\n\n' : ''}releaseImpact: ${releaseImpact}`
  const payload = { planId: plan.id, repository: plan.repository, base: plan.base, branch: plan.branch, head: flags.head, title: flags.title ?? (plan.kind === 'release' ? `chore(release): prepare ${plan.version}` : `${brief?.payload?.type ?? 'feat'}: ${brief?.payload?.subject ?? plan.changes[0] ?? 'deliver change'}`), body, files, diffDigest: flags['diff-digest'], checks: policy.requiredChecks, releaseImpact, policyDigest: plan.policyDigest, observedAt: now() }
  const title = /^(feat|fix|docs|refactor|perf|test|build|ci|chore|release)(?:\(([a-z0-9-]+)\))?!?:\s+.+$/.exec(payload.title)
  if (!title) throw new Error(`Pull request title is not Conventional: ${payload.title}`)
  const branchType = plan.branch.split('/')[0]
  if (!(title[1] === branchType || (branchType === 'release' && title[1] === 'chore' && title[2] === 'release'))) throw new Error(`Pull request title type ${title[1]} does not match branch type ${branchType}.`)
  await runtime.contracts.validateSchema('./schemas/pull-request-proposal.schema.json', payload, 'Pull request proposal')
  return artifact(runtime, { id: `delivery/pr-${hash(plan.id).slice(0, 16)}`, type: 'pull-request-proposal', revision: checkpointId, summary: payload.title, payload, labels: ['delivery', 'pull-request'], signals: ['delivery.pull-request'], relations: [] })
}

async function prepareCheckpoint(root, plan, stage, flags, runtime, value) {
  const pending = pendingStage(value, plan, flags.head)
  const staleBaseSync = stage === 'sync-base' && pending === 'merge' && Boolean(flags['base-stale']) && Boolean(flags['base-head'])
  if (stage !== pending && !staleBaseSync) throw new Error(`Stage ${stage} is not the next unresolved boundary.`)
  if (observeStages.has(stage)) return { summary: `${stage} requires fresh read-only proof.`, status: 'needs-proof', planId: plan.id, stage, limits: [], routes: [`hairness delivery receipt ${plan.id} --stage ${stage} --proof <evidence> --head ${flags.head ?? '<head>'}`] }
  const unresolved = pendingReconciliation(value, plan, stage)
  if (unresolved && !unresolved.reconciliation) return { summary: `${stage} has an unresolved ${unresolved.receipt.status} receipt.`, status: 'blocked', limits: ['Reconcile the exact receipt before preparing another effect.'], routes: [`hairness delivery reconcile ${plan.id} --stage ${stage} --receipt ${unresolved.receipt.id} --decision <accept-deviation|retry|abort> --reason <reason> --proof <evidence>`] }
  if (unresolved?.reconciliation?.decision === 'abort') return { summary: `${stage} was explicitly aborted.`, status: 'blocked', limits: ['The delivery plan cannot progress after an abort decision.'], routes: [] }
  const currentPolicy = await deliveryPolicy(runtime)
  if (currentPolicy.digest !== plan.policyDigest) return { summary: 'Delivery policy changed after planning.', status: 'blocked', limits: ['Re-plan before preparing effects.'], routes: [`hairness delivery plan --kind ${plan.kind}`] }
  const checkoutKind = checkoutKindForStage(plan, stage)
  const checkout = checkoutKind ? await resolveCheckout(plan, runtime, { candidate: checkoutKind === 'candidate', requireWriter: true, sessionId: flags.session }) : null
  if (checkout?.status === 'blocked') return { summary: checkout.summary, status: 'blocked', planId: plan.id, stage, limits: checkout.limits, routes: [`hairness worktree reconcile --plan ${plan.id}`] }
  if (flags.head && checkout?.context?.head && flags.head !== checkout.context.head && !['merge', 'npm-publish', 'git-tag-push', 'github-release'].includes(stage)) return { summary: `${stage} proof does not match the live managed checkout HEAD.`, status: 'blocked', limits: ['Re-inspect the exact WorktreeHandle before preparing authority.'], routes: [`hairness worktree show ${checkout.handle.id}`] }
  let worktreeProposal = null
  const worktreeAction = worktreeStages.get(stage)
  if (worktreeAction) worktreeProposal = await runtime.extensions.call('hairness/worktree-controls', 'propose', { action: worktreeAction, request: worktreeRequest(plan, stage, flags) })
  const effects = worktreeProposal?.effects ?? effectsByStage[stage] ?? []
  if (!effects.length) throw new Error(`Stage ${stage} has no executor effect mapping.`)
  const targets = split(flags.targets).length ? split(flags.targets) : worktreeProposal?.targets ?? defaultTargets(root, plan, stage, currentPolicy.value, checkout)
  if (['publish-pr', 'release-pr'].includes(stage) && (!flags.head || !flags['diff-digest'] || !split(flags.files).length)) throw new Error(`${stage} requires --head, --diff-digest and --files from an inspected diff.`)
  if (['merge', 'candidate-checkout', 'npm-publish', 'git-tag-create', 'git-tag-push', 'git-tag', 'github-release'].includes(stage) && !flags.head) throw new Error(`${stage} requires the exact --head commit.`)
  if (stage === 'sync-base' && flags.published && !flags['remote-head']) throw new Error('Published sync-base requires the exact --remote-head for force-with-lease.')
  if (stage === 'merge') {
    const pullRequestStage = plan.kind === 'release' ? 'release-pr' : 'publish-pr'
    const pullRequest = successfulReceipt(value, plan, pullRequestStage)
    const ci = successfulReceipt(value, plan, 'ci', flags.head)
    if (!pullRequest?.head || pullRequest.head !== flags.head || !ci) return { summary: 'Merge proof does not match the pull-request head.', status: 'blocked', limits: ['Re-observe the pull request and CI for the exact head before merging.'], routes: [`hairness delivery next ${plan.id}`] }
  }
  if (stage === 'npm-publish' && !plan.artifacts.some((id) => id.startsWith('release/'))) return { summary: 'npm-publish requires a promoted ReleaseCandidate.', status: 'blocked', limits: ['Prepare and inspect the ReleaseCandidate first.'], routes: [`hairness delivery release-candidate ${plan.id}`] }
  if (stage === 'git-tag-push' && !successfulReceipt(value, plan, 'git-tag-create', flags.head)) return { summary: 'git-tag-push requires the exact local tag creation receipt.', status: 'blocked', limits: ['Create and verify the annotated tag before pushing it.'], routes: [`hairness delivery next ${plan.id}`] }
  if (stage === 'github-release' && plan.stages.includes('git-tag-push') && !successfulReceipt(value, plan, 'git-tag-push', flags.head)) return { summary: 'github-release requires the exact pushed tag receipt.', status: 'blocked', limits: ['Push and verify the tag before creating the GitHub Release.'], routes: [`hairness delivery next ${plan.id}`] }
  if (['npm-publish', 'git-tag-create', 'git-tag-push', 'git-tag', 'github-release'].includes(stage)) {
    const candidateId = plan.artifacts.find((id) => id.startsWith('release/'))
    const candidate = candidateId ? await runtime.artifacts.read(candidateId).catch(() => null) : null
    if (!candidate || candidate.payload.commit !== flags.head) return { summary: `${stage} does not match the qualified release commit.`, status: 'blocked', limits: ['Use the exact public commit recorded in the ReleaseCandidate.'], routes: [`hairness delivery release-candidate ${plan.id}`] }
  }
  const proof = split(flags.proof).length ? split(flags.proof) : [`plan:${plan.id}`, `policy:${plan.policyDigest}`, ...(flags.head ? [`head:${flags.head}`] : []), ...(flags['base-head'] ? [`base-head:${flags['base-head']}`] : []), ...(flags['diff-digest'] ? [`diff:${flags['diff-digest']}`] : [])]
  const runId = `delivery-${hash({ plan: plan.id, stage, targets, effects, proof, diffDigest: flags['diff-digest'] ?? null }).slice(0, 20)}`
  const checkpointId = `checkpoint-${hash({ runId, plan: plan.id, stage, targets, effects, proof }).slice(0, 20)}`
  const operation = worktreeAction ? { capability: 'hairness/worktree', id: worktreeAction } : { capability: 'hairness/delivery', id: 'execute' }
  const contextPlanId = `context-${hash({ plan: plan.id, stage, runId }).slice(0, 20)}`
  const fanIn = `${contextPlanId}-fan-in`
  if (staleBaseSync && plan.runs[stage] && successfulReceipt(value, plan, stage)) {
    delete plan.runs[stage]
    delete plan.checkpoints[stage]
  }
  if (plan.runs[stage] && plan.runs[stage] !== runId) return { summary: `${stage} proof changed after checkpoint preparation.`, status: 'blocked', planId: plan.id, stage, limits: ['Reconcile or cancel the existing Run before preparing a new head or diff.'], routes: [`hairness run ${plan.runs[stage]} show`] }
  let proposal = null
  if (stage === 'publish-pr' || stage === 'release-pr') {
    proposal = await pullRequestProposal(plan, stage, checkpointId, flags, currentPolicy.value, runtime)
    if (!plan.artifacts.includes(proposal.id)) plan.artifacts.push(proposal.id)
  }
  if (!plan.runs[stage]) {
    const exclusions = ['scope expansion', 'main push', stage === 'sync-base' && flags.published ? 'force push without lease' : 'force push', 'implicit next boundary', 'nested subagents']
    const resultSchema = worktreeAction ? 'CheckoutReceipt' : 'ChangeReceipt'
    const route = { schemaVersion: 2, protocolVersion: '0.2', id: runId, operation, kind: worktreeAction ? 'deterministic' : 'worker', ...(worktreeAction ? {} : { profile: 'executor' }), requirement: 'required', resultSchema, fanIn, workload: 'balanced' }
    await runtime.plans.write({ schemaVersion: 2, protocolVersion: '0.2', id: contextPlanId, intent: { schemaVersion: 2, protocolVersion: '0.2', id: `${contextPlanId}-intent`, summary: `Execute ${stage} for ${plan.id}.`, outcome: `${stage} returns one typed ${resultSchema}.`, targets, limits: [] }, routes: [route], fanIn: { id: fanIn, mode: 'mechanical' } })
    await runtime.runs.create({ id: runId, planId: contextPlanId, assignment: { schemaVersion: 2, protocolVersion: '0.2', id: `execute-${stage}-${plan.id}`, operation, profile: 'executor', goal: `Execute only ${stage} for ${plan.id}.`, outcome: `One ${resultSchema} for ${stage}.`, workload: 'balanced', budget: 1, inputs: [{ deliveryPlan: { ...plan, checkoutContext: plan.checkoutContext, candidateCheckoutContext: plan.candidateCheckoutContext } }, { stage }, { expectedProof: proof }, ...(checkout ? [{ resolvedCheckout: checkout.context }] : []), ...(worktreeProposal ? [{ checkoutProposal: worktreeProposal }] : []), ...(proposal ? [{ pullRequestProposal: { id: proposal.id, revision: proposal.revision, diffDigest: proposal.payload.diffDigest } }] : [])], targets, exclusions, allowedSources: ['git:read', 'github:read', 'npm:read'], requestedEffects: effects, result: { schema: resultSchema, disposition: 'effect' } } })
    await runtime.runs.transition(runId, 'ready')
    await runtime.runs.transition(runId, 'needs-authority')
    plan.runs[stage] = runId
    plan.checkpoints[stage] = checkpointId
  }
  const checkpoint = await runtime.runs.proposeCheckpoint({ schemaVersion: 2, protocolVersion: '0.2', id: checkpointId, runId, mode: ['implement', 'prepare', 'sync-base', 'candidate-checkout'].includes(stage) ? 'mutation' : 'external', intent: `Execute ${stage} for ${plan.id}.`, targets, effects, exclusions: ['scope expansion', 'main push', stage === 'sync-base' && flags.published ? 'force push without lease' : 'force push', 'implicit next boundary'], risk: `Performs the exact ${stage} boundary on declared targets.`, proof, approved: false })
  plan.updatedAt = now(); plan.state = 'in-progress'
  await save(runtime, value, { type: 'delivery.checkpoint-prepared', id: plan.id, stage, runId, checkpointId })
  return { summary: `${stage} is prepared and needs exact authority.`, status: 'needs-authority', planId: plan.id, stage, runId, checkpoint, capsule: await runtime.runs.capsule(runId), limits: ['No target effect occurred.'], routes: [`hairness run ${runId} approve --checkpoint ${checkpoint.id} --json`] }
}

async function releaseCandidate(plan, flags, runtime, value) {
  const required = ['collect', 'prepare', 'release-pr', 'ci', 'sync-base', 'merge', 'verify-main', 'candidate-checkout', 'qualify']
  for (const stage of required) if (!successfulReceipt(value, plan, stage)) return { summary: 'Release qualification proof is incomplete.', status: 'blocked', limits: [`Missing ${stage} receipt.`], routes: [`hairness delivery next ${plan.id}`] }
  const pullRequest = successfulReceipt(value, plan, 'release-pr')
  const branchHead = latestBranchHead(value, plan)
  if (!pullRequest.head || pullRequest.head !== branchHead || !successfulReceipt(value, plan, 'ci', branchHead) || !successfulReceipt(value, plan, 'merge', branchHead)) return { summary: 'Release pull-request proof is stale or refers to a different head.', status: 'blocked', limits: ['Release PR, CI, sync and merge receipts must agree on the exact pull-request head.'], routes: [`hairness delivery next ${plan.id}`] }
  if (!flags.commit || !successfulReceipt(value, plan, 'verify-main', flags.commit) || !successfulReceipt(value, plan, 'qualify', flags.commit)) return { summary: 'Release qualification does not match the public commit.', status: 'blocked', limits: ['Verify main and qualify the exact commit supplied to the ReleaseCandidate.'], routes: [`hairness delivery next ${plan.id}`] }
  const candidateCheckout = await resolveCheckout(plan, runtime, { candidate: true, requireWriter: true, sessionId: flags.session })
  if (candidateCheckout.status === 'blocked') return { summary: candidateCheckout.summary, status: 'blocked', limits: candidateCheckout.limits, routes: [`hairness worktree reconcile --plan ${plan.id}`] }
  if (candidateCheckout.context.head !== flags.commit || candidateCheckout.handle.head !== flags.commit) return { summary: 'ReleaseCandidate commit does not match the detached checkout.', status: 'blocked', limits: ['Qualify only the exact public commit resolved from the candidate WorktreeHandle.'], routes: [`hairness worktree show ${candidateCheckout.handle.id}`] }
  const policy = await deliveryPolicy(runtime)
  if (policy.digest !== plan.policyDigest) return { summary: 'Release policy is stale.', status: 'blocked', limits: ['Re-plan the release.'], routes: [] }
  const payload = { planId: plan.id, policyDigest: plan.policyDigest, checkoutContext: plan.candidateCheckoutContext, package: { name: policy.value.release.package, version: plan.version, registry: policy.value.release.registry, distTag: policy.value.release.prereleaseTag }, commit: flags.commit, changes: plan.changes, checks: policy.value.requiredChecks, tarball: { path: flags.tarball, sha256: flags.sha256, integrity: flags.integrity }, dryRun: flags['dry-run'] ?? flags.dryRun, limitations: split(flags.limitations, '|'), observedAt: now() }
  await runtime.contracts.validateSchema('./schemas/release-candidate.schema.json', payload, 'Release candidate')
  const revision = `candidate-${hash(payload).slice(0, 16)}`
  const envelope = await artifact(runtime, { id: `release/${slug(plan.version)}`, type: 'release-candidate', revision, summary: `${policy.value.release.package}@${plan.version}`, payload, labels: ['release', 'npm'], signals: ['release.candidate'] })
  if (!plan.artifacts.includes(envelope.id)) plan.artifacts.push(envelope.id)
  plan.state = 'ready'; plan.updatedAt = now()
  await save(runtime, value, { type: 'delivery.release-candidate', id: plan.id, artifact: envelope.id, revision })
  return envelope
}

export async function handleCommand({ root, target, action, rest = [], flags, runtime }) {
  const value = await state(runtime)
  const mode = target ?? 'status'
  if (mode === 'status') return { ...value, limits: value.plans.some((plan) => plan.policyDigest === 'sha256:legacy-delivery-plan') ? ['Legacy delivery plans remain historical and cannot satisfy current gates.'] : [], routes: [] }
  if (mode === 'want') {
    const subject = flags.subject ?? [action, ...rest].filter(Boolean).join(' ')
    if (!subject) throw new Error('Usage: hairness delivery want <subject> [--type feat|fix|...]')
    const brief = await buildBrief(subject, flags, runtime)
    const existing = value.drafts.find((item) => item.id === brief.id)
    if (!existing) { value.drafts.push(brief); await save(runtime, value, { type: 'delivery.brief-drafted', id: brief.id }) }
    return packet('want ship', `Delivery brief draft for ${subject}.`, [existing ?? brief], ['Draft only; acceptance is required before a plan exists.'], [`hairness delivery accept ${brief.id}`])
  }
  if (mode === 'accept') return acceptBrief(action ?? flags.brief, runtime, value)
  if (mode === 'plan') {
    if ((flags.kind ?? 'change') === 'release') return releasePlan(root, flags, runtime, value)
    const briefId = flags.brief ?? action
    if (!briefId) throw new Error('Change plan requires --brief <draft-id>; use delivery want first.')
    return acceptBrief(briefId, runtime, value)
  }
  const plan = value.plans.find((item) => item.id === (action ?? flags.plan ?? value.activePlanId))
  if (!plan) {
    const draft = value.drafts.at(-1)
    if (mode === 'next' && draft) return packet('ship it', `${draft.id} needs acceptance.`, [{ status: 'needs-acceptance', brief: draft }], ['No DeliveryPlan exists yet.'], [`hairness delivery accept ${draft.id}`])
    throw new Error(`Delivery plan not found: ${action ?? flags.plan ?? value.activePlanId}`)
  }
  const next = pendingStage(value, plan, flags.head)
  if (mode === 'next') {
    if (!next) {
      const handleId = plan.checkoutContext?.handleRef.id
      const candidateId = plan.candidateCheckoutContext?.handleRef.id
      const routes = [handleId ? `hairness worktree close ${handleId}` : null, candidateId ? `hairness worktree close ${candidateId}` : null].filter(Boolean)
      return packet('ship it', `${plan.id} is complete; managed checkout cleanup is ready as a separate boundary.`, [{ status: 'completed', cleanup: 'cleanup-ready', plan }], ['No worktree was closed automatically.'], routes)
    }
    const unresolved = pendingReconciliation(value, plan, next)
    if (unresolved?.reconciliation?.decision === 'abort') return packet('ship it', `${plan.id} was aborted at ${next}.`, [{ status: 'blocked', planId: plan.id, stage: next, receipt: unresolved.receipt, reconciliation: unresolved.reconciliation }], ['An explicit abort decision prevents further progression.'], [])
    if (unresolved && !unresolved.reconciliation) return packet('ship it', `${next} requires explicit reconciliation.`, [{ status: 'needs-reconciliation', planId: plan.id, stage: next, receipt: unresolved.receipt, decisions: [...reconciliationDecisions] }], ['No target effect occurred. The original receipt remains immutable.'], [`hairness delivery reconcile ${plan.id} --stage ${next} --receipt ${unresolved.receipt.id} --decision <accept-deviation|retry|abort> --reason <reason> --proof <evidence>`])
    const requested = flags.boundary
    const boundary = plan.kind === 'release' && requested === 'publish-pr' ? 'release-pr' : requested
    if (next === 'merge' && flags['base-stale']) {
      if (!flags['base-head']) return packet('ship it', 'The base is reported stale but its exact remote HEAD is missing.', [{ status: 'needs-proof', planId: plan.id, stage: 'sync-base' }], ['Supply fresh Git source proof for origin/base.'], [`hairness delivery next ${plan.id} --boundary merge --base-stale --base-head <origin-base-head>`])
      if (flags.published && !flags['remote-head']) return packet('ship it', 'Published branch sync requires the exact observed remote branch HEAD.', [{ status: 'needs-proof', planId: plan.id, stage: 'sync-base' }], ['force-with-lease must bind the current remote branch HEAD.'], [`hairness delivery next ${plan.id} --boundary merge --base-stale --base-head ${flags['base-head']} --published --remote-head <remote-branch-head>`])
      const checkout = await resolveCheckout(plan, runtime, { requireWriter: true, sessionId: flags.session })
      if (checkout.status === 'blocked') return packet('ship it', checkout.summary, [{ status: 'blocked', planId: plan.id, stage: 'sync-base' }], checkout.limits, [`hairness worktree reconcile --plan ${plan.id}`])
      const proposal = await runtime.extensions.call('hairness/worktree-controls', 'propose', { action: 'sync', request: worktreeRequest(plan, 'sync-base', flags) })
      const publishedFlags = flags.published ? ` --published --remote-head ${flags['remote-head']}` : ''
      return packet('ship it', 'The base changed; sync-base is reopened before merge.', [{ status: 'needs-checkpoint', planId: plan.id, stage: 'sync-base', effects: proposal.effects, targets: proposal.targets }], ['Qualification, pull-request proposal and CI for the previous HEAD will no longer satisfy the plan after sync.'], [`hairness delivery checkpoint ${plan.id} --stage sync-base --head ${checkout.context.head} --base-stale --base-head ${flags['base-head']}${publishedFlags}`])
    }
    if (boundary && boundary !== next) return packet('ship it', `${requested} cannot run before ${next}.`, [{ status: 'blocked', requested, next }], [`Complete ${next} first.`], [`hairness delivery next ${plan.id}`])
    const checkoutKind = checkoutKindForStage(plan, next)
    const checkout = checkoutKind ? await resolveCheckout(plan, runtime, { candidate: checkoutKind === 'candidate', requireWriter: true, sessionId: flags.session }) : null
    if (checkout?.status === 'blocked') return packet('ship it', checkout.summary, [{ status: 'blocked', planId: plan.id, stage: next }], checkout.limits, [`hairness worktree reconcile --plan ${plan.id}`])
    const worktreeAction = worktreeStages.get(next)
    const proposal = worktreeAction ? await runtime.extensions.call('hairness/worktree-controls', 'propose', { action: worktreeAction, request: worktreeRequest(plan, next, flags) }) : null
    return packet('ship it', `${next} is the next delivery boundary.`, [{ status: observeStages.has(next) ? 'needs-proof' : 'needs-checkpoint', planId: plan.id, stage: next, effects: proposal?.effects ?? effectsByStage[next] ?? [], targets: proposal?.targets ?? defaultTargets(root, plan, next, (await deliveryPolicy(runtime)).value, checkout) }], ['No target effect occurred.'], [observeStages.has(next) ? `hairness delivery receipt ${plan.id} --stage ${next} --proof <evidence>` : `hairness delivery checkpoint ${plan.id} --stage ${next}`])
  }
  if (mode === 'reconcile') return reconcileReceipt(plan, flags, runtime, value)
  if (mode === 'checkpoint') return prepareCheckpoint(root, plan, flags.stage ?? next, flags, runtime, value)
  if (mode === 'receipt') {
    const stage = flags.stage ?? next
    if (!observeStages.has(stage)) {
      if (flags.run && flags.run !== plan.runs[stage]) throw new Error(`Run ${flags.run} does not own ${stage}.`)
      const refreshed = await refreshRunReceipt(plan, stage, runtime, value)
      if (refreshed) return refreshed
      throw new Error(`Executor result for ${stage} is not available or is untyped.`)
    }
    if (stage === 'collect' && flags['changes-json']) {
      plan.changes = releaseChanges(flags)
      plan.versionRecommendation = semverRecommendation(plan.changes)
      if (flags.baseline) plan.baseline = flags.baseline
    }
    return recordReceipt(plan, stage, { checkpointId: flags.checkpoint ?? null, runId: flags.run ?? null, status: flags.status ?? 'succeeded', summary: flags.summary, targets: split(flags.targets), effects: split(flags.effects), proof: split(flags.proof), head: flags.head ?? null }, runtime, value)
  }
  if (mode === 'release-candidate') {
    if (plan.kind !== 'release') throw new Error(`${plan.id} is not a ReleaseDeliveryPlan.`)
    return releaseCandidate(plan, flags, runtime, value)
  }
  throw new Error(`Unknown delivery action: ${mode}`)
}
