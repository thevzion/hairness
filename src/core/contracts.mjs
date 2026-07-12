import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { HairnessError } from './errors.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const schemaRoot = join(repositoryRoot, 'schemas')
let validatorPromise

async function buildValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
  for (const name of ['protocol.schema.json', 'distribution.schema.json', 'extension.schema.json']) {
    const schema = JSON.parse(await readFile(join(schemaRoot, name), 'utf8'))
    ajv.addSchema(schema)
  }
  return ajv
}

export async function validator() {
  validatorPromise ??= buildValidator()
  return validatorPromise
}

export async function validateContract(name, value) {
  const ajv = await validator()
  const schemaId = name === 'DistributionManifest'
    ? 'https://hairness.dev/schemas/0.2/distribution.schema.json'
    : name === 'ExtensionManifest'
      ? 'https://hairness.dev/schemas/0.2/extension.schema.json'
      : `https://hairness.dev/schemas/0.2/protocol.schema.json#/$defs/${name}`
  const validate = ajv.getSchema(schemaId)
  if (!validate) throw new HairnessError('unknown_contract', `Unknown contract: ${name}`, { exitCode: 2 })
  if (!validate(value)) {
    throw new HairnessError('contract_invalid', `${name} validation failed.`, {
      exitCode: 2,
      details: validate.errors,
    })
  }
  return value
}

export async function validateSchemaSet() {
  await validator()
  return true
}

export async function validateJsonSchema(path, value, label = 'payload') {
  const schema = JSON.parse(await readFile(path, 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
  const validate = ajv.compile(schema)
  if (!validate(value)) {
    throw new HairnessError('artifact_payload_invalid', `${label} validation failed.`, {
      exitCode: 2,
      details: validate.errors,
    })
  }
  return value
}
