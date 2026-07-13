import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRun, promoteArtifact, readArtifact, stageArtifact, transitionRun, validateContract, workspacePaths } from '../src/core/index.mjs'
import { runCli } from '../src/cli.mjs'
import { artifactMetadata, assignment, temporaryWorkspace } from './helpers.mjs'

function stream() { let value = ''; return { write(chunk) { value += chunk }, read() { return value } } }

test('methodology output stays scratch until normalized into a semantic artifact', async () => {
  const binding = { id: 'fixture.method', providers: ['codex'], capabilities: ['mapping'], result: { schema: 'RunResult', disposition: 'scratch' } }
  const manifest = { schemaVersion: 2, protocolVersion: '0.2', id: 'fixture/method', version: '0.2.0-alpha.0', summary: 'Fixture methodology.', category: 'cognition', tags: ['fixture'], maturity: 'experimental', readme: './README.md', module: './index.mjs', capabilities: [], commands: [], commandSurfaces: [], methodologyBindings: [binding] }
  await validateContract('ExtensionManifest', manifest)

  const root = await temporaryWorkspace()
  process.env.HAIRNESS_ROOT = root
  const runId = 'methodology-scratch'
  await createRun(root, { id: runId, planId: 'methodology-plan', assignment: assignment({ id: 'fixture-method', result: binding.result }) })
  await transitionRun(root, runId, 'ready')
  await transitionRun(root, runId, 'running')
  const result = { schemaVersion: 2, protocolVersion: '0.2', runId, status: 'succeeded', summary: 'Raw method output.', outcome: { raw: 'provider-native output' }, proof: [], limits: [], routes: [] }
  const input = join(root, 'method-result.json')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(input, JSON.stringify(result)))
  const stdout = stream(); const stderr = stream()
  assert.equal(await runCli(['worker', runId, 'submit', '--file', input, '--json'], { stdout, stderr }), 0, stderr.read())
  await access(join(workspacePaths(root).scratch, 'fixture-method', runId, 'result.json'))

  const artifact = { schemaVersion: 2, protocolVersion: '0.2', id: 'gate/result', type: 'gate-result', owner: 'fixture/artifacts', revision: 'methodology-revision', runId: 'methodology-normalize', summary: 'Normalized semantic meaning.', metadata: artifactMetadata({ provenance: { kind: 'methodology', id: binding.id, provider: 'codex' } }), payload: { value: 'normalized' }, createdAt: new Date(0).toISOString() }
  await stageArtifact(root, artifact.runId, artifact)
  await promoteArtifact(root, artifact.runId)
  assert.equal((await readArtifact(root, artifact.id)).metadata.provenance.id, binding.id)
  assert.match(await readFile(join(workspacePaths(root).scratch, 'fixture-method', runId, 'result.json'), 'utf8'), /provider-native output/)
})
