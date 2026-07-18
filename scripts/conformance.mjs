import assert from 'node:assert/strict'
import { validateDocument } from '../src/contracts.mjs'
import { validateComposition } from '../src/extensions.mjs'

const fixture = {
  apiVersion: 'hairness.dev/home/v1alpha2',
  kind: 'Home',
  metadata: { id: 'conformance' },
  spec: { providers: ['codex', 'claude'], extensions: [], targets: [], integrations: [], config: {} },
}
await validateDocument(fixture, 'Home')
const composition = await validateComposition([])
assert.deepEqual([...composition.skills.keys()].sort(), ['hairness', 'hairness-onboarding', 'hairness-scratch'])
assert.deepEqual([...composition.commands.keys()].sort(), ['hairness', 'hairness-onboarding', 'hairness-scratch'])
assert.equal(JSON.stringify(fixture).includes('protocolVersion'), false)
console.log('v0.4 conformance passed (Home + core Skills/Commands)')
