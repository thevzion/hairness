import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { HairnessError } from './errors.mjs'
import { validateContract } from './contracts.mjs'

function safePath(root, path, code) {
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new HairnessError(code, `${path} escapes its extension.`, { exitCode: 2 })
  return target
}

export async function loadCapabilities(extensionPath, manifest) {
  const values = []
  for (const source of manifest.capabilities) {
    const path = safePath(extensionPath, source, 'capability_source_escape')
    const value = JSON.parse(await readFile(path, 'utf8'))
    await validateContract('CapabilitySpec', value)
    if (value.owner !== manifest.id) throw new HairnessError('capability_owner_mismatch', `${value.id} declares ${value.owner}, expected ${manifest.id}.`, { exitCode: 2 })
    for (const operation of value.operations) if (operation.inputSchema) safePath(extensionPath, operation.inputSchema, 'operation_schema_escape')
    values.push({ ...value, source })
  }
  return values
}

export function capabilityIndex(extensions) {
  const capabilities = new Map()
  const operations = new Map()
  for (const extension of extensions) for (const capability of extension.capabilities) {
    if (capabilities.has(capability.id)) throw new HairnessError('capability_owner_conflict', `Duplicate capability ${capability.id}.`, { exitCode: 2 })
    capabilities.set(capability.id, capability)
    for (const operation of capability.operations) {
      const key = `${capability.id}#${operation.id}`
      if (operations.has(key)) throw new HairnessError('operation_owner_conflict', `Duplicate operation ${key}.`, { exitCode: 2 })
      operations.set(key, { ...operation, capability: capability.id, owner: capability.owner })
    }
  }
  return { capabilities, operations }
}

export function resolveOperation(index, reference) {
  const operation = index.operations.get(`${reference.capability}#${reference.id}`)
  if (!operation) throw new HairnessError('operation_unknown', `Unknown operation ${reference.capability}#${reference.id}.`, { exitCode: 2 })
  return operation
}

export function validateOperationProfile(operation, profile) {
  const expected = operation.class === 'effect' ? 'executor' : 'producer'
  if (profile !== expected) throw new HairnessError('operation_profile_mismatch', `${operation.capability}#${operation.id} requires ${expected}, not ${profile}.`, { exitCode: 2 })
  return true
}
