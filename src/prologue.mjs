import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { API, validateDocument } from './contracts.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { listIntegrations } from './integrations.mjs'
import { resolvePackageFile } from './lib/io.mjs'
import { activeExtensions } from './packages.mjs'
import { listTargets } from './targets.mjs'

export async function prologueModel(root) {
  const [home, local, targets, integrations] = await Promise.all([
    loadHome(root),
    loadLocalConfig(root),
    listTargets(root),
    listIntegrations(root),
  ])
  const extensions = await activeExtensions(root, home)
  const facts = [{ id: 'home.id', value: home.metadata.id }]
  const signals = []
  for (const target of targets) {
    facts.push({ id: `target.${target.id}.repository`, value: target.repository })
    facts.push({ id: `target.${target.id}.binding`, value: target.binding })
    if (!target.binding) signals.push({ id: `target.${target.id}.unbound`, level: 'warning', message: 'Target is declared but not bound on this machine.' })
    else if (!target.matches) signals.push({ id: `target.${target.id}.mismatch`, level: 'error', message: 'Bound repository does not match the declared remote.' })
  }
  for (const integration of integrations) {
    for (const provider of home.spec.providers) {
      const binding = integration.bindings[provider]
      facts.push({ id: `integration.${integration.id}.${provider}`, value: binding ? describeBinding(binding) : null })
      if (!binding) signals.push({ id: `integration.${integration.id}.${provider}.unbound`, level: 'warning', message: 'Integration accessor is not selected.' })
    }
  }
  for (const extension of extensions) {
    const contribution = extension.manifest.contributes.prologue
    if (!contribution) continue
    try {
      const namespace = extensionNamespace(extension.name)
      const path = await resolvePackageFile(extension.root, contribution.path)
      const value = await readContribution(path, extension.root, contribution.timeoutMs ?? 500, {
        home: { id: home.metadata.id, providers: home.spec.providers },
        config: home.spec.config[extension.name] ?? {},
        targets: targets.map(({ id, repository, binding }) => ({ id, repository, bound: Boolean(binding) })),
        integrations: integrations.map(({ id, bindings }) => ({ id, bindings })),
      })
      for (const fact of value.facts ?? []) facts.push({ id: `${namespace}/${fact.id}`, value: fact.value })
      for (const signal of value.signals ?? []) signals.push({ ...signal, id: `${namespace}/${signal.id}` })
    } catch (error) {
      signals.push({ id: `${extensionNamespace(extension.name)}/prologue`, level: 'warning', message: `Contributor unavailable: ${error.message}` })
    }
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

async function readContribution(path, root, timeout, context) {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${root}`, path], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timed out after ${timeout}ms`))
    }, timeout)
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) child.kill('SIGKILL')
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (size > 256 * 1024) reject(new Error('output exceeds 256 KiB'))
      else if (code !== 0) reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `exited ${code}`))
      else resolvePromise(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(JSON.stringify(context))
  })
  const value = JSON.parse(output)
  validateContribution(value)
  return value
}

function validateContribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('contribution must be an object')
  if (Object.keys(value).some((key) => !['facts', 'signals'].includes(key))) throw new Error('contribution may contain only facts and signals')
  for (const fact of value.facts ?? []) {
    if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(fact.id) || !['string', 'number', 'boolean'].includes(typeof fact.value) && fact.value !== null) throw new Error('invalid fact')
  }
  for (const signal of value.signals ?? []) {
    if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(signal.id) || !['info', 'warning', 'error'].includes(signal.level) || typeof signal.message !== 'string') throw new Error('invalid signal')
  }
}

function rejectSecrets(value) {
  const body = JSON.stringify(value)
  if (/(?:password|secret|access[_-]?token|private[_-]?key)/i.test(body) || /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY/.test(body)) {
    throw new Error('Prologue contains secret-like data.')
  }
}

function describeBinding(binding) {
  if (binding.kind === 'cli') return `cli:${binding.command}`
  if (binding.kind === 'provider') return `provider:${binding.id}`
  return 'none'
}

function extensionNamespace(name) {
  return name.replace(/^@/, '').replaceAll('/', '.')
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
