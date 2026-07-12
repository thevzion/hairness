import { HairnessError } from '../core/errors.mjs'
import { applyOnboarding, answerOnboardingGap, nextOnboardingGap, onboardingPlan, onboardingState, resetOnboarding } from './onboarding.mjs'
import { buildProviders, cleanProviders, providerStatus } from '../providers/compiler.mjs'
import { doctorHost } from '../providers/probes.mjs'
import { preferencesCommand } from './preferences.mjs'

export async function extendedCommand(root, namespace, target, action, rest, flags) {
  if (namespace === 'build') return buildProviders(root, { provider: flags.provider, local: Boolean(flags.local), check: Boolean(flags.check) })
  if (namespace === 'clean') return cleanProviders(root, { local: Boolean(flags.local) })
  if (namespace === 'session' && target === 'opening') {
    const { buildSessionOpening } = await import('../prologue.mjs')
    return buildSessionOpening(root, flags.host ?? 'unknown')
  }

  if (namespace === 'host') {
    const mode = target ?? 'status'
    const host = action
    if (!host) throw new HairnessError('usage', 'Usage: hairness host status|doctor <codex|claude>', { exitCode: 2 })
    if (mode === 'doctor') return doctorHost(root, host)
    if (mode === 'status') return providerStatus(root, host)
  }

  if (namespace === 'preferences') return preferencesCommand(root, target, action, rest, flags)

  if (namespace === 'onboarding') {
    const mode = target ?? 'next'
    if (mode === 'next') return nextOnboardingGap(root)
    if (mode === 'status' || mode === 'review') return onboardingState(root)
    if (mode === 'answer') {
      if (!action || !flags.value) throw new HairnessError('usage', 'Usage: hairness onboarding answer <gap> --value <value>', { exitCode: 2 })
      return answerOnboardingGap(root, action, flags.value)
    }
    if (mode === 'plan') return onboardingPlan(root)
    if (mode === 'apply') {
      if (!flags.checkpoint) throw new HairnessError('usage', 'Usage: hairness onboarding apply --checkpoint <id>', { exitCode: 2 })
      return applyOnboarding(root, flags.checkpoint)
    }
    if (mode === 'reset') return resetOnboarding(root)
  }

  const { extensionCommand } = await import('./registry.mjs')
  return extensionCommand(root, namespace, target, action, rest, flags)
}
