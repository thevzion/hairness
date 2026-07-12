import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateContract } from '../src/core/contracts.mjs'
import { capabilityIndex, loadCapabilities, resolveOperation } from '../src/core/capabilities.mjs'

const forbiddenRootCapabilities = ['cockpit', 'codebases', 'intents', 'maintenance', 'sessions', 'sources', 'commands', 'create', 'extensions', 'onboarding', 'preferences', 'hosts']

async function extensionIds(root) {
  const ids = []
  for (const namespace of await readdir(join(root, 'extensions'))) for (const name of await readdir(join(root, 'extensions', namespace))) ids.push(`${namespace}/${name}`)
  return ids
}

async function inspected(root, id) {
  const path = join(root, 'extensions', ...id.split('/'))
  const manifest = JSON.parse(await readFile(join(path, 'extension.json'), 'utf8'))
  await validateContract('ExtensionManifest', manifest)
  const readmePath = resolve(path, manifest.readme)
  assert.ok(!relative(path, readmePath).startsWith('..'), `${id} README escapes its owner`)
  await access(readmePath)
  const capabilities = await loadCapabilities(path, manifest)
  const modulePath = resolve(path, manifest.module)
  assert.ok(!relative(path, modulePath).startsWith('..'), `${id} module escapes its owner`)
  const source = await readFile(modulePath, 'utf8')
  assert.ok(!/from\s+['"][^'"]*src\//.test(source), `${id} imports src/ instead of using its runtime`)
  const module = await import(`${pathToFileURL(modulePath).href}?ownership=${Date.now()}`)
  if (manifest.commands.length) assert.equal(typeof module.handleCommand, 'function', `${id} declares commands without handleCommand`)
  for (const service of manifest.services ?? []) assert.equal(typeof module.services?.[service], 'function', `${id} does not export service ${service}`)
  if ((manifest.contributes ?? []).includes('attention')) assert.equal(typeof module.attentionSignals, 'function', `${id} declares attention without attentionSignals`)
  if ((manifest.contributes ?? []).includes('authority-policy')) assert.equal(typeof module.authorityPolicy, 'function', `${id} declares authority-policy without authorityPolicy`)
  if ((manifest.contributes ?? []).includes('session-opening')) assert.equal(typeof module.sessionContributions, 'function', `${id} declares session-opening without sessionContributions`)
  if ((manifest.contributes ?? []).includes('session-renderer')) assert.equal(typeof module.renderSessionOpening, 'function', `${id} declares session-renderer without renderSessionOpening`)
  if ((manifest.contributes ?? []).includes('provider-hooks')) assert.equal(typeof module.providerHooks, 'function', `${id} declares provider-hooks without providerHooks`)
  if ((manifest.contributes ?? []).includes('onboarding')) assert.equal(typeof module.onboardingContributions, 'function', `${id} declares onboarding without onboardingContributions`)
  for (const command of manifest.providerCommands) {
    const pathValue = resolve(path, command.instructions)
    assert.ok(!relative(path, pathValue).startsWith('..'), `${command.id} instructions escape ${id}`)
    await access(pathValue)
  }
  for (const source of manifest.sourceDrivers ?? []) {
    const driverPath = resolve(path, source)
    assert.ok(!relative(path, driverPath).startsWith('..'), `${id} source driver escapes its owner`)
    const driver = JSON.parse(await readFile(driverPath, 'utf8'))
    await validateContract('SourceDriver', driver)
    const modulePath = resolve(join(driverPath, '..'), driver.module)
    assert.ok(!relative(join(driverPath, '..'), modulePath).startsWith('..'), `${driver.id} module escapes its driver`)
    const driverModule = await import(`${pathToFileURL(modulePath).href}?ownership=${Date.now()}`)
    for (const operation of driver.operations) assert.equal(typeof driverModule.operations?.[operation.id], 'function', `${driver.id} does not implement ${operation.id}`)
  }
  for (const binding of manifest.methodologyBindings ?? []) {
    if (binding.instructions) {
      const pathValue = resolve(path, binding.instructions)
      assert.ok(!relative(path, pathValue).startsWith('..'), `${binding.id} instructions escape ${id}`)
      await access(pathValue)
    }
    if (binding.inputSchema) {
      const pathValue = resolve(path, binding.inputSchema)
      assert.ok(!relative(path, pathValue).startsWith('..'), `${binding.id} input schema escapes ${id}`)
      await access(pathValue)
    }
  }
  for (const guidance of manifest.agentGuidance ?? []) {
    const pathValue = resolve(path, guidance.source)
    assert.ok(!relative(path, pathValue).startsWith('..'), `${guidance.id} guidance escapes ${id}`)
    await access(pathValue)
  }
  for (const artifact of manifest.artifactSchemas ?? []) {
    const pathValue = resolve(path, artifact.schema)
    assert.ok(!relative(path, pathValue).startsWith('..'), `${artifact.type} schema escapes ${id}`)
    await access(pathValue)
  }
  return { id, path, manifest, capabilities }
}

function validateComposition(name, ids, values) {
  const selected = new Map(ids.map((id) => [id, values.get(id)]))
  for (const [id, value] of selected) {
    assert.ok(value, `${name} references missing extension ${id}`)
    for (const dependency of value.manifest.dependencies ?? []) assert.ok(selected.has(dependency), `${name}: ${id} requires ${dependency}`)
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(id) {
    assert.ok(!visiting.has(id), `${name} contains a dependency cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of selected.get(id).manifest.dependencies ?? []) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const id of selected.keys()) visit(id)
}

export async function runExtensionOwnershipGate(root = new URL('../', import.meta.url).pathname) {
  for (const name of forbiddenRootCapabilities) await assert.rejects(access(join(root, 'src', `${name}.mjs`)), `${name}.mjs remains at src root`)
  const ids = await extensionIds(root)
  const values = new Map((await Promise.all(ids.map((id) => inspected(root, id)))).map((value) => [value.id, value]))
  const operations = capabilityIndex(values.values())
  const artifactOwners = new Map()
  const relationOwners = new Map()
  const modifierOwners = new Map()
  for (const value of values.values()) for (const artifact of value.manifest.artifactSchemas ?? []) {
    assert.ok(!artifactOwners.has(artifact.type), `${artifact.type} is owned by ${artifactOwners.get(artifact.type)} and ${value.id}`)
    artifactOwners.set(artifact.type, value.id)
  }
  for (const value of values.values()) for (const relation of value.manifest.relationTypes ?? []) {
    assert.ok(!relationOwners.has(relation), `${relation} relation is owned by ${relationOwners.get(relation)} and ${value.id}`)
    relationOwners.set(relation, value.id)
  }
  for (const value of values.values()) for (const modifier of value.manifest.intentModifiers ?? []) {
    assert.ok(!modifierOwners.has(modifier.id), `${modifier.id} modifier is owned by ${modifierOwners.get(modifier.id)} and ${value.id}`)
    modifierOwners.set(modifier.id, value.id)
  }
  for (const value of values.values()) for (const command of value.manifest.providerCommands) if (command.kind !== 'bridge') resolveOperation(operations, command.operation)
  for (const recipeName of (await readdir(join(root, 'catalog')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))) {
    const recipe = JSON.parse(await readFile(join(root, 'catalog', `${recipeName}.json`), 'utf8'))
    validateComposition(recipeName, recipe.extensions, values)
    for (const capability of recipe.capabilities) {
      const spec = operations.capabilities.get(capability)
      assert.ok(spec, `${recipeName} references missing capability ${capability}`)
      assert.ok(recipe.extensions.includes(spec.owner), `${recipeName} selects ${capability} without owner ${spec.owner}`)
    }
  }
  const core = (await Promise.all((await readdir(join(root, 'src', 'core'))).filter((name) => name.endsWith('.mjs')).map((name) => readFile(join(root, 'src', 'core', name), 'utf8')))).join('\n')
  for (const id of ids) assert.ok(!core.includes(`'${id}`) && !core.includes(`"${id}`), `core contains extension ID ${id}`)
  assert.ok(!/source\s*={2,3}\s*['"](?:git|jira|gitlab|aws)['"]/.test(core), 'core branches on a concrete source')
  assert.ok(!/TestActor|TestCase|CheckpointPolicy|TestRunManifest|TestRunReceipt/.test(core), 'core contains maintainer test contracts')
  const providerCompiler = await readFile(join(root, 'src/providers/compiler.mjs'), 'utf8')
  assert.ok(!/workerFiles\(provider\)\) files\.push\(\[join\(base, path\), content, 'hairness\/cockpit'\]\)/.test(providerCompiler), 'protocol worker outputs are attributed to the cockpit')
  const minimal = await readFile(join(root, 'catalog/minimal.json'), 'utf8').then(JSON.parse).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (minimal) assert.deepEqual(minimal.extensions, ['hairness/cockpit', 'hairness/distribution'], 'minimal contains behavior beyond the cockpit and lifecycle')
  return { extensions: values.size, artifactTypes: artifactOwners.size }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await runExtensionOwnershipGate()
  console.log(`extension ownership passed (${report.extensions} extensions, ${report.artifactTypes} artifact types)`)
}
