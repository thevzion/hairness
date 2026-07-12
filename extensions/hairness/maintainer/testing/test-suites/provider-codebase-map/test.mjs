import { forgeActor, onboard, ok } from '../_shared.mjs'

export default {
  id: 'provider-codebase-map',
  actor: forgeActor,
  async test({ command, checks, write }) {
    await onboard(command)
    const draft = await write('fixtures/map.json', { schemaVersion: 2, protocolVersion: '0.2', summary: 'Map one codebase from current proof.', inputs: {}, controls: { present: 'auto' }, route: 'worker' })
    const preview = await command(['invoke', 'start', '--operation', 'hairness/codebase:map', '--draft-json', draft, '--direct', '--auto'])
    ok(checks, 'map-routed-to-producer', preview.state === 'needs-agent' && preview.route.kind === 'worker')
    ok(checks, 'map-result-owned', preview.expectedResult.contract.artifactOwner === 'hairness/codebase')
    const sources = await command(['source', 'list'])
    ok(checks, 'selected-source-visible', sources.sources.some((source) => source.id === 'git'))
  },
}
