import { join } from 'node:path'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome } from '../home/index.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { digest, now, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { overlayPaths } from '../overlay/index.mjs'
import { applyEffect, prepareEffect } from '../operations/index.mjs'
import { HairnessError } from '../lib/errors.mjs'

const coreQuestions = [
  { id: 'situation', question: 'What is your current situation: an existing configured repository, a legacy repository, a new project, or a multi-repository workspace?', explanation: 'This lets Hairness explain the right Target and delivery setup without changing it automatically.' },
  { id: 'project-context', question: 'What should the agent understand about your project, constraints, and immediate goal?', explanation: 'This becomes explicit onboarding context, not a hidden provider memory.' },
  { id: 'working-memory', question: 'When should Hairness suggest creating a Scratch for you?', explanation: 'Sessions remain ephemeral by default; Scratch is opt-in durable working memory.' },
]

export async function onboardingStatus(root) {
  const home = await loadHome(root)
  const path = overlayPaths(root).onboardingDraft
  const draft = await readJson(path, {
    home: home.metadata.id,
    language: home.spec.language,
    status: 'answering',
    answers: {},
    createdAt: now(),
    updatedAt: now(),
  })
  const questions = await onboardingQuestions(root, home)
  const next = questions.find((question) => !Object.hasOwn(draft.answers, question.id)) ?? null
  if (!next && draft.status === 'answering') draft.status = 'ready-to-plan'
  await writeJsonAtomic(path, draft)
  return { language: home.spec.language, status: draft.status, next, answered: Object.keys(draft.answers), total: questions.length }
}

export async function answerOnboarding(root, id, answer) {
  const status = await onboardingStatus(root)
  if (!status.next || status.next.id !== id) throw new HairnessError('onboarding_answer_unexpected', `Expected onboarding answer for ${status.next?.id ?? 'no remaining question'}, received ${id}.`)
  const path = overlayPaths(root).onboardingDraft
  const draft = await readJson(path)
  draft.answers[id] = answer
  draft.updatedAt = now()
  await writeJsonAtomic(path, draft)
  return onboardingStatus(root)
}

export async function planOnboarding(root) {
  const home = await loadHome(root)
  const status = await onboardingStatus(root)
  if (status.next) return { status: 'incomplete', next: status.next }
  const draft = await readJson(overlayPaths(root).onboardingDraft)
  const plan = {
    language: home.spec.language,
    answers: draft.answers,
    composition: { add: [], remove: [], active: home.spec.extensions },
    rebuild: home.spec.providers,
  }
  const checkpoint = await prepareEffect(root, {
    operation: 'onboarding.apply',
    adapter: 'hairness/cockpit:onboarding',
    inputs: plan,
    evidence: { home: digest(home), draft: digest(draft) },
    policy: { extensionsExecuteBeforeTrust: false },
    target: { id: home.metadata.id, configuration: digest(home) },
  })
  await writeJsonAtomic(join((await import('../runtime/index.mjs')).runtimePaths(home.metadata.id).checkpoints, `${checkpoint.metadata.id}.onboarding.json`), plan)
  return { status: 'checkpoint-required', plan, checkpoint }
}

export async function applyOnboarding(root, checkpointId) {
  const home = await loadHome(root)
  const runtime = (await import('../runtime/index.mjs')).runtimePaths(home.metadata.id)
  const plan = await readJson(join(runtime.checkpoints, `${checkpointId}.onboarding.json`))
  const draft = await readJson(overlayPaths(root).onboardingDraft)
  const current = {
    inputs: plan,
    evidence: { home: digest(home), draft: digest(draft) },
    policy: { extensionsExecuteBeforeTrust: false },
    target: { id: home.metadata.id, configuration: digest(home) },
  }
  const receipt = await applyEffect(root, checkpointId, current, async () => {
    draft.status = 'complete'
    draft.completedAt = now()
    await writeJsonAtomic(overlayPaths(root).onboardingDraft, draft)
    await buildProviders(root)
    return { composition: plan.composition, providers: plan.rebuild }
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
