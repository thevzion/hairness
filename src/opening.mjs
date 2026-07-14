import { validateDocument } from './contracts/index.mjs'
import { loadHome } from './home/index.mjs'
import { readJson } from './lib/io.mjs'
import { overlayPaths } from './overlay/index.mjs'
import { activeScratch } from './scratch/index.mjs'
import { listTargets } from './targets/index.mjs'

export const humanCommands = Object.freeze([
  'hairness',
  'hairness-onboarding',
  'hairness-scratch',
  'hairness-discuss',
  'hairness-map',
  'hairness-ideate',
  'hairness-propose',
  'hairness-recap',
  'hairness-plan',
  'hairness-ship',
])

export async function sessionOpening(root) {
  const home = await loadHome(root)
  const draft = await readJson(overlayPaths(root).onboardingDraft, null)
  const scratch = await activeScratch(root)
  const targets = await listTargets(root)
  const onboarded = draft?.status === 'complete'
  return validateDocument({
    apiVersion: 'hairness.dev/home/v1alpha1',
    kind: 'SessionOpening',
    home: { id: home.metadata.id, language: home.spec.language, providers: home.spec.providers },
    instruction: `Speak ${home.spec.language} from the first reply and preserve the user's language.`,
    onboarding: { status: draft?.status ?? 'not-started' },
    scratch: scratch ? { id: scratch } : null,
    targets: targets.map((target) => ({ id: target.id, bound: Boolean(target.binding), head: target.evidence?.head ?? null })),
    commands: humanCommands,
    limits: [!onboarded && 'onboarding-incomplete', !scratch && 'session-ephemeral'].filter(Boolean),
    routes: [!onboarded ? 'hairness onboarding status --json' : null, !scratch ? 'hairness scratch create <title>' : null].filter(Boolean),
  }, 'SessionOpening')
}
