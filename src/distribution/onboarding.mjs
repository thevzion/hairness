import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { HairnessError } from '../core/errors.mjs'
import { ensureOverlay, readJson, userPaths, workspacePaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract } from '../core/contracts.mjs'
import { buildProviders } from '../providers/compiler.mjs'
import { collectOnboardingContributions, descriptorManifest, descriptors } from './registry.mjs'

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
    ...byPhase('legacy'),
    ...byPhase('domain'),
  ]
}

async function loadExtensionGaps(root, state) {
  if (state.extensionGapsLoaded || state.answers.trust !== 'trust') return state
  const contributions = await collectOnboardingContributions(root, 'questions', { trustDecision: 'trust', answers: state.answers })
  const known = new Set(state.gaps.map((gap) => gap.id))
  for (const { value } of contributions) for (const question of value.questions ?? []) {
    if (known.has(question.id)) throw new HairnessError('onboarding_gap_conflict', `Duplicate onboarding gap: ${question.id}`, { exitCode: 2 })
    known.add(question.id)
    state.gaps.push(question)
  }
  state.extensionGapsLoaded = true
  state.state = 'collecting'
  await writeJsonAtomic(statePath(root), state)
  return state
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
  const state = await loadExtensionGaps(root, await onboardingState(root))
  const gap = state.gaps.find((candidate) => state.answers[candidate.id] === undefined)
  if (!gap) return { summary: 'Onboarding answers are complete.', status: 'ready', routes: ['hairness onboarding review'], limits: [] }
  return { ...gap, position: Object.keys(state.answers).length + 1, total: state.gaps.length }
}

export async function answerOnboardingGap(root, id, value) {
  const state = await loadExtensionGaps(root, await onboardingState(root))
  const gap = state.gaps.find((candidate) => candidate.id === id)
  if (!gap) throw new HairnessError('onboarding_gap_unknown', `Unknown onboarding gap: ${id}`, { exitCode: 2 })
  if (!gap.allowCustom && !gap.options.some((option) => option.value === value)) throw new HairnessError('onboarding_answer_invalid', `Invalid value for ${id}: ${value}`, { exitCode: 2 })
  state.answers[id] = value
  if (id === 'trust' && value === 'trust') await loadExtensionGaps(root, state)
  state.state = state.gaps.every((candidate) => state.answers[candidate.id] !== undefined) ? 'ready' : 'collecting'
  await writeJsonAtomic(statePath(root), state)
  return nextOnboardingGap(root)
}

function selectedProviders(value) {
  if (value === 'both') return ['codex', 'claude']
  return value === 'later' ? [] : [value]
}

export async function onboardingPlan(root) {
  const state = await loadExtensionGaps(root, await onboardingState(root))
  const missing = state.gaps.find((gap) => state.answers[gap.id] === undefined)
  if (missing) throw new HairnessError('onboarding_incomplete', `Answer ${missing.id} before planning.`, { routes: ['hairness onboarding next'] })
  if (state.answers.trust !== 'trust') throw new HairnessError('workspace_untrusted', 'Review the distribution, then explicitly answer trust.', { routes: ['hairness onboarding answer trust --value trust'] })
  const providers = selectedProviders(state.answers.providers)
  const contributions = await collectOnboardingContributions(root, 'plan', { trustDecision: 'trust', answers: state.answers })
  const actions = [
    { type: 'write-local-config', target: workspacePaths(root).config },
    { type: 'trust-workspace', target: root },
    ...providers.map((provider) => ({ type: 'verify-provider-projection', target: provider })),
    ...contributions.flatMap(({ value }) => value.actions ?? []),
  ]
  const checkpointId = `onboarding-${createHash('sha256').update(JSON.stringify({ root, answers: state.answers, actions })).digest('hex').slice(0, 12)}`
  state.actions = actions
  await writeJsonAtomic(statePath(root), state)
  return { checkpointId, mode: 'external', intent: 'Configure this local Hairness checkout.', targets: actions.map((action) => action.target), effects: actions.map((action) => action.type), exclusions: ['global provider install', 'codebase mutation', 'Git mutation', 'remote source mutation'], risk: 'Writes local overlay state, workspace trust, extension-owned local setup, and selected repo-local provider files.', providers, contributions, actions }
}

export async function applyOnboarding(root, checkpointId, options = {}) {
  const plan = await onboardingPlan(root)
  if (plan.checkpointId !== checkpointId) throw new HairnessError('checkpoint_mismatch', 'Onboarding checkpoint does not match the current plan.', { exitCode: 2 })
  const state = await onboardingState(root)
  const declaredQuestions = []
  for (const descriptor of await descriptors(root)) {
    const inspected = await descriptorManifest(descriptor)
    if (!inspected.error) declaredQuestions.push(...(inspected.manifest.onboarding ?? []))
  }
  const preferences = { interaction: { language: state.answers.language, timezone: state.answers['profile.timezone'] } }
  for (const question of declaredQuestions) assignPreference(preferences, question.preferenceKey, state.answers[question.id] === 'on' ? true : state.answers[question.id] === 'off' ? false : state.answers[question.id])
  const config = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    profile: { name: state.answers['profile.name'], language: state.answers.language, timezone: state.answers['profile.timezone'], usage: state.answers.usage },
    preferences,
    hosts: plan.providers,
    extensions: { disabled: [], local: [] },
  }
  await writeJsonAtomic(workspacePaths(root).config, config)
  const trust = await readJson(userPaths().trust, { schemaVersion: 2, protocolVersion: '0.2', workspaces: {}, extensions: {} })
  trust.workspaces[root] = { trusted: true, protocolVersion: '0.2', trustedAt: new Date().toISOString() }
  await writeJsonAtomic(userPaths().trust, trust)
  const extensionResults = await collectOnboardingContributions(root, 'apply', { trustDecision: 'trust', answers: state.answers, plans: plan.contributions }, { applied: true })
  for (const { value } of extensionResults) mergeConfig(config, value.config ?? {})
  await writeJsonAtomic(workspacePaths(root).config, config)
  const projections = []
  if (options.buildProviders !== false) for (const provider of plan.providers) projections.push(await buildProviders(root, { provider, check: true }))
  const limits = ['provider-verification-required', ...extensionResults.flatMap(({ value }) => value.limits ?? [])]
  state.state = 'applied'
  await writeJsonAtomic(statePath(root), state)
  return { summary: 'Hairness onboarding applied. Provider projection still requires native hook trust and a new task before it is verified.', status: 'applied', projections, limits, routes: ['review the native /hooks trust surface', 'start a new provider task', 'hairness host doctor <codex|claude>'] }
}

function mergeConfig(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = mergeConfig(target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {}, value)
    else target[key] = value
  }
  return target
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
