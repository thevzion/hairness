import { forgeActor, onboard, ok } from '../_shared.mjs'

export default {
  id: 'provider-discussion-recap',
  actor: forgeActor,
  async test({ command, checks, write }) {
    await onboard(command)
    await command(['work', 'mission', 'set', '--id', 'conversation', '--summary', 'Qualify one discussion.'])
    await command(['work', 'segment', 'open', '--id', 'discussion', '--summary', 'Discuss and recap one bounded subject.'])
    const draft = await write('fixtures/discuss.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Discuss the active subject.', inputs: {}, controls: { present: 'compact' } })
    const preview = await command(['invoke', 'start', '--operation', 'hairness/work:discuss', '--draft-json', draft, '--direct', '--auto'])
    ok(checks, 'discussion-routed-inline', preview.state === 'needs-agent' && preview.route.kind === 'inline')
    const recap = await command(['work', 'recap'])
    ok(checks, 'recap-producer-bounded', recap.status === 'ready' && recap.capsule.profile === 'producer')
  },
}
