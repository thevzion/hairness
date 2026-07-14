import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { validateContract, validateSchemaSet } from '../src/core/contracts.mjs'
import { runExtensionOwnershipGate } from './extension-ownership-gate.mjs'

const root = new URL('../', import.meta.url).pathname

async function files(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.overlay', 'node_modules'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await files(path))
    else output.push(path)
  }
  return output
}

await validateSchemaSet()
await runExtensionOwnershipGate(root)
const manifest = JSON.parse(await readFile(join(root, 'hairness.json'), 'utf8'))
await validateContract('DistributionManifest', manifest)
const distributionLock = JSON.parse(await readFile(join(root, 'hairness.lock.json'), 'utf8'))
await validateContract('DistributionLock', distributionLock)
assert.ok(!JSON.stringify(distributionLock).includes('/Users/'), 'distribution lock contains an absolute user path')

for (const extension of manifest.extensions) {
  const path = join(root, extension.path, 'extension.json')
  const value = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(value.id, extension.id)
  await validateContract('ExtensionManifest', value)
}

const allFiles = await files(root)
// v0.3 assets are validated by the new type-specific registry while the v0.2
// public runtime remains green before the atomic cutover.
const legacyExtensionFiles = allFiles.filter((path) => path.endsWith('/extension.json') && !relative(root, path).startsWith('assets/extensions/'))
if (manifest.role === 'forge') {
  const extensionCatalog = await readFile(join(root, 'docs/extensions/catalog.md'), 'utf8')
  const { renderExtensionCatalog } = await import('./generate-extension-catalog.mjs')
  assert.equal(extensionCatalog, await renderExtensionCatalog(root), 'extension catalogue is stale')
  for (const path of legacyExtensionFiles) {
    const extension = JSON.parse(await readFile(path, 'utf8'))
    assert.ok(extensionCatalog.includes(`\`${extension.id}\``), `extension catalogue misses ${extension.id}`)
  }
}
for (const path of legacyExtensionFiles) {
  const extension = await validateContract('ExtensionManifest', JSON.parse(await readFile(path, 'utf8')))
  const rootPath = join(path, '..')
  const readme = await readFile(join(rootPath, extension.readme), 'utf8')
  for (const heading of ['Value and use cases', 'Selection and setup', 'Capabilities and operations', 'Inputs, controls and results', 'State and artifacts', 'Effects and safety', 'Providers', 'Tests and maturity']) assert.ok(readme.includes(`## ${heading}`), `${extension.id} README misses ${heading}`)
}
for (const name of await readdir(join(root, 'catalog', 'materials'))) await validateContract('MaterialSet', JSON.parse(await readFile(join(root, 'catalog', 'materials', name), 'utf8')))
const recipes = (await readdir(join(root, 'catalog')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))
for (const name of recipes) {
  const recipe = JSON.parse(await readFile(join(root, 'catalog', `${name}.json`), 'utf8'))
  await validateContract('DistributionRecipe', recipe)
  const commands = []
  for (const id of recipe.extensions) {
    const extension = JSON.parse(await readFile(join(root, 'extensions', ...id.split('/'), 'extension.json'), 'utf8'))
    commands.push(...extension.commandSurfaces)
  }
  assert.equal(new Set(commands.map((command) => command.id)).size, commands.length, `${name} has provider command ID collisions`)
  assert.equal(new Set(commands.map((command) => command.id)).size, commands.length, `${name} has command surface collisions`)
}
if (manifest.role === 'forge') assert.ok(allFiles.filter((path) => relative(root, path).startsWith('extensions/')).every((path) => relative(root, path).startsWith('extensions/hairness/')), 'generic forge contains a non-generic extension owner')
for (const path of allFiles.filter((path) => path.endsWith('.mjs'))) {
  execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' })
}

const agentsLines = (await readFile(join(root, 'AGENTS.md'), 'utf8')).trimEnd().split('\n').length
assert.ok(agentsLines >= 20 && agentsLines <= 40, `AGENTS.md has ${agentsLines} lines`)

for (const path of allFiles) {
  const name = relative(root, path)
  assert.ok(!name.startsWith('.overlay/'))
  if (!/\.(?:md|mjs|json|yml|yaml|toml)$/.test(name)) continue
  const body = await readFile(path, 'utf8')
  assert.ok(!body.includes(['[', 'TODO:'].join('')), `${name} contains a scaffold placeholder`)
  assert.ok(!/AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY/.test(body), `${name} contains secret-like material`)
}

console.log(`check passed (${allFiles.length} files)`)
