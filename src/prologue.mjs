import { API, validateDocument } from './contracts.mjs'
import { installedAssets } from './assets.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { listIntegrations } from './integrations.mjs'
import { listTargets } from './targets.mjs'

export async function prologueModel(root) {
  const [home, local, targets, integrations, assets] = await Promise.all([
    loadHome(root),
    loadLocalConfig(root),
    listTargets(root),
    listIntegrations(root),
    installedAssets(root),
  ])
  const facts = [{ id: 'home.name', value: home.name }, { id: 'home.runtime', value: home.runtime }]
  const signals = []
  for (const asset of assets) {
    if (asset.invalid) {
      signals.push({ id: `asset.${namespace(asset.id)}.invalid`, level: 'error', message: 'Asset manifest is invalid.' })
      continue
    }
    facts.push({ id: `asset.${namespace(asset.manifest.name)}.version`, value: asset.manifest.version })
    if (asset.manifest.installation.mobile) signals.push({ id: `asset.${namespace(asset.manifest.name)}.mobile`, level: 'info', message: 'Asset source is mobile; pin a Git tag or commit for reproducible bootstrap.' })
  }
  for (const target of targets) {
    facts.push({ id: `target.${target.id}.repository`, value: target.repository })
    facts.push({ id: `target.${target.id}.binding`, value: target.binding })
    if (target.evidence && !target.evidence.error) {
      facts.push({ id: `target.${target.id}.branch`, value: target.evidence.branch })
      facts.push({ id: `target.${target.id}.clean`, value: target.evidence.clean })
    }
    if (!target.binding) signals.push({ id: `target.${target.id}.unbound`, level: 'warning', message: 'Target is declared but not bound on this machine.' })
    else if (!target.matches) signals.push({ id: `target.${target.id}.mismatch`, level: 'error', message: 'Bound repository does not match the declared remote.' })
  }
  for (const integration of integrations) for (const provider of home.providers) {
    const binding = integration.bindings[provider]
    facts.push({ id: `integration.${integration.id}.${provider}`, value: binding ? describeBinding(binding) : null })
    if (!binding) signals.push({ id: `integration.${integration.id}.${provider}.unbound`, level: 'warning', message: 'Integration accessor is not selected.' })
  }
  const model = { apiVersion: API.prologue, kind: 'Prologue', preferences: local.preferences, facts, signals }
  rejectSecrets(model)
  return validateDocument(model, 'prologue')
}

export function renderPrologue(model) {
  const lines = ['<hairness-prologue version="1">', '  <preferences>']
  for (const [key, value] of Object.entries(model.preferences)) lines.push(`    <preference id="${escapeXml(key)}">${escapeXml(value)}</preference>`)
  lines.push('  </preferences>', '  <facts>')
  for (const fact of model.facts) lines.push(`    <fact id="${escapeXml(fact.id)}" value="${escapeXml(fact.value)}"/>`)
  lines.push('  </facts>', '  <signals>')
  for (const signal of model.signals) lines.push(`    <signal id="${escapeXml(signal.id)}" level="${signal.level}">${escapeXml(signal.message)}</signal>`)
  lines.push('  </signals>', '</hairness-prologue>')
  return lines.join('\n')
}

function rejectSecrets(value) {
  const body = JSON.stringify(value)
  if (/(?:password|secret|access[_-]?token|private[_-]?key)/i.test(body) || /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY/.test(body)) throw new Error('Prologue contains secret-like data.')
}

function describeBinding(binding) {
  if (binding.kind === 'cli') return `cli:${binding.command}`
  if (binding.kind === 'provider') return `provider:${binding.id}`
  return 'none'
}

function namespace(value) { return value.replaceAll('/', '.') }
function escapeXml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') }
