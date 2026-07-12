import { forgeActor, onboard, ok } from '../_shared.mjs'

export default {
  id: 'provider-plan-effect-gate',
  actor: forgeActor,
  async test({ command, checks, write }) {
    await onboard(command)
    const draft = await write('fixtures/act.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Apply one accepted bounded frame.', inputs: {}, controls: {} })
    const preview = await command(['invoke', 'start', '--operation', 'hairness/work:act', '--draft-json', draft, '--direct', '--auto'])
    ok(checks, 'effect-stops-for-authority', preview.state === 'needs-authority')
    ok(checks, 'checkpoint-is-next', preview.next.action === 'checkpoint')
    ok(checks, 'effect-result-declared', preview.expectedResult.contract.disposition === 'effect')
  },
}
