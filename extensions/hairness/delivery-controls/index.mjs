import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const now = () => new Date().toISOString()
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const digest = (value) => `sha256:${hash(value)}`
const split = (value, separator = ',') => String(value ?? '').split(separator).map((item) => item.trim()).filter(Boolean)
const slug = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'change'
const empty = () => ({ schemaVersion: 2, protocolVersion: '0.2', drafts: [], plans: [], receipts: [], activePlanId: null, updatedAt: now() })
const changeStages = ['prepare', 'implement', 'qualify', 'publish-pr', 'ci', 'merge', 'verify-main']
const releaseStages = ['collect', 'release-pr', 'ci', 'merge', 'verify-main', 'qualify', 'npm-publish', 'git-tag', 'github-release']
const observeStages = new Set(['qualify', 'ci', 'verify-main', 'collect'])
const effectsByStage = {
  prepare: ['git:branch'],
  implement: ['filesystem:write'],
  'publish-pr': ['git:commit', 'git:push', 'github:pull-request'],
  merge: ['github:merge'],
  'release-pr': ['filesystem:write', 'git:commit', 'git:push', 'github:pull-request'],
  'npm-publish': ['npm:publish'],
  'git-tag': ['git:tag', 'git:push'],
  'github-release': ['github:release'],
}

function normalizeLegacy(value) {
  if (Array.isArray(value.drafts) && Object.hasOwn(value, 'activePlanId')) return {
    ...value,
    plans: (value.plans ?? []).map((plan) => ({ versionRecommendation: 'none', baseline: null, evidenceMaxAgeMinutes: 30, runs: {}, checkpoints: {}, artifacts: [], changes: [], ...plan })),
  }
  const legacyDigest = 'sha256:legacy-delivery-plan'
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    drafts: [],
    plans: (value.plans ?? []).map((plan) => ({
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
  const plan = { id, kind: 'change', initiativeId: initiative?.id ?? null, briefArtifact, state: 'planned', repository: brief.repository, base: brief.base, branch: brief.branch, version: null, versionRecommendation: semverRecommendation([`${brief.type}: ${brief.subject}`]), baseline: null, policyDigest: brief.policyDigest, evidenceMaxAgeMinutes: policy.value.evidenceMaxAgeMinutes, stages: changeStages, runs: {}, checkpoints: {}, artifacts: [briefArtifact], changes: [brief.subject], createdAt: at, updatedAt: at }
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
  const plan = { id, kind: 'release', initiativeId: initiative?.id ?? null, briefArtifact: null, state: 'planned', repository: policy.value.repository, base: policy.value.baseBranch, branch, version, versionRecommendation: semverRecommendation(changes), baseline: flags.baseline ?? policy.value.release.bootstrapBaseline, policyDigest: policy.digest, evidenceMaxAgeMinutes: policy.value.evidenceMaxAgeMinutes, stages: releaseStages, runs: {}, checkpoints: {}, artifacts: [], changes, createdAt: at, updatedAt: at }
  value.plans.push(plan); value.activePlanId = id
  await save(runtime, value, { type: 'delivery.release-planned', id })
  return plan
}

function successfulReceipt(value, plan, stage, head) {
  return value.receipts.findLast((item) => {
    const stale = observeStages.has(stage) && Date.now() - Date.parse(item.observedAt) > plan.evidenceMaxAgeMinutes * 60_000
    const headMatches = !head || ['prepare', 'implement'].includes(stage) || item.head === head
    return item.planId === plan.id && item.stage === stage && item.status === 'succeeded' && item.policyDigest === plan.policyDigest && !stale && headMatches
  })
}

function pendingStage(value, plan, head) {
  const expectedHead = plan.kind === 'change' ? head : null
  return plan.stages.find((stage) => !successfulReceipt(value, plan, stage, expectedHead)) ?? null
}

async function refreshRunReceipt(plan, stage, runtime, value) {
  const runId = plan.runs[stage]
  if (!runId || successfulReceipt(value, plan, stage)) return null
  const result = await runtime.runs.result(runId)
  if (!result) return null
  const receipt = result.outcome?.receipt ?? result.outcome
  if (!receipt?.status) return null
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

function defaultTargets(root, plan, stage, policy) {
  const repository = `github://${plan.repository}`
  if (stage === 'prepare' || stage === 'implement') return [root]
  if (stage === 'publish-pr' || stage === 'release-pr') return [root, `${repository}/branches/${plan.branch}`, `${repository}/pulls/${plan.branch}`]
  if (stage === 'merge') return [`${repository}/pulls/${plan.branch}`]
  if (stage === 'npm-publish') return [`npm://${new URL(policy.release.registry).host}/${encodeURIComponent(policy.release.package)}/${plan.version}`]
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
  if (stage !== pendingStage(value, plan, flags.head)) throw new Error(`Stage ${stage} is not the next unresolved boundary.`)
  if (observeStages.has(stage)) return { summary: `${stage} requires fresh read-only proof.`, status: 'needs-proof', planId: plan.id, stage, limits: [], routes: [`hairness delivery receipt ${plan.id} --stage ${stage} --proof <evidence> --head ${flags.head ?? '<head>'}`] }
  const currentPolicy = await deliveryPolicy(runtime)
  if (currentPolicy.digest !== plan.policyDigest) return { summary: 'Delivery policy changed after planning.', status: 'blocked', limits: ['Re-plan before preparing effects.'], routes: [`hairness delivery plan --kind ${plan.kind}`] }
  const effects = effectsByStage[stage] ?? []
  if (!effects.length) throw new Error(`Stage ${stage} has no executor effect mapping.`)
  const targets = split(flags.targets).length ? split(flags.targets) : defaultTargets(root, plan, stage, currentPolicy.value)
  if (['publish-pr', 'release-pr'].includes(stage) && (!flags.head || !flags['diff-digest'] || !split(flags.files).length)) throw new Error(`${stage} requires --head, --diff-digest and --files from an inspected diff.`)
  if (['merge', 'npm-publish', 'git-tag', 'github-release'].includes(stage) && !flags.head) throw new Error(`${stage} requires the exact --head commit.`)
  if (stage === 'merge' && plan.kind === 'release') {
    const pullRequest = successfulReceipt(value, plan, 'release-pr')
    const ci = successfulReceipt(value, plan, 'ci', flags.head)
    if (!pullRequest?.head || pullRequest.head !== flags.head || !ci) return { summary: 'Release merge proof does not match the pull-request head.', status: 'blocked', limits: ['Re-observe CI and reconcile the exact pull-request head before merging.'], routes: [`hairness delivery next ${plan.id}`] }
  }
  if (stage === 'npm-publish' && !plan.artifacts.some((id) => id.startsWith('release/'))) return { summary: 'npm-publish requires a promoted ReleaseCandidate.', status: 'blocked', limits: ['Prepare and inspect the ReleaseCandidate first.'], routes: [`hairness delivery release-candidate ${plan.id}`] }
  if (['npm-publish', 'git-tag', 'github-release'].includes(stage)) {
    const candidateId = plan.artifacts.find((id) => id.startsWith('release/'))
    const candidate = candidateId ? await runtime.artifacts.read(candidateId).catch(() => null) : null
    if (!candidate || candidate.payload.commit !== flags.head) return { summary: `${stage} does not match the qualified release commit.`, status: 'blocked', limits: ['Use the exact public commit recorded in the ReleaseCandidate.'], routes: [`hairness delivery release-candidate ${plan.id}`] }
  }
  const proof = split(flags.proof).length ? split(flags.proof) : [`plan:${plan.id}`, `policy:${plan.policyDigest}`, ...(flags.head ? [`head:${flags.head}`] : []), ...(flags['diff-digest'] ? [`diff:${flags['diff-digest']}`] : [])]
  const runId = `delivery-${hash({ plan: plan.id, stage, targets, effects, proof, diffDigest: flags['diff-digest'] ?? null }).slice(0, 20)}`
  const checkpointId = `checkpoint-${hash({ runId, plan: plan.id, stage, targets, effects, proof }).slice(0, 20)}`
  const operation = { capability: 'hairness/delivery', id: 'execute' }
  const contextPlanId = `context-${hash({ plan: plan.id, stage, runId }).slice(0, 20)}`
  const fanIn = `${contextPlanId}-fan-in`
  if (plan.runs[stage] && plan.runs[stage] !== runId) return { summary: `${stage} proof changed after checkpoint preparation.`, status: 'blocked', planId: plan.id, stage, limits: ['Reconcile or cancel the existing Run before preparing a new head or diff.'], routes: [`hairness run ${plan.runs[stage]} show`] }
  let proposal = null
  if (stage === 'publish-pr' || stage === 'release-pr') {
    proposal = await pullRequestProposal(plan, stage, checkpointId, flags, currentPolicy.value, runtime)
    if (!plan.artifacts.includes(proposal.id)) plan.artifacts.push(proposal.id)
  }
  if (!plan.runs[stage]) {
    await runtime.plans.write({ schemaVersion: 2, protocolVersion: '0.2', id: contextPlanId, intent: { schemaVersion: 2, protocolVersion: '0.2', id: `${contextPlanId}-intent`, summary: `Execute ${stage} for ${plan.id}.`, outcome: `${stage} returns one typed ChangeReceipt.`, targets, limits: [] }, routes: [{ schemaVersion: 2, protocolVersion: '0.2', id: runId, operation, kind: 'worker', profile: 'executor', requirement: 'required', resultSchema: 'ChangeReceipt', fanIn, workload: 'balanced' }], fanIn: { id: fanIn, mode: 'mechanical' } })
    await runtime.runs.create({ id: runId, planId: contextPlanId, assignment: { schemaVersion: 2, protocolVersion: '0.2', id: `execute-${stage}-${plan.id}`, operation, profile: 'executor', goal: `Execute only ${stage} for ${plan.id}.`, outcome: `One ChangeReceipt for ${stage}.`, workload: 'balanced', budget: 1, inputs: [{ deliveryPlan: plan }, { stage }, { expectedProof: proof }, ...(proposal ? [{ pullRequestProposal: { id: proposal.id, revision: proposal.revision, diffDigest: proposal.payload.diffDigest } }] : [])], targets, exclusions: ['scope expansion', 'main push', 'force push', 'implicit next boundary', 'nested subagents'], allowedSources: ['git:read', 'github:read', 'npm:read'], requestedEffects: effects, result: { schema: 'ChangeReceipt', disposition: 'effect' } } })
    await runtime.runs.transition(runId, 'ready')
    await runtime.runs.transition(runId, 'needs-authority')
    plan.runs[stage] = runId
    plan.checkpoints[stage] = checkpointId
  }
  const checkpoint = await runtime.runs.proposeCheckpoint({ schemaVersion: 2, protocolVersion: '0.2', id: checkpointId, runId, mode: stage === 'implement' || stage === 'prepare' ? 'mutation' : 'external', intent: `Execute ${stage} for ${plan.id}.`, targets, effects, exclusions: ['scope expansion', 'main push', 'force push', 'implicit next boundary'], risk: `Performs the exact ${stage} boundary on declared targets.`, proof, approved: false })
  plan.updatedAt = now(); plan.state = 'in-progress'
  await save(runtime, value, { type: 'delivery.checkpoint-prepared', id: plan.id, stage, runId, checkpointId })
  return { summary: `${stage} is prepared and needs exact authority.`, status: 'needs-authority', planId: plan.id, stage, runId, checkpoint, capsule: await runtime.runs.capsule(runId), limits: ['No target effect occurred.'], routes: [`hairness run ${runId} approve --checkpoint ${checkpoint.id} --json`] }
}

async function releaseCandidate(plan, flags, runtime, value) {
  const required = ['collect', 'release-pr', 'ci', 'merge', 'verify-main', 'qualify']
  for (const stage of required) if (!successfulReceipt(value, plan, stage)) return { summary: 'Release qualification proof is incomplete.', status: 'blocked', limits: [`Missing ${stage} receipt.`], routes: [`hairness delivery next ${plan.id}`] }
  const pullRequest = successfulReceipt(value, plan, 'release-pr')
  if (!pullRequest.head || !successfulReceipt(value, plan, 'ci', pullRequest.head) || !successfulReceipt(value, plan, 'merge', pullRequest.head)) return { summary: 'Release pull-request proof is stale or refers to a different head.', status: 'blocked', limits: ['Release PR, CI and merge receipts must agree on the exact pull-request head.'], routes: [`hairness delivery next ${plan.id}`] }
  if (!flags.commit || !successfulReceipt(value, plan, 'verify-main', flags.commit) || !successfulReceipt(value, plan, 'qualify', flags.commit)) return { summary: 'Release qualification does not match the public commit.', status: 'blocked', limits: ['Verify main and qualify the exact commit supplied to the ReleaseCandidate.'], routes: [`hairness delivery next ${plan.id}`] }
  const policy = await deliveryPolicy(runtime)
  if (policy.digest !== plan.policyDigest) return { summary: 'Release policy is stale.', status: 'blocked', limits: ['Re-plan the release.'], routes: [] }
  const payload = { planId: plan.id, policyDigest: plan.policyDigest, package: { name: policy.value.release.package, version: plan.version, registry: policy.value.release.registry, distTag: policy.value.release.prereleaseTag }, commit: flags.commit, changes: plan.changes, checks: policy.value.requiredChecks, tarball: { path: flags.tarball, sha256: flags.sha256, integrity: flags.integrity }, dryRun: flags['dry-run'] ?? flags.dryRun, limitations: split(flags.limitations, '|'), observedAt: now() }
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
    if (!next) return packet('ship it', `${plan.id} is complete.`, [{ status: 'completed', plan }], [], [])
    const requested = flags.boundary
    const boundary = plan.kind === 'release' && requested === 'publish-pr' ? 'release-pr' : requested
    if (boundary && boundary !== next) return packet('ship it', `${requested} cannot run before ${next}.`, [{ status: 'blocked', requested, next }], [`Complete ${next} first.`], [`hairness delivery next ${plan.id}`])
    return packet('ship it', `${next} is the next delivery boundary.`, [{ status: observeStages.has(next) ? 'needs-proof' : 'needs-checkpoint', planId: plan.id, stage: next, effects: effectsByStage[next] ?? [], targets: defaultTargets(root, plan, next, (await deliveryPolicy(runtime)).value) }], ['No target effect occurred.'], [observeStages.has(next) ? `hairness delivery receipt ${plan.id} --stage ${next} --proof <evidence>` : `hairness delivery checkpoint ${plan.id} --stage ${next}`])
  }
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
