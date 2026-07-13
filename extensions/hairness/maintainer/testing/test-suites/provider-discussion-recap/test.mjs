import { forgeActor, onboard, ok } from '../_shared.mjs'

export default {
  id: 'provider-discussion-recap',
  actor: forgeActor,
  async test({ command, checks, write }) {
    await onboard(command)
    await command(['work', 'mission', 'set', '--id', 'conversation', '--summary', 'Qualify one discussion.'])
    await command(['work', 'segment', 'open', '--id', 'discussion', '--summary', 'Discuss and recap one bounded subject.'])
    const dashboardDraft = await write('fixtures/show-work.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Show active work.', inputs: {}, controls: {}, origin: { kind: 'command', commandId: 'hairness.work.show-work' }, result: 'dashboard' })
    const dashboard = await command(['invoke', 'start', '--operation', 'hairness/work:inspect', '--draft-json', dashboardDraft, '--auto'])
    ok(checks, 'deterministic-command-completes', dashboard.receipt.status === 'completed' && dashboard.result.payload.results[0].view === 'work')
    const draft = await write('fixtures/discuss.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Discuss the active subject.', inputs: {}, controls: { present: 'compact' } })
    const preview = await command(['invoke', 'start', '--operation', 'hairness/work:discuss', '--draft-json', draft, '--direct', '--auto'])
    ok(checks, 'discussion-routed-inline', preview.state === 'needs-agent' && preview.route.kind === 'inline')
    const recapDraft = await write('fixtures/recap.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Recap the active subject.', inputs: {}, controls: {} })
    const recapPreview = await command(['invoke', 'start', '--operation', 'hairness/work:recap', '--draft-json', recapDraft, '--direct', '--auto'])
    const recapPacket = await command(['work', 'make-recap'])
    const result = await write('fixtures/recap-result.json', { summary: recapPacket.summary, payload: recapPacket, proof: [], limits: [], routes: [] })
    await command(['invoke', 'complete', recapPreview.id, '--result-json', result])
    const recap = await command(['work', 'save-recap', '--invocation', recapPreview.id])
    if (recap.revision !== recapPreview.id) throw new Error(`Recap revision mismatch: expected ${recapPreview.id}, received ${recap.revision ?? 'none'} (${recap.status ?? 'no-status'}: ${recap.summary ?? 'no-summary'}).`)
    ok(checks, 'recap-promotes-exact-revision', recap.revision === recapPreview.id)
    ok(checks, 'recap-promotes-discussion-segment', recap.payload.segmentId === 'discussion')
  },
}
