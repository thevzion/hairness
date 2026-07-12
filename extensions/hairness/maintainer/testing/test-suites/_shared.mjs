import assert from 'node:assert/strict'

export const forgeActor = { id: 'forge-maintainer-fr', answers: { language: 'fr', usage: 'maintainer', 'profile.name': 'Alexis', 'profile.timezone': 'Europe/Paris', trust: 'trust', providers: 'later', 'session.transcript': 'off', 'maintenance.gitWarnings': 'on', 'legacy.handoff': 'none' } }
export async function onboard(command, actor = forgeActor) {
  let gap = await command(['onboarding', 'next'], 250)
  while (gap.id) {
    const value = actor.answers[gap.id] ?? (gap.id.startsWith('source.') ? 'enable' : gap.id.startsWith('identity.') ? 'later' : 'later')
    gap = await command(['onboarding', 'answer', gap.id, '--value', value], 250)
  }
  const plan = await command(['onboarding', 'plan'])
  await command(['onboarding', 'apply', '--checkpoint', plan.checkpointId])
  return plan
}
export function ok(checks, name, condition) { checks.push({ name, ok: Boolean(condition) }); assert.ok(condition, name) }
