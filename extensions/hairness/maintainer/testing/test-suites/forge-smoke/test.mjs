export default {
  id: 'forge-smoke',
  actor: { id: 'forge-maintainer-fr', answers: { language: 'fr', usage: 'maintainer', 'profile.name': 'Alexis', trust: 'trust', providers: 'later', 'session.transcript': 'off', 'maintenance.gitWarnings': 'on', 'legacy.handoff': 'none' } },
  async test({ command, checks, actor, write }) {
    let gap = await command(['onboarding', 'next'], 250)
    while (gap.id) gap = await command(['onboarding', 'answer', gap.id, '--value', actor.answers[gap.id] ?? (gap.id.startsWith('source.') ? 'enable' : 'later')], 250)
    const plan = await command(['onboarding', 'plan'])
    await command(['onboarding', 'apply', '--checkpoint', plan.checkpointId])
    checks.push({ name: 'onboarding', ok: true })
    await command(['build', '--check'])
    const opening = await command(['opening', '--host', 'codex'], 500)
    await write('evidence/session-opening.json', opening)
    checks.push({ name: 'session-opening-language', ok: opening.profile.language === 'fr' && opening.instruction.includes('fr') })
  },
}
