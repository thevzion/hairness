import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateDocument } from '../src/contracts.mjs'
import { validateExactSpec } from '../src/packages.mjs'

const root = new URL('../', import.meta.url).pathname
const native = JSON.parse(await readFile(join(root, 'packages/native/package.json'), 'utf8'))
const starter = JSON.parse(await readFile(join(root, 'packages/starter/package.json'), 'utf8'))
await validateDocument(native.hairness, 'package')
await validateDocument(starter.hairness, 'package')
assert.deepEqual(starter.hairness.extensions, ['@hairness/native'])
assert.equal(starter.dependencies['@hairness/native'], native.version)
validateExactSpec(`@hairness/native@${starter.dependencies['@hairness/native']}`)
assert.equal(native.hairness.kind, 'Extension')
assert.equal(starter.hairness.kind, 'Starter')
console.log('conformance passed')
