import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { activeExtensions, inspectExtension, validateComposition } from '../src/composition/extensions.mjs'
import { loadDistribution } from '../src/composition/distributions.mjs'
import { compileSchemas, validateDocument } from '../src/contracts/index.mjs'
import { loadHome, loadHomeLock } from '../src/home/index.mjs'
import { digest } from '../src/lib/io.mjs'

const root = new URL('../', import.meta.url).pathname

async function files(directory) {
  const values = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.overlay', 'node_modules'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) values.push(...await files(path))
    else values.push(path)
  }
  return values
}

assert.equal((await compileSchemas()).length, 9)
const home = await loadHome(root)
const lock = await loadHomeLock(root)
assert.equal(home.metadata.id, lock.metadata.id)
const active = await activeExtensions(root, home)
validateComposition(active)
for (const extension of active) {
  const entry = lock.extensions.find((item) => item.id === extension.manifest.metadata.id)
  assert.ok(entry, `lock misses ${extension.manifest.metadata.id}`)
  assert.equal(entry.installedBaseDigest, extension.digest, `lock digest is stale for ${extension.manifest.metadata.id}`)
}
for (const preset of ['minimal', 'standard']) await validateDocument((await loadDistribution(preset)).document, 'Distribution')
for (const extension of active) await inspectExtension(extension.root)

const standard = (await loadDistribution('standard')).document
assert.equal(lock.distribution.digest, digest(standard), 'development Distribution lock is stale')
assert.deepEqual(standard.spec.extensions, ['hairness/cockpit', 'hairness/work', 'hairness/sources', 'hairness/codebase', 'hairness/delivery'])
const recipes = active.filter((extension) => standard.spec.extensions.includes(extension.manifest.metadata.id)).flatMap((extension) => extension.manifest.spec.recipes.map((recipe) => recipe.id)).sort()
assert.deepEqual(recipes, ['hairness', 'hairness-discuss', 'hairness-ideate', 'hairness-map', 'hairness-onboarding', 'hairness-plan', 'hairness-propose', 'hairness-recap', 'hairness-scratch', 'hairness-ship'].sort())

const all = await files(root)
for (const path of all.filter((path) => path.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' })
for (const path of all) {
  const name = relative(root, path)
  assert.ok(!/(^|\/)(?:\.overlay|node_modules)(?:\/|$)/.test(name) && !name.startsWith('runtime/'), `tracked runtime path: ${name}`)
  if (!/\.(?:md|mjs|json|yml|yaml)$/.test(name)) continue
  const body = await readFile(path, 'utf8')
  assert.ok(!/AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY/.test(body), `${name} contains secret-like material`)
  if (name.startsWith('src/')) {
    for (const removed of ['protocolVersion', 'schemaVersion', 'Invocation', 'WorkerCapsule', 'fan-in']) assert.equal(body.includes(removed), false, `${name} contains removed v0.2 model ${removed}`)
  }
}

console.log(`check passed (${all.length} files, ${active.length} active development extensions)`)
