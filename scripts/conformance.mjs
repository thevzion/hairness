import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addItems, statusItems, syncItems } from '../src/arranger.mjs'
import { createHome } from '../src/create.mjs'

const temporary = await mkdtemp(join(tmpdir(), 'hairness-conformance-'))
try {
  const home = join(temporary, 'home')
  await createHome(home)
  const itemPath = join(temporary, 'item.json')
  const item = {
    registry: 'conformance', name: 'proof', version: '1.0.0', type: 'hairness:extension', title: 'Proof', description: 'Conformance proof.', registryDependencies: [],
    files: [{ path: 'proof.md', type: 'hairness:file', content: 'one\n' }],
  }
  await writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`)
  await addItems(home, [itemPath])
  assert.equal((await statusItems(home, 'proof'))[0].state, 'clean')
  item.version = '2.0.0'
  item.files[0].content = 'two\n'
  await writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`)
  assert.equal((await syncItems(home, 'proof', { check: true }))[0].status, 'available')
  await syncItems(home, 'proof')
  assert.equal(await readFile(join(home, 'extensions/conformance/proof/proof.md'), 'utf8'), 'two\n')
  console.log('conformance passed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
