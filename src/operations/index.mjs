import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { API, validateDocument } from '../contracts/index.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, now, readJson, writeJsonAtomic, writeJsonExclusive } from '../lib/io.mjs'
import { maybeBoundarySnapshot, overlayPaths } from '../overlay/index.mjs'
import { ensureRuntime } from '../runtime/index.mjs'

const effectOutcomes = new Set(['succeeded', 'partial', 'unknown', 'failed'])

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
    if (result?.__hairnessEffectOutcome === true) {
      if (!effectOutcomes.has(result.outcome)) throw new HairnessError('effect_outcome_invalid', `Unsupported effect outcome: ${result.outcome}.`)
      outcome = result.outcome
      result = result.result ?? null
    }
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
  await writeJsonExclusive(join(overlayPaths(root).receipts, `${receipt.metadata.id}.json`), receipt)
  await maybeBoundarySnapshot(root, `effect: ${expected.operation} ${outcome}`).catch(() => null)
  if (caught) throw new HairnessError('effect_unknown', `Effect outcome is unknown: ${caught.message}`, { exitCode: 6, cause: caught, details: { receipt } })
  if (outcome !== 'succeeded') throw new HairnessError(`effect_${outcome}`, `Effect reported a ${outcome} outcome. Reconcile its Receipt before any retry.`, { exitCode: 6, details: { receipt } })
  return receipt
}

export function effectOutcome(outcome, result) {
  if (!effectOutcomes.has(outcome)) throw new HairnessError('effect_outcome_invalid', `Unsupported effect outcome: ${outcome}.`)
  return Object.freeze({ __hairnessEffectOutcome: true, outcome, result })
}
