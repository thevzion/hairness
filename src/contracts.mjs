import Ajv2020 from 'ajv/dist/2020.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HairnessError } from './lib/errors.mjs'

export const API = Object.freeze({
  home: 'https://hairness.dev/schema/home.json',
  asset: 'https://hairness.dev/schema/asset.json',
  prologue: 'hairness.dev/prologue/v1alpha1',
})

const schemaFiles = ['home.schema.json', 'asset.schema.json', 'prologue.schema.json']
let validatorsPromise

async function validators() {
  validatorsPromise ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
    const values = new Map()
    for (const file of schemaFiles) {
      const path = fileURLToPath(new URL(`../schemas/v4/${file}`, import.meta.url))
      const schema = JSON.parse(await readFile(path, 'utf8'))
      values.set(file.replace('.schema.json', ''), ajv.compile(schema))
    }
    return values
  })()
  return validatorsPromise
}

export async function validateDocument(document, type) {
  const validate = (await validators()).get(type)
  if (!validate) throw new HairnessError('document_unsupported', `Unsupported document type ${type}.`)
  if (!validate(document)) {
    const message = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    throw new HairnessError('document_invalid', `Invalid ${type}: ${message}.`, { details: { errors: validate.errors } })
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
    if (!(key in limits) || typeof entry !== 'string' || entry.length > limits[key]) throw new HairnessError('config_invalid', `Invalid preference ${key}.`)
  }
  const integrationBindings = value.integrationBindings ?? {}
  if (!integrationBindings || typeof integrationBindings !== 'object' || Array.isArray(integrationBindings)) {
    throw new HairnessError('config_invalid', 'integrationBindings must be an object.')
  }
  return { version: 1, preferences, integrationBindings }
}
