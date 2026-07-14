import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { assertInside, digest, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { applyEffect, prepareEffect } from './index.mjs'
import { ensureRuntime, runtimePaths } from '../runtime/index.mjs'

export async function runAdapter(root, reference, inputs = {}) {
  const adapter = await loadAdapter(root, reference)
  if (adapter.entry.mode === 'effect') throw new HairnessError('effect_requires_checkpoint', `${reference} must use operation prepare and apply.`)
  if (typeof adapter.module.run !== 'function') throw new HairnessError('adapter_invalid', `${reference} does not export run().`)
  return { mode: adapter.entry.mode, adapter: reference, result: await adapter.module.run({ root, inputs }) }
}

export async function prepareAdapterEffect(root, reference, inputs = {}) {
  const adapter = await loadAdapter(root, reference)
  if (adapter.entry.mode !== 'effect') throw new HairnessError('adapter_not_effect', `${reference} is ${adapter.entry.mode}; use operation run.`)
  if (typeof adapter.module.prepare !== 'function' || typeof adapter.module.apply !== 'function') throw new HairnessError('adapter_invalid', `${reference} must export prepare() and apply().`)
  const prepared = await adapter.module.prepare({ root, inputs })
  const checkpoint = await prepareEffect(root, {
    operation: reference,
    adapter: reference,
    inputs,
    evidence: prepared.evidence ?? {},
    policy: prepared.policy ?? {},
    target: prepared.target,
  })
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  await writeJsonAtomic(join(runtime.checkpoints, `${checkpoint.metadata.id}.adapter.json`), { reference, inputs })
  return { status: 'checkpoint-required', checkpoint, prepared }
}

export async function applyAdapterEffect(root, checkpointId) {
  const home = await loadHome(root)
  const stored = await readJson(join(runtimePaths(home.metadata.id).checkpoints, `${checkpointId}.adapter.json`))
  const adapter = await loadAdapter(root, stored.reference)
  const prepared = await adapter.module.prepare({ root, inputs: stored.inputs })
  return applyEffect(root, checkpointId, {
    inputs: stored.inputs,
    evidence: prepared.evidence ?? {},
    policy: prepared.policy ?? {},
    target: prepared.target,
  }, async () => adapter.module.apply({ root, inputs: stored.inputs, prepared }))
}

async function loadAdapter(root, reference) {
  const separator = reference.lastIndexOf(':')
  if (separator < 1) throw new HairnessError('adapter_reference_invalid', 'Use <extension-id>:<adapter-id>.')
  const owner = reference.slice(0, separator)
  const id = reference.slice(separator + 1)
  const home = await loadHome(root)
  const extension = (await activeExtensions(root, home)).find((item) => item.manifest.metadata.id === owner)
  if (!extension) throw new HairnessError('extension_not_active', `${owner} is not active.`)
  const entry = extension.manifest.spec.adapters.find((item) => item.id === id)
  if (!entry) throw new HairnessError('adapter_missing', `${reference} does not exist.`)
  const path = assertInside(extension.root, join(extension.root, entry.path), 'adapter path')
  const module = await import(`${pathToFileURL(path).href}?digest=${digest(await import('node:fs/promises').then(({ readFile }) => readFile(path)))}`)
  return { extension, entry, module }
}

