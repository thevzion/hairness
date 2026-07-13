import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export async function temporaryWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'hairness-test-'))
  const extension = join(root, 'extensions', 'fixture', 'artifacts')
  await mkdir(join(extension, 'schemas'), { recursive: true })
  await mkdir(join(extension, 'capabilities'), { recursive: true })
  await writeFile(join(extension, 'index.mjs'), 'export const services = {}\n')
  await writeFile(join(extension, 'schemas/gate-result.schema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['value'], properties: { value: { type: 'string' } }, additionalProperties: false }))
  await writeFile(join(extension, 'schemas/produce-input.schema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['topic'], properties: { topic: { type: 'string', minLength: 1 } }, additionalProperties: false }))
  await writeFile(join(extension, 'capabilities/artifacts.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', id: 'fixture/artifacts', owner: 'fixture/artifacts', version: '0.2.0-alpha.0', summary: 'Fixture operations.', operations: [{ id: 'produce', class: 'derive', summary: 'Produce fixture data.', inputSchema: './schemas/produce-input.schema.json', results: [{ id: 'response', contract: { schema: 'ContextPacket', disposition: 'response' } }, { id: 'artifact', contract: { schema: 'ArtifactEnvelope', disposition: 'artifact', artifactOwner: 'fixture/artifacts', artifactType: 'gate-result' } }], defaultResult: 'response', sources: [], effects: [], routes: ['worker'], acceptsModifiers: [] }, { id: 'mutate', class: 'effect', summary: 'Mutate fixture data.', results: [{ id: 'default', contract: { schema: 'ChangeReceipt', disposition: 'effect' } }], defaultResult: 'default', sources: [], effects: ['filesystem:write'], routes: ['worker'], acceptsModifiers: [] }] }))
  await writeFile(join(extension, 'extension.json'), JSON.stringify({ schemaVersion: 2, protocolVersion: '0.2', id: 'fixture/artifacts', version: '0.2.0-alpha.0', summary: 'Fixture artifact extension.', category: 'ecosystem', tags: ['fixture'], maturity: 'experimental', readme: './README.md', module: './index.mjs', capabilities: ['./capabilities/artifacts.json'], dependencies: [], commands: [], commandSurfaces: [], artifactSchemas: [{ type: 'gate-result', schema: './schemas/gate-result.schema.json' }] }))
  await writeFile(join(extension, 'README.md'), '# fixture/artifacts\n')
  await writeFile(join(root, 'hairness.json'), JSON.stringify({
    schemaVersion: 2,
    protocolVersion: '0.2',
    implementationVersion: '0.2.0-alpha.0',
    role: 'distribution',
    catalogRoots: [],
    name: 'test',
    displayName: 'Test Hairness',
    providerPrefix: 'test',
    core: './src/core/index.mjs',
    defaults: {},
    extensions: [{ id: 'fixture/artifacts', path: './extensions/fixture/artifacts' }],
    sources: [],
    codebases: [],
  }))
  return root
}

export function artifactMetadata(overrides = {}) {
  return { labels: [], signals: [], relations: [], freshness: { policy: 'manual' }, provenance: { kind: 'worker', id: 'fixture-worker' }, ...overrides }
}

export function assignment(overrides = {}) {
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'map-ticket',
    operation: { capability: 'fixture/artifacts', id: 'produce' },
    profile: 'producer',
    goal: 'Map the ticket.',
    outcome: 'A compact ticket map.',
    workload: 'fast',
    inputs: [],
    targets: [],
    exclusions: [],
    allowedSources: ['ticket:read'],
    requestedEffects: [],
    result: { schema: 'ArtifactEnvelope', disposition: 'artifact', artifactOwner: 'fixture/artifacts', artifactType: 'gate-result' },
    ...overrides,
  }
}

export function intent() {
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: 'intent-1',
    summary: 'Implement the ticket.',
    outcome: 'Tested working tree changes.',
    targets: ['app'],
    limits: [],
  }
}

export function runResult(runId, overrides = {}) {
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    runId,
    status: 'succeeded',
    summary: 'Completed.',
    outcome: {},
    proof: ['proof:fixture'],
    limits: [],
    routes: [],
    ...overrides,
  }
}
