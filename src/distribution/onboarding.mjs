import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, mkdir, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { userInfo } from 'node:os'
import { HairnessError } from '../core/errors.mjs'
import { ensureOverlay, readJson, userPaths, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract } from '../core/contracts.mjs'
import { buildProviders } from '../providers/compiler.mjs'
import { descriptorManifest, descriptors } from './registry.mjs'
import { readSourceEvidence } from './registry.mjs'

const exec = promisify(execFile)

function statePath(root) {
  return join(workspacePaths(root).overlay, 'onboarding.json')
}

async function detectedName() {
  try { return (await exec('git', ['config', 'user.name'], { encoding: 'utf8' })).stdout.trim() || userInfo().username }
  catch { return userInfo().username }
}

async function gaps(root) {
  const manifest = await readJson(join(root, 'hairness.json'))
  const name = await detectedName()
  const declared = []
  for (const descriptor of await descriptors(root)) {
    const inspected = await descriptorManifest(descriptor)
    if (!inspected.error) declared.push(...(inspected.manifest.onboarding ?? []))
  }
  const byPhase = (phase) => declared.filter((question) => question.phase === phase)
  return [
    { id: 'language', question: 'Which language should Hairness use?', options: [{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }] },
    { id: 'usage', question: 'How will this checkout be used?', options: manifest.role === 'forge' ? [{ value: 'maintainer', label: 'Maintain the Hairness forge' }, { value: 'personal', label: 'Use it personally' }] : [{ value: 'team', label: 'Shared team distribution' }, { value: 'personal', label: 'Personal distribution' }] },
    { id: 'profile.name', question: 'How should Hairness address you?', allowCustom: true, options: [{ value: name, label: name }, { value: userInfo().username, label: userInfo().username }] },
    { id: 'profile.timezone', question: 'Which timezone should Hairness use?', allowCustom: true, options: [{ value: Intl.DateTimeFormat().resolvedOptions().timeZone, label: Intl.DateTimeFormat().resolvedOptions().timeZone }] },
    { id: 'trust', question: 'Trust this source-owned distribution to run its local CLI and extensions?', options: [{ value: 'trust', label: 'Trust this workspace' }, { value: 'review', label: 'Review first' }] },
    { id: 'providers', question: 'Which repo-local provider projections will you use?', options: [{ value: 'both', label: 'Codex and Claude' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'later', label: 'Configure later' }] },
    ...byPhase('privacy'),
    ...byPhase('maintenance'),
    { id: 'legacy.handoff', question: 'Is there a legacy handoff to register?', allowCustom: true, options: [{ value: 'none', label: 'No legacy handoff' }] },
    ...manifest.codebases.map((codebase) => ({
      id: `codebase.${codebase.id}`,
      question: `Where is ${codebase.displayName}?`,
      allowCustom: true,
      codebase: codebase.id,
      requirement: codebase.requirement,
      options: [{ value: 'detect', label: 'Detect locally' }, { value: 'later', label: 'Configure later' }],
    })),
    ...manifest.sources.map((source) => ({
      id: `source.${source.id}`,
      question: `Enable the ${source.id} source (${source.requirement})?`,
      source: source.id,
      requirement: source.requirement,
      options: [{ value: 'enable', label: 'Enable' }, { value: 'later', label: 'Configure later' }],
    })),
    ...manifest.sources.map((source) => ({
      id: `identity.${source.id}`,
      question: `Record the current non-secret ${source.id} identity locally?`,
      source: source.id,
      options: [{ value: 'detect', label: 'Detect after checkpoint' }, { value: 'later', label: 'Do not record it' }],
    })),
    ...byPhase('domain'),
  ]
}

export async function onboardingState(root) {
  await ensureOverlay(root)
  const existing = await readJson(statePath(root), null)
  if (existing?.protocolVersion === '0.2') return validateContract('OnboardingState', existing)
  const state = { schemaVersion: 2, protocolVersion: '0.2', state: 'new', answers: {}, gaps: await gaps(root), actions: [] }
  await writeJsonAtomic(statePath(root), state)
  return validateContract('OnboardingState', state)
}

export async function nextOnboardingGap(root) {
  const state = await onboardingState(root)
  const gap = state.gaps.find((candidate) => state.answers[candidate.id] === undefined)
  if (!gap) return { summary: 'Onboarding answers are complete.', status: 'ready', routes: ['hairness onboarding review'], limits: [] }
  return { ...gap, position: Object.keys(state.answers).length + 1, total: state.gaps.length }
}

export async function answerOnboardingGap(root, id, value) {
  const state = await onboardingState(root)
  const gap = state.gaps.find((candidate) => candidate.id === id)
  if (!gap) throw new HairnessError('onboarding_gap_unknown', `Unknown onboarding gap: ${id}`, { exitCode: 2 })
  if (!gap.allowCustom && !gap.options.some((option) => option.value === value)) throw new HairnessError('onboarding_answer_invalid', `Invalid value for ${id}: ${value}`, { exitCode: 2 })
  state.answers[id] = value
  state.state = state.gaps.every((candidate) => state.answers[candidate.id] !== undefined) ? 'ready' : 'collecting'
  await writeJsonAtomic(statePath(root), state)
  return nextOnboardingGap(root)
}

function selectedProviders(value) {
  if (value === 'both') return ['codex', 'claude']
  return value === 'later' ? [] : [value]
}

async function discoverCodebase(root, contract) {
  const candidates = [join(resolve(root, '..'), contract.id), ...(contract.discovery?.paths ?? []).map(resolve)]
  for (const candidate of candidates) {
    try { await lstat(join(candidate, '.git')); return candidate } catch {}
  }
  return null
}

async function resolvedCodebases(root, state) {
  const manifest = await readJson(join(root, 'hairness.json'))
  const values = {}
  for (const contract of manifest.codebases) {
    const answer = state.answers[`codebase.${contract.id}`]
    if (answer === 'later') continue
    const path = answer === 'detect' ? await discoverCodebase(root, contract) : resolve(answer)
    if (path) values[contract.id] = { path, requirement: contract.requirement }
  }
  return values
}

export async function onboardingPlan(root) {
  const state = await onboardingState(root)
  const missing = state.gaps.find((gap) => state.answers[gap.id] === undefined)
  if (missing) throw new HairnessError('onboarding_incomplete', `Answer ${missing.id} before planning.`, { routes: ['hairness onboarding next'] })
  if (state.answers.trust !== 'trust') throw new HairnessError('workspace_untrusted', 'Review the distribution, then explicitly answer trust.', { routes: ['hairness onboarding answer trust --value trust'] })
  const codebases = await resolvedCodebases(root, state)
  const providers = selectedProviders(state.answers.providers)
  const actions = [
    { type: 'write-local-config', target: workspacePaths(root).config },
    { type: 'trust-workspace', target: root },
    ...Object.entries(codebases).map(([id, value]) => ({ type: 'mount-codebase', target: value.path, codebase: id })),
    ...providers.map((provider) => ({ type: 'verify-provider-projection', target: provider })),
    ...Object.keys(state.answers).filter((id) => id.startsWith('identity.') && state.answers[id] === 'detect').map((id) => ({ type: 'read-source-identity', target: id.slice('identity.'.length) })),
  ]
  const checkpointId = `onboarding-${createHash('sha256').update(JSON.stringify({ root, answers: state.answers, actions })).digest('hex').slice(0, 12)}`
  state.actions = actions
  await writeJsonAtomic(statePath(root), state)
  return { checkpointId, mode: 'external', intent: 'Configure this local Hairness checkout.', targets: actions.map((action) => action.target), effects: actions.map((action) => action.type), exclusions: ['global provider install', 'codebase mutation', 'Git mutation', 'remote source mutation'], risk: 'Writes local overlay state, workspace trust, codebase symlinks, and selected repo-local provider files.', providers, codebases, actions }
}

export async function applyOnboarding(root, checkpointId, options = {}) {
  const plan = await onboardingPlan(root)
  if (plan.checkpointId !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Onboarding checkpoint does not match the current plan.', { exitCode: 2 })
  const state = await onboardingState(root)
  const distribution = await readJson(join(root, 'hairness.json'))
  const declaredQuestions = []
  for (const descriptor of await descriptors(root)) {
    const inspected = await descriptorManifest(descriptor)
    if (!inspected.error) declaredQuestions.push(...(inspected.manifest.onboarding ?? []))
  }
  const preferences = { interaction: { language: state.answers.language, timezone: state.answers['profile.timezone'] }, legacy: { handoff: state.answers['legacy.handoff'] } }
  for (const question of declaredQuestions) assignPreference(preferences, question.preferenceKey, state.answers[question.id] === 'on' ? true : state.answers[question.id] === 'off' ? false : state.answers[question.id])
  const config = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    profile: { name: state.answers['profile.name'], language: state.answers.language, timezone: state.answers['profile.timezone'], usage: state.answers.usage },
    preferences,
    hosts: plan.providers,
    extensions: { disabled: [], local: [] },
    sources: Object.fromEntries(distribution.sources.map((source) => [source.id, { enabled: state.answers[`source.${source.id}`] === 'enable', requirement: source.requirement }])),
    codebases: {
      local: [],
      mounts: Object.fromEntries(Object.entries(plan.codebases).map(([id, codebase]) => [id, { default: { path: codebase.path } }])),
    },
    identities: {},
  }
  await writeJsonAtomic(workspacePaths(root).config, config)
  for (const [id, codebase] of Object.entries(plan.codebases)) {
    const codebaseRoot = join(workspacePaths(root).codebases, id)
    try {
      if ((await lstat(codebaseRoot)).isSymbolicLink()) await rm(codebaseRoot, { force: true })
    } catch {}
    await mkdir(codebaseRoot, { recursive: true })
    const mount = join(codebaseRoot, 'default')
    try { await rm(mount, { force: true }) } catch {}
    await symlink(codebase.path, mount)
  }
  const trust = await readJson(userPaths().trust, { schemaVersion: 2, protocolVersion: '0.2', workspaces: {}, extensions: {} })
  trust.workspaces[root] = { trusted: true, protocolVersion: '0.2', trustedAt: new Date().toISOString() }
  await writeJsonAtomic(userPaths().trust, trust)
  const projections = []
  if (options.buildProviders !== false) for (const provider of plan.providers) projections.push(await buildProviders(root, { provider, check: true }))
  const limits = ['provider-verification-required']
  for (const source of distribution.sources) if (state.answers[`identity.${source.id}`] === 'detect') {
    try {
      const evidence = await readSourceEvidence(root, source.id, 'identity', {})
      config.identities[source.id] = sanitizeIdentity(evidence.data)
    } catch (error) {
      limits.push(`${source.id}-identity-unavailable: ${error.summary ?? error.message}`)
    }
  }
  await writeJsonAtomic(workspacePaths(root).config, config)
  state.state = 'applied'
  await writeJsonAtomic(statePath(root), state)
  return { summary: 'Hairness onboarding applied. Provider projection still requires native hook trust and a new task before it is verified.', status: 'applied', projections, limits, routes: ['review the native /hooks trust surface', 'start a new provider task', 'hairness host doctor <codex|claude>'] }
}

function sanitizeIdentity(value) {
  const forbidden = /token|secret|password|credential|cookie|private.?key/i
  function clean(input) {
    if (Array.isArray(input)) return input.slice(0, 32).map(clean)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input).filter(([key]) => !forbidden.test(key)).slice(0, 64).map(([key, child]) => [key, clean(child)]))
  }
  const output = clean(value)
  if (Buffer.byteLength(JSON.stringify(output)) > 4096) return { summary: 'Identity evidence exceeded the local storage budget.', truncated: true }
  return output
}

function assignPreference(target, key, value) {
  const parts = key.split('.')
  let current = target
  for (const part of parts.slice(0, -1)) current = current[part] ??= {}
  current[parts.at(-1)] = value
}

export async function resetOnboarding(root) {
  await rm(statePath(root), { force: true })
  return { summary: 'Onboarding answers were reset. Existing config and trust were not changed.', status: 'reset', limits: [], routes: ['hairness onboarding next'] }
}
