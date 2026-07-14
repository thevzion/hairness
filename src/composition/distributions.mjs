import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateDocument } from '../contracts/index.mjs'
import { HairnessError } from '../lib/errors.mjs'

const presets = new Set(['minimal', 'standard'])

export async function loadDistribution(source = 'standard') {
  let path
  if (presets.has(source)) path = fileURLToPath(new URL(`../../distributions/${source}/hairness.distribution.json`, import.meta.url))
  else path = new URL(source, 'file:').pathname
  let document
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new HairnessError('distribution_not_found', `Distribution not found: ${source}.`)
    throw error
  }
  await validateDocument(document, 'Distribution')
  return { path, document }
}

