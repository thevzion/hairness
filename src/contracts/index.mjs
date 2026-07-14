import Ajv2020 from 'ajv/dist/2020.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HairnessError } from '../lib/errors.mjs'

export const API = Object.freeze({
  home: 'hairness.dev/home/v1alpha1',
  distribution: 'hairness.dev/distribution/v1alpha1',
  extension: 'hairness.dev/extension/v1alpha1',
  scratch: 'hairness.dev/scratch/v1alpha1',
  artifact: 'hairness.dev/artifact/v1alpha1',
  checkpoint: 'hairness.dev/checkpoint/v1alpha1',
  receipt: 'hairness.dev/receipt/v1alpha1',
})

const schemaFiles = [
  'home.schema.json',
  'home-lock.schema.json',
  'session-opening.schema.json',
  'distribution.schema.json',
  'extension.schema.json',
  'scratch.schema.json',
  'artifact.schema.json',
  'checkpoint.schema.json',
  'receipt.schema.json',
]

let registryPromise

async function registry() {
  registryPromise ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    ajv.addFormat('date-time', {
      type: 'string',
      validate: (value) => !Number.isNaN(Date.parse(value)) && /T/.test(value),
    })
    const validators = new Map()
    for (const file of schemaFiles) {
      const path = fileURLToPath(new URL(`../../schemas/v3/${file}`, import.meta.url))
      const schema = JSON.parse(await readFile(path, 'utf8'))
      const validate = ajv.compile(schema)
      validators.set(`${schema.properties.apiVersion.const}:${schema.properties.kind.const}`, validate)
    }
    return validators
  })()
  return registryPromise
}

export async function validateDocument(document, expectedKind) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new HairnessError('document_invalid', 'Document must be an object.')
  }
  if (expectedKind && document.kind !== expectedKind) {
    throw new HairnessError('kind_mismatch', `Expected ${expectedKind}, received ${document.kind ?? 'none'}.`)
  }
  const validate = (await registry()).get(`${document.apiVersion}:${document.kind}`)
  if (!validate) throw new HairnessError('document_unsupported', `Unsupported document ${document.apiVersion ?? 'none'}:${document.kind ?? 'none'}.`)
  if (!validate(document)) {
    throw new HairnessError('document_invalid', `Invalid ${document.kind}: ${ajvMessage(validate.errors)}.`, {
      details: { errors: validate.errors },
    })
  }
  return document
}

function ajvMessage(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
}

export async function compileSchemas() {
  return [...(await registry()).keys()]
}
