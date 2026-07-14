import { join } from 'node:path'
import { rm, unlink } from 'node:fs/promises'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome } from '../home/index.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { digest, now, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { initializeOverlay, overlayPaths } from '../overlay/index.mjs'
import { applyEffect, prepareEffect } from '../operations/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { loadProfile, saveProfile } from '../profile/index.mjs'
import { bindTargetLink, discoverTargets, inspectRepository, normalizeRemote, targetBinding } from '../targets/index.mjs'
import { detectSources, saveSourceBindings, sourceBindings, sourceDefinitions, validateSourceBindings } from '../sources/index.mjs'
import { ensureRuntime, runtimePaths } from '../runtime/index.mjs'

const coreQuestions = [
  { id: 'profile.name', question: 'How should the agent address you? You may skip this.', explanation: 'This stable preference is rendered in the managed provider prologue.' },
  { id: 'profile.note', question: 'Is there one stable working preference the agent should remember? You may skip this.', explanation: 'Keep it short and free of secrets, paths, or dynamic project state.' },
  { id: 'situation', question: 'What is your current situation: configured repository, legacy setup, new project, or multi-repository workspace?', explanation: 'This lets Hairness explain only the setup concepts relevant to you.' },
  { id: 'project-context', question: 'What should the agent understand about the project and your immediate goal?', explanation: 'This remains explicit onboarding context rather than hidden provider memory.' },
  { id: 'targets', question: 'Which discovered repositories should bind the declared Targets?', explanation: 'Answer with the exact approved Target IDs and paths; final bindings become ignored targets/<id> symlinks.' },
  { id: 'sources', question: 'Which detected accessors should bind the declared Sources?', explanation: 'Choose existing CLI/provider access or explicit none. Hairness never installs or authenticates it.' },
]

export async function onboardingStatus(root) {
  const home = await loadHome(root)
  const existingProfile = await loadProfile(root, { optional: true })
  if (!existingProfile) await initializeOverlay(root, { profile: { language: 'en' } })
  const profile = await loadProfile(root)
  const path = overlayPaths(root).onboardingDraft
  const draft = await readJson(path, {
    home: home.metadata.id,
    status: 'answering',
    answers: {},
    createdAt: now(),
    updatedAt: now(),
  })
  const runtime = await onboardingRuntime(home)
  const questions = await onboardingQuestions(root, home)
  const next = questions.find((question) => !Object.hasOwn(draft.answers, question.id)) ?? null
  if (!next && draft.status === 'answering') draft.status = 'ready-to-plan'
  await writeJsonAtomic(path, draft)
  const discovery = runtime.discoveryRoot ? await discoverTargets(root, runtime.discoveryRoot) : null
  return {
    language: profile.language,
    status: draft.status,
    next,
    answered: Object.keys(draft.answers),
    total: questions.length,
    discovery,
    sources: await detectSources(root),
    configured: draft.status === 'complete',
  }
}

export async function answerOnboarding(root, id, answer) {
  const status = await onboardingStatus(root)
  if (!status.next || status.next.id !== id) throw new HairnessError('onboarding_answer_unexpected', `Expected onboarding answer for ${status.next?.id ?? 'no remaining question'}, received ${id}.`)
  const home = await loadHome(root)
  const path = overlayPaths(root).onboardingDraft
  const draft = await readJson(path)
  if (id === 'targets' || id === 'sources') {
    if (!Array.isArray(answer)) throw new HairnessError('onboarding_answer_invalid', `${id} requires a JSON array.`)
    const runtime = await onboardingRuntime(home)
    runtime.answers ??= {}
    runtime.answers[id] = answer
    await writeJsonAtomic(runtimePaths(home.metadata.id).onboarding, runtime)
    draft.answers[id] = { selected: answer.map((item) => item.id) }
  } else draft.answers[id] = String(answer ?? '')
  draft.updatedAt = now()
  await writeJsonAtomic(path, draft)
  return onboardingStatus(root)
}

export async function planOnboarding(root) {
  const home = await loadHome(root)
  const status = await onboardingStatus(root)
  if (status.next) return { status: 'incomplete', next: status.next }
  const draft = await readJson(overlayPaths(root).onboardingDraft)
  const runtime = await onboardingRuntime(home)
  const targetSelections = runtime.answers?.targets ?? []
  const sourceSelections = runtime.answers?.sources ?? []
  const limits = await onboardingLimits(root, home, targetSelections, sourceSelections)
  if (limits.length) return { status: 'incomplete', limits, routes: ['hairness onboarding status --json'] }
  const currentProfile = await loadProfile(root)
  const profile = {
    language: currentProfile.language,
    ...(draft.answers['profile.name'] ? { name: draft.answers['profile.name'] } : {}),
    ...(draft.answers['profile.note'] ? { note: draft.answers['profile.note'] } : {}),
  }
  const plan = {
    profile,
    targets: targetSelections,
    sources: sourceSelections,
    composition: { add: [], remove: [], active: home.spec.extensions },
    config: home.spec.config,
    rebuild: home.spec.providers,
  }
  const evidence = await onboardingEvidence(root, home, draft, plan)
  const checkpoint = await prepareEffect(root, {
    operation: 'onboarding.apply',
    adapter: 'hairness/cockpit:onboarding',
    inputs: plan,
    evidence,
    policy: { extensionsExecuteBeforeTrust: false },
    target: { id: home.metadata.id, configuration: digest(home) },
  })
  await writeJsonAtomic(join(runtimePaths(home.metadata.id).checkpoints, `${checkpoint.metadata.id}.onboarding.json`), plan)
  return { status: 'checkpoint-required', plan, checkpoint }
}

export async function applyOnboarding(root, checkpointId) {
  const home = await loadHome(root)
  const runtime = runtimePaths(home.metadata.id)
  const plan = await readJson(join(runtime.checkpoints, `${checkpointId}.onboarding.json`))
  const draft = await readJson(overlayPaths(root).onboardingDraft)
  const current = {
    inputs: plan,
    evidence: await onboardingEvidence(root, home, draft, plan),
    policy: { extensionsExecuteBeforeTrust: false },
    target: { id: home.metadata.id, configuration: digest(home) },
  }
  const receipt = await applyEffect(root, checkpointId, current, async () => {
    const previousProfile = await loadProfile(root)
    const previousSources = await sourceBindings(home)
    const previousDraft = structuredClone(draft)
    const createdBindings = []
    try {
      await saveProfile(root, plan.profile)
      await buildProviders(root)
      for (const selection of plan.targets) if (!await targetBinding(root, selection.id)) {
        await bindTargetLink(root, selection.id, selection.path)
        createdBindings.push(selection.id)
      }
      await saveSourceBindings(root, plan.sources)
      draft.status = 'complete'
      draft.completedAt = now()
      draft.updatedAt = now()
      await writeJsonAtomic(overlayPaths(root).onboardingDraft, draft)
      await rm(runtime.onboarding, { force: true })
      return { composition: plan.composition, targets: plan.targets.map((item) => item.id), sources: plan.sources.map((item) => item.id), providers: plan.rebuild }
    } catch (error) {
      for (const id of createdBindings.reverse()) await unlink(join(root, 'targets', id)).catch(() => {})
      await writeJsonAtomic(runtime.sourceBindings, previousSources)
      await writeJsonAtomic(overlayPaths(root).onboardingDraft, previousDraft)
      await saveProfile(root, previousProfile)
      await buildProviders(root)
      throw error
    }
  })
  return {
    status: 'complete',
    receipt,
    tour: ['hairness', 'hairness-onboarding', 'hairness-scratch', 'hairness-discuss', 'hairness-map', 'hairness-ideate', 'hairness-propose', 'hairness-recap', 'hairness-plan', 'hairness-ship'],
  }
}

async function onboardingQuestions(root, home) {
  const extensions = await activeExtensions(root, home)
  const context = { targetPresent: home.spec.targets.length > 0 }
  const contributed = extensions.flatMap((extension) => extension.manifest.spec.onboarding
    .filter((question) => !question.when || Object.entries(question.when).every(([key, value]) => context[key] === value))
    .map((question) => ({ ...question, owner: extension.manifest.metadata.id })))
  return [...coreQuestions, ...contributed]
}

async function onboardingRuntime(home) {
  const runtime = await ensureRuntime(home)
  return readJson(runtime.onboarding, { createdAt: now(), answers: {} })
}

async function onboardingLimits(root, home, targetSelections, sourceSelections) {
  const limits = []
  const selectedTargets = new Map(targetSelections.map((item) => [item.id, item]))
  for (const target of home.spec.targets) {
    const selection = selectedTargets.get(target.id)
    if (!selection && !await targetBinding(root, target.id) && target.requirement === 'required') limits.push(`target-required-unbound:${target.id}`)
    if (selection) {
      const repository = await inspectRepository(selection.path)
      const expected = new Set(target.remotes.map(normalizeRemote))
      if (expected.size && !repository.remotes.some((remote) => expected.has(remote.normalized))) limits.push(`target-remote-mismatch:${target.id}`)
    }
  }
  const selectedSources = new Map(sourceSelections.map((item) => [item.id, item]))
  const boundSources = await sourceBindings(home)
  for (const source of sourceDefinitions(home)) {
    const selection = selectedSources.get(source.id) ?? boundSources.sources[source.id]
    if (source.requirement === 'required' && (!selection || selection.kind === 'none')) limits.push(`source-required-unbound:${source.id}`)
  }
  try { await validateSourceBindings(root, sourceSelections, home) } catch (error) { limits.push(`source-selection-invalid:${error.message}`) }
  return limits
}

async function onboardingEvidence(root, home, draft, plan) {
  const targets = []
  for (const selection of plan.targets) targets.push({ id: selection.id, repository: await inspectRepository(selection.path) })
  return { home: digest(home), draft: digest(draft), profile: digest(plan.profile), targets }
}
