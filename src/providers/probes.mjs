import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validateContract } from '../core/contracts.mjs'
import { assertProvider, providerStatus } from './compiler.mjs'

const exec = promisify(execFile)
async function executable(host) {
  try { return (await exec(host, ['--version'], { encoding: 'utf8', timeout: 10_000 })).stdout.trim() || 'available' } catch { return null }
}

export async function probeHost(root, host) {
  assertProvider(host)
  const cli = await executable(host)
  const projection = await providerStatus(root, host)
  const projected = !['blocked', 'stale'].includes(projection.status)
  const verified = projection.status === 'verified'
  const capabilities = { sessionStart: verified, nativeSubagents: Boolean(cli), customWorkerProfiles: projected, toolRestrictions: projected, structuredResult: projected, resume: Boolean(cli), hooks: verified, uiThreadVisibility: Boolean(cli) }
  const intentPath = !cli ? 'unavailable' : 'agent-first-call'
  const limits = [!cli && `${host} CLI is unavailable`, !projected && `${host} repo-local projection is missing or stale`, projected && !verified && `${host} SessionStart hook execution is not verified`, cli && 'Provider commands use the guarded agent-first-call path; no native deterministic command hook is claimed.'].filter(Boolean)
  return validateContract('HostCapabilities', { schemaVersion: 2, protocolVersion: '0.2', host, level: !cli ? 'unsupported' : 'guarded', intentPath, capabilities, limits })
}

export async function doctorHost(root, host) {
  const probe = await probeHost(root, host)
  return validateContract('DoctorReport', { schemaVersion: 2, protocolVersion: '0.2', subject: `host:${host}`, status: probe.level === 'strict' ? 'ready' : probe.level === 'guarded' ? 'partial' : 'blocked', checks: [{ name: 'intent-path', ok: probe.intentPath !== 'unavailable', value: probe.intentPath }, ...Object.entries(probe.capabilities).map(([name, ok]) => ({ name, ok }))], limits: probe.limits, routes: probe.level === 'unsupported' ? [`hairness build --provider ${host}`] : [] })
}
