import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateDocument } from '../src/contracts/index.mjs'
import { inspectExtension, validateComposition } from '../src/composition/extensions.mjs'

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/v0.3/golden-home.json', import.meta.url), 'utf8'))
await validateDocument(fixture, 'Home')
const extensions = []
for (const id of fixture.spec.extensions) extensions.push(await inspectExtension(new URL(`../assets/extensions/${id}/`, import.meta.url).pathname))
const composition = validateComposition(extensions)
assert.equal(composition.capabilities.size, 5)
assert.equal(composition.recipes.size, 10)
assert.equal(JSON.stringify(fixture).includes('protocolVersion'), false)
console.log('v0.3 conformance passed (Home + 4 extensions + core Targets + 10 recipes)')
