import { join } from 'node:path'
import { HairnessError } from '../lib/errors.mjs'
import { readJson, writeJsonAtomic } from '../lib/io.mjs'

export function profilePath(root) {
  return join(root, '.overlay', 'profile.json')
}

export function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Profile must be an object.')
  const unknown = Object.keys(value).filter((key) => !['name', 'language', 'note'].includes(key))
  if (unknown.length) throw invalid(`Unknown profile fields: ${unknown.join(', ')}.`)
  if (typeof value.language !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value.language)) throw invalid('Profile language must be a BCP 47-like language tag.')
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100)) throw invalid('Profile name must contain 1 to 100 characters.')
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 1000)) throw invalid('Profile note must contain at most 1000 characters.')
  for (const field of ['name', 'note']) {
    if (value[field]?.includes('<!-- hairness:')) throw invalid(`Profile ${field} cannot contain a Hairness managed-region marker.`)
    if (value[field] && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value[field])) throw invalid(`Profile ${field} contains control characters.`)
  }
  return { ...(value.name ? { name: value.name.trim() } : {}), language: value.language, ...(value.note ? { note: value.note.trim() } : {}) }
}

export async function loadProfile(root, options = {}) {
  try {
    return validateProfile(await readJson(profilePath(root)))
  } catch (error) {
    if (error.code === 'ENOENT' && options.optional) return null
    if (error.code === 'ENOENT') throw new HairnessError('profile_missing', 'No .overlay/profile.json exists. Run hairness onboarding before building provider assets.', { routes: ['hairness onboarding status'] })
    throw error
  }
}

export async function saveProfile(root, value) {
  const profile = validateProfile(value)
  await writeJsonAtomic(profilePath(root), profile)
  return profile
}

export function renderProfile(profile) {
  const lines = [`- Response language: ${inline(profile.language)}`]
  if (profile.name) lines.unshift(`- Name: ${inline(profile.name)}`)
  if (profile.note) lines.push(`- Note: ${inline(profile.note)}`)
  return lines.join('\n')
}

function inline(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function invalid(message) {
  return new HairnessError('profile_invalid', message)
}
