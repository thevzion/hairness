import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addExtensions, statusExtensions, syncExtensions } from '../src/extensions.mjs'
import { createHome } from '../src/create.mjs'

const temporary = await mkdtemp(join(tmpdir(), 'hairness-conformance-'))
try {
  const home = join(temporary, 'home')
  const source = join(temporary, 'extension')
  await createHome(home)
  await mkdir(source)
  const manifest = {
    $schema: 'https://hairness.dev/schema/extension.json',
    name: 'conformance/proof', version: '1.0.0', description: 'Conformance proof.',
    files: [{ path: 'proof.md', type: 'hairness:file' }],
  }
  await writeFile(join(source, 'hairness.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(source, 'proof.md'), 'one\n')
  await addExtensions(home, [join(source, 'hairness.json')])
  assert.equal((await statusExtensions(home, 'proof'))[0].state, 'clean')
  manifest.version = '2.0.0'
  await writeFile(join(source, 'hairness.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(source, 'proof.md'), 'two\n')
  assert.equal((await syncExtensions(home, 'proof', { check: true }))[0].status, 'available')
  await syncExtensions(home, 'proof')
  assert.equal(await readFile(join(home, 'extensions/conformance/proof/proof.md'), 'utf8'), 'two\n')
  console.log('conformance passed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
