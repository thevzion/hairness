import test from 'node:test'
import assert from 'node:assert/strict'
import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extensionCommand } from '../src/distribution/registry.mjs'

async function writeExtension(root, base, id, options = {}) {
  const path = join(root, base, ...id.split('/'))
  await mkdir(join(path, 'commands'), { recursive: true })
  await mkdir(join(path, 'capabilities'), { recursive: true })
  const commands = options.commands ?? []
  for (const command of commands) await writeFile(join(path, 'commands', `${command.namespace}.md`), `Run ${command.namespace}.\n`)
  const capabilityId = `${id.split('/')[0]}/${id.split('/')[1]}-fixture`
  await writeFile(join(path, 'capabilities/fixture.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', id: capabilityId, owner: id, version: '0.2.0-alpha.0', summary: `Fixture capability for ${id}.`, operations: [{ id: 'run', class: 'derive', summary: 'Run the fixture.', results: [{ id: 'default', contract: { schema: 'ContextPacket', disposition: 'response' } }], defaultResult: 'default', sources: [], effects: [], routes: ['inline'], acceptsModifiers: [] }] }))
  await writeFile(join(path, 'extension.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', id, version: '0.2.0-alpha.0', summary: `Fixture extension for ${id}.`, category: 'ecosystem', tags: ['fixture'], maturity: 'experimental', readme: './README.md', module: './index.mjs', capabilities: ['./capabilities/fixture.json'], dependencies: options.dependencies ?? [], services: options.services ?? [], commands, commandSurfaces: commands.map((command) => ({ id: `${id.replace('/', '.')}.${command.namespace}`, summary: `Run ${command.namespace}.`, classification: 'specialized', surface: 'specialized', machineRoute: `hairness ${command.namespace}`, arguments: [], resultId: 'default', operation: { capability: capabilityId, id: 'run' }, instructions: `./commands/${command.namespace}.md` })) }))
  await writeFile(join(path, 'README.md'), `# ${id}\n`)
  await writeFile(join(path, 'index.mjs'), options.module ?? 'export const services = {}\n')
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hairness-runtime-'))
  const home = join(root, 'home')
  await writeExtension(root, 'extensions', 'fixture/alpha', { services: ['inspect'], module: "export const services = { inspect: async ({ input }) => ({ value: input.value }) }\n" })
  await writeExtension(root, 'extensions', 'fixture/beta', { dependencies: ['fixture/alpha'], commands: [{ namespace: 'beta', actions: ['show'] }], module: "export async function handleCommand({ runtime }) { await runtime.overlay.write('state.json', { ok: true }); return runtime.extensions.call('fixture/alpha', 'inspect', { value: await runtime.overlay.read('state.json') }) }\n" })
  await writeFile(join(root, 'hairness.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', implementationVersion: '0.2.0-alpha.0', role: 'distribution', catalogRoots: [], name: 'fixture', displayName: 'Fixture', providerPrefix: 'fixture', core: './src/core/index.mjs', extensions: [{ id: 'fixture/alpha', path: './extensions/fixture/alpha' }, { id: 'fixture/beta', path: './extensions/fixture/beta' }], sources: [], codebases: [] }))
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'trust.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', workspaces: { [root]: { trusted: true } }, extensions: {} }))
  process.env.HAIRNESS_HOME = home
  return root
}

test('runtime is frozen, services require dependencies, and overlay state is owner-scoped', async () => {
  const root = await fixture()
  const result = await extensionCommand(root, 'beta', 'show', undefined, [], {})
  assert.deepEqual(result, { value: { ok: true } })
  assert.deepEqual(JSON.parse(await readFile(join(root, '.overlay/extensions-state/fixture/beta/state.json'), 'utf8')), { ok: true })
})

test('runtime rejects Assignment effects not declared by its Operation', async () => {
  const root = await fixture()
  const capabilityPath = join(root, 'extensions/fixture/alpha/capabilities/fixture.json')
  const capability = JSON.parse(await readFile(capabilityPath, 'utf8'))
  capability.operations = [{ id: 'run', class: 'effect', summary: 'Mutate one declared target.', results: [{ id: 'default', contract: { schema: 'ChangeReceipt', disposition: 'effect' } }], defaultResult: 'default', sources: [], effects: ['filesystem:write'], routes: ['worker'], acceptsModifiers: [] }]
  await writeFile(capabilityPath, JSON.stringify(capability))
  const modulePath = join(root, 'extensions/fixture/beta/index.mjs')
  await writeFile(modulePath, `export async function handleCommand({ runtime }) {
    return runtime.runs.create({ id: 'undeclared-effect', planId: 'fixture-plan', assignment: {
      schemaVersion: 2, protocolVersion: '0.2', id: 'undeclared-effect-assignment',
      operation: { capability: 'fixture/alpha-fixture', id: 'run' }, profile: 'executor',
      goal: 'Request an undeclared effect.', outcome: 'Rejected.', workload: 'fast', inputs: [], targets: [], exclusions: [], allowedSources: [],
      requestedEffects: ['git:push'], result: { schema: 'ChangeReceipt', disposition: 'effect' }
    } })
  }\n`)
  await assert.rejects(extensionCommand(root, 'beta', 'show', undefined, [], {}), (error) => error.code === 'operation_effect_undeclared')
})

test('dependency cycles block extension doctor', async () => {
  const root = await fixture()
  const manifestPath = join(root, 'extensions/fixture/alpha/extension.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies = ['fixture/beta']
  await writeFile(manifestPath, JSON.stringify(manifest))
  const report = await extensionCommand(root, 'extension', 'doctor', 'fixture/alpha', [], {})
  assert.equal(report.status, 'blocked')
  assert.match(report.limits.join(' '), /cycle/)
})

test('extension add and remove activate and remove owned logic', async () => {
  const root = await fixture()
  await writeExtension(root, 'catalog/extensions', 'fixture/extra', { commands: [{ namespace: 'extra', actions: ['show'] }], module: "export async function handleCommand() { return { status: 'active' } }\n" })
  const source = join(root, 'catalog/extensions')
  const planned = await extensionCommand(root, 'extension', 'add', 'fixture/extra', [], { from: source })
  await extensionCommand(root, 'extension', 'add', 'fixture/extra', [], { from: source, checkpoint: planned.checkpointId })
  assert.equal((await extensionCommand(root, 'extra', 'show', undefined, [], {})).status, 'active')
  const removal = await extensionCommand(root, 'extension', 'remove', 'fixture/extra', [], {})
  await extensionCommand(root, 'extension', 'remove', 'fixture/extra', [], { checkpoint: removal.checkpointId })
  await assert.rejects(extensionCommand(root, 'extra', 'show', undefined, [], {}), (error) => error.code === 'unknown_command')
})

test('extension link and unlink preserve the external source', async () => {
  const root = await fixture()
  const source = await mkdtemp(join(tmpdir(), 'hairness-linked-source-'))
  await writeExtension(source, 'extensions', 'fixture/local', { dependencies: ['fixture/alpha'], commands: [{ namespace: 'local', actions: ['show'] }], module: "export async function handleCommand() { return { status: 'linked' } }\n" })
  const planned = await extensionCommand(root, 'extension', 'link', undefined, [], { local: 'fixture/local', from: source })
  await extensionCommand(root, 'extension', 'link', undefined, [], { local: 'fixture/local', from: source, checkpoint: planned.checkpointId })
  const linked = join(root, '.overlay/extensions/fixture/local')
  assert.equal((await lstat(linked)).isSymbolicLink(), true)
  assert.equal((await extensionCommand(root, 'local', 'show', undefined, [], {})).status, 'linked')
  const removal = await extensionCommand(root, 'extension', 'unlink', undefined, [], { local: 'fixture/local' })
  await extensionCommand(root, 'extension', 'unlink', undefined, [], { local: 'fixture/local', checkpoint: removal.checkpointId })
  await assert.rejects(access(linked))
  await access(join(source, 'extensions/fixture/local/extension.json'))
})

test('local extension scaffold is disabled, documented and explicit', async () => {
  const root = await fixture()
  const created = await extensionCommand(root, 'extension', 'init', undefined, [], { local: 'fixture/scaffold' })
  assert.equal(created.status, 'disabled')
  const manifest = JSON.parse(await readFile(join(root, '.overlay/extensions/fixture/scaffold/extension.json'), 'utf8'))
  assert.equal(manifest.maturity, 'experimental')
  assert.equal(manifest.readme, './README.md')
  assert.match(await readFile(join(root, '.overlay/extensions/fixture/scaffold/README.md'), 'utf8'), /## Effects and safety/)
  const config = JSON.parse(await readFile(join(root, '.overlay/config.json'), 'utf8'))
  assert.equal(config.extensions.local.find((entry) => entry.id === 'fixture/scaffold').enabled, false)
})

test('legacy local extension state is ignored and reported without blocking active owners', async () => {
  const root = await fixture()
  await mkdir(join(root, '.overlay'), { recursive: true })
  await writeFile(join(root, '.overlay/config.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', extensions: { disabled: [], local: [{ id: 'legacy/missing', path: './.overlay/extensions/legacy/missing', enabled: true }] } }))
  assert.deepEqual(await extensionCommand(root, 'beta', 'show', undefined, [], {}), { value: { ok: true } })
  const report = await extensionCommand(root, 'extension', 'doctor', 'legacy/missing', [], {})
  assert.equal(report.status, 'partial')
  assert.deepEqual(report.limits, ['legacy-extension-state'])
})
