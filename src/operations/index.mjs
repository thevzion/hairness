import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { API, validateDocument } from '../contracts/index.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, now, readJson, writeJsonAtomic } from '../lib/io.mjs'
import { ensureRuntime } from '../runtime/index.mjs'

function checkpointId() {
  return `checkpoint-${randomUUID()}`
}

function receiptId() {
  return `receipt-${randomUUID()}`
}

export async function prepareEffect(root, request) {
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  const id = checkpointId()
  const checkpoint = {
    apiVersion: API.checkpoint,
    kind: 'Checkpoint',
    metadata: { id, createdAt: now() },
    spec: {
      operation: request.operation,
      mode: 'effect',
      adapter: request.adapter,
      target: request.target,
      inputsDigest: digest(request.inputs ?? {}),
      evidenceDigest: digest(request.evidence ?? {}),
      policyDigest: digest(request.policy ?? {}),
      status: 'prepared',
    },
  }
  await validateDocument(checkpoint, 'Checkpoint')
  await writeJsonAtomic(join(runtime.checkpoints, `${id}.json`), checkpoint)
  return checkpoint
}

export async function applyEffect(root, id, current, effect) {
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  const path = join(runtime.checkpoints, `${id}.json`)
  const checkpoint = await readJson(path)
  await validateDocument(checkpoint, 'Checkpoint')
  if (checkpoint.spec.status !== 'prepared') throw new HairnessError('checkpoint_consumed', `Checkpoint ${id} is ${checkpoint.spec.status}.`)

  const expected = checkpoint.spec
  const actual = {
    inputsDigest: digest(current.inputs ?? {}),
    evidenceDigest: digest(current.evidence ?? {}),
    policyDigest: digest(current.policy ?? {}),
  }
  if (actual.inputsDigest !== expected.inputsDigest || actual.evidenceDigest !== expected.evidenceDigest || actual.policyDigest !== expected.policyDigest) {
    throw new HairnessError('checkpoint_stale', `Checkpoint ${id} no longer matches inputs, evidence or policy.`, { exitCode: 5 })
  }
  if (JSON.stringify(current.target) !== JSON.stringify(expected.target)) {
    throw new HairnessError('checkpoint_stale', `Checkpoint ${id} no longer matches the exact target.`, { exitCode: 5 })
  }

  let outcome = 'succeeded'
  let result
  let caught
  try {
    result = await effect()
  } catch (error) {
    outcome = 'unknown'
    caught = error
  }

  checkpoint.spec.status = 'consumed'
  await writeJsonAtomic(path, checkpoint)
  const receipt = {
    apiVersion: API.receipt,
    kind: 'Receipt',
    metadata: { id: receiptId(), createdAt: now() },
    spec: {
      checkpoint: id,
      operation: expected.operation,
      target: expected.target,
      outcome,
      result: caught ? { message: caught.message } : (result ?? null),
    },
  }
  await validateDocument(receipt, 'Receipt')
  await writeJsonAtomic(join(runtime.root, 'receipts', `${receipt.metadata.id}.json`), receipt)
  if (caught) throw new HairnessError('effect_unknown', `Effect outcome is unknown: ${caught.message}`, { exitCode: 6, cause: caught, details: { receipt } })
  return receipt
}

