import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyExtensionPlan, prepareExtensionAdd } from '../src/composition/lifecycle.mjs'
import { createHome } from '../src/home/create.mjs'
import { exists, writeJsonAtomic } from '../src/lib/io.mjs'
import { applyAdapterEffect, prepareAdapterEffect, runAdapter } from '../src/operations/adapters.mjs'

test('observe adapters run directly while effect adapters require prepare and apply', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-v3-adapter-'))
  process.env.HAIRNESS_STATE_HOME = join(root, 'state')
  t.after(async () => {
    delete process.env.HAIRNESS_STATE_HOME
    await rm(root, { recursive: true, force: true })
  })
  const home = join(root, 'home')
  await createHome(home, { preset: 'minimal', language: 'en', providers: ['codex'], overlayGit: false, install: false })
  const extension = join(root, 'adapter-extension')
  await mkdir(extension, { recursive: true })
  await writeJsonAtomic(join(extension, 'extension.json'), {
    apiVersion: 'hairness.dev/extension/v1alpha1', kind: 'Extension',
    metadata: { id: 'acme/adapters', version: '1.0.0', summary: 'Adapter modes.' },
    spec: {
      provides: ['acme.adapters'], requires: [], recipes: [], schemas: [], gates: [], onboarding: [], tests: [],
      adapters: [
        { id: 'read', mode: 'observe', path: 'read.mjs', capability: 'acme.adapters' },
        { id: 'write', mode: 'effect', path: 'write.mjs', capability: 'acme.adapters' }
      ]
    }
  })
  await writeFile(join(extension, 'read.mjs'), `export async function run({ inputs }) { return { value: inputs.value } }\n`)
  await writeFile(join(extension, 'write.mjs'), `
import { readFile, writeFile } from 'node:fs/promises'
export async function prepare({ inputs }) {
  const state = await readFile(inputs.state, 'utf8')
  return { target: { id: 'file', state }, evidence: { state }, policy: { explicit: true } }
}
export async function apply({ inputs }) {
  if (inputs.fail) throw new Error('simulated ambiguous transport')
  await writeFile(inputs.output, inputs.value)
  return { output: inputs.output }
}
`)
  const add = await prepareExtensionAdd(home, extension)
  await applyExtensionPlan(home, add.checkpoint.metadata.id)
  assert.deepEqual((await runAdapter(home, 'acme/adapters:read', { value: 42 })).result, { value: 42 })
  await assert.rejects(runAdapter(home, 'acme/adapters:write', {}), (error) => error.code === 'effect_requires_checkpoint')

  const state = join(root, 'state.txt')
  const output = join(root, 'effect.txt')
  await writeFile(state, 'v1')
  const prepared = await prepareAdapterEffect(home, 'acme/adapters:write', { state, output, value: 'applied' })
  assert.equal(await exists(output), false)
  await writeFile(state, 'v2')
  await assert.rejects(applyAdapterEffect(home, prepared.checkpoint.metadata.id), (error) => error.code === 'checkpoint_stale')
  assert.equal(await exists(output), false)

  const fresh = await prepareAdapterEffect(home, 'acme/adapters:write', { state, output, value: 'applied' })
  await applyAdapterEffect(home, fresh.checkpoint.metadata.id)
  assert.equal(await readFile(output, 'utf8'), 'applied')

  const unknown = await prepareAdapterEffect(home, 'acme/adapters:write', { state, output, value: 'ignored', fail: true })
  await assert.rejects(
    applyAdapterEffect(home, unknown.checkpoint.metadata.id),
    (error) => error.code === 'effect_unknown' && error.details.receipt.spec.outcome === 'unknown',
  )

  const changed = await prepareAdapterEffect(home, 'acme/adapters:write', { state, output, value: 'changed' })
  const installedAdapter = join(home, 'extensions/acme/adapters/write.mjs')
  await writeFile(installedAdapter, `${await readFile(installedAdapter, 'utf8')}\n// changed after prepare\n`)
  await assert.rejects(
    applyAdapterEffect(home, changed.checkpoint.metadata.id),
    (error) => error.code === 'checkpoint_stale',
  )
})
