import Ajv2020 from 'ajv/dist/2020.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HairnessError } from '../lib/errors.mjs'

export const API = Object.freeze({
  home: 'hairness.dev/home/v1alpha2',
  homeLock: 'hairness.dev/home-lock/v1alpha2',
  extension: 'hairness.dev/extension/v1alpha2',
  prologue: 'hairness.dev/prologue/v1alpha1',
})

const files = ['home.schema.json', 'home-lock.schema.json', 'extension.schema.json', 'prologue.schema.json']
let validatorsPromise

async function validators() {
  validatorsPromise ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    const values = new Map()
    for (const file of files) {
      const path = fileURLToPath(new URL(`../../schemas/v4/${file}`, import.meta.url))
      const schema = JSON.parse(await readFile(path, 'utf8'))
      const validate = ajv.compile(schema)
      values.set(`${schema.properties.apiVersion.const}:${schema.properties.kind.const}`, validate)
    }
    return values
  })()
  return validatorsPromise
}

export async function validateDocument(document, kind) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new HairnessError('document_invalid', 'Document must be an object.')
  }
  if (kind && document.kind !== kind) {
    throw new HairnessError('kind_mismatch', `Expected ${kind}, received ${document.kind ?? 'none'}.`)
  }
  const validate = (await validators()).get(`${document.apiVersion}:${document.kind}`)
  if (!validate) throw new HairnessError('document_unsupported', `Unsupported document ${document.apiVersion ?? 'none'}:${document.kind ?? 'none'}.`)
  if (!validate(document)) {
    const message = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    throw new HairnessError('document_invalid', `Invalid ${document.kind}: ${message}.`, { details: { errors: validate.errors } })
  }
  return document
}

export async function compileSchemas() {
  return [...(await validators()).keys()]
}

export function validateLocalConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw new HairnessError('config_invalid', '.overlay/config.json must be an object with version 1.')
  }
  const allowed = new Set(['version', 'preferences', 'integrationBindings'])
  const extra = Object.keys(value).filter((key) => !allowed.has(key))
  if (extra.length) throw new HairnessError('config_invalid', `Unknown local config fields: ${extra.join(', ')}.`)
  const preferences = value.preferences ?? {}
  const limits = { name: 120, addressAs: 120, responseLanguage: 32, note: 500 }
  for (const [key, entry] of Object.entries(preferences)) {
    if (!(key in limits) || typeof entry !== 'string' || entry.length > limits[key]) {
      throw new HairnessError('config_invalid', `Invalid preference ${key}.`)
    }
  }
  const bindings = value.integrationBindings ?? {}
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new HairnessError('config_invalid', 'integrationBindings must be an object.')
  }
  return {
    version: 1,
    preferences,
    integrationBindings: bindings,
  }
}
