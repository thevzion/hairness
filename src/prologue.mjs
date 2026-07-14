#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { findWorkspaceRoot, readJson, userPaths, workspacePaths } from './core/io.mjs'
import { writeJsonAtomic } from './core/io.mjs'
import { aggregateSessionOpening } from './core/session-opening.mjs'
import { collectContributions, isWorkspaceTrusted } from './distribution/registry.mjs'
import { resolvePreferences } from './distribution/preferences.mjs'

export async function buildSessionOpening(root, host = 'unknown') {
  const started = performance.now()
  const [manifest, config, trust, preferences] = await Promise.all([
    readJson(`${root}/hairness.json`),
    readJson(workspacePaths(root).config, null),
    readJson(userPaths().trust, { workspaces: {} }),
    resolvePreferences(root),
  ])
  const trusted = Boolean(trust.workspaces?.[root]?.trusted) || await isWorkspaceTrusted(root)
  const profile = {
    name: config?.profile?.name ?? null,
    language: preferences.interaction?.language ?? config?.profile?.language ?? manifest.defaults?.interaction?.language ?? 'en',
    timezone: preferences.interaction?.timezone ?? config?.profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  const contributions = trusted ? await collectContributions(root, 'session-opening', { host }).catch(() => []) : []
  const limits = [!config && 'onboarding-incomplete', !trusted && 'workspace-untrusted'].filter(Boolean)
  const opening = await aggregateSessionOpening({
    host,
    profile,
    trusted,
    distribution: { name: manifest.name, displayName: manifest.displayName, role: manifest.role, implementationVersion: manifest.implementationVersion, protocolVersion: manifest.protocolVersion },
    contributions,
    limits,
  })
  if (performance.now() - started > 500) opening.limits.push('opening-budget-exceeded')
  return opening
}

export async function buildPrologue(root, host = 'unknown') {
  const opening = await buildSessionOpening(root, host)
  const renderers = opening.trusted ? await collectContributions(root, 'session-renderer', { opening, host }).catch(() => []) : []
  const output = renderers.length === 1 ? renderers[0].value : `${opening.instruction}\nArtifacts orient. Live sources prove. Checkpoints grant operation-scoped authority.\n${JSON.stringify(opening)}\n`
  if (Buffer.byteLength(output) > 4096) throw new Error('Hairness prologue exceeds 4 KiB.')
  return output
}

async function writeSessionStartReceipt(root, host) {
  if (!['codex', 'claude'].includes(host)) return
  const build = await readJson(join(root, 'hairness.build.json'), null)
  const entry = build?.entries?.find((item) => item.id === 'session-opening' && item.target.includes(host === 'codex' ? '.codex' : '.claude'))
  await writeJsonAtomic(join(workspacePaths(root).overlay, 'provider-local', host, 'session-start.json'), {
    schemaVersion: 2,
    protocolVersion: '0.2',
    provider: host,
    sourceDigest: build?.sourceDigest ?? null,
    hookDigest: entry?.digest ?? `sha256:${createHash('sha256').update('unprojected').digest('hex')}`,
    source: process.env.HAIRNESS_SESSION_SOURCE ?? 'SessionStart',
    observedAt: new Date().toISOString(),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hostIndex = process.argv.indexOf('--host')
  const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : 'unknown'
  const root = await findWorkspaceRoot()
  process.stdout.write(await buildPrologue(root, host))
  await writeSessionStartReceipt(root, host)
}
