import { createHash, randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

function sessionId(root, host, providerId) {
  return `session-${createHash('sha256').update(`${root}:${host}:${providerId}`).digest('hex').slice(0, 16)}`
}

async function localSession(root, runtime) {
  const pointer = await runtime.overlay.read('current.json', null)
  if (pointer?.id) {
    const existing = await runtime.overlay.read(`sessions/${pointer.id}.json`, null)
    if (existing) return existing
  }
  const now = new Date().toISOString()
  const session = { schemaVersion: 2, protocolVersion: '0.2', id: `session-${randomUUID()}`, workspace: root, providers: [], createdAt: now, updatedAt: now }
  await runtime.contracts.validate('HairnessSession', session)
  await runtime.overlay.write(`sessions/${session.id}.json`, session)
  await runtime.overlay.write('current.json', { id: session.id })
  return session
}

function providerFrom(flags) {
  return { host: flags.host ?? (process.env.CODEX_THREAD_ID ? 'codex' : process.env.CLAUDE_SESSION_ID ? 'claude' : null), providerId: flags['provider-session'] ?? process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_SESSION_ID }
}

async function reconcile(root, flags, runtime) {
  const { host, providerId } = providerFrom(flags)
  if (!host || !providerId) throw new Error('Provide --host and --provider-session, or run inside a supported provider session.')
  if (!['codex', 'claude'].includes(host)) throw new Error(`Unknown host: ${host}`)
  const local = flags.id ? await runtime.overlay.read(`sessions/${flags.id}.json`, null) : await localSession(root, runtime)
  const id = local?.id ?? sessionId(root, host, providerId)
  const now = new Date().toISOString()
  const existing = await runtime.overlay.read(`sessions/${id}.json`, null)
  const providers = existing?.providers ?? []
  const provider = providers.find((item) => item.host === host && item.sessionId === providerId)
  if (provider) provider.lastSeenAt = now
  else providers.push({ host, sessionId: providerId, firstSeenAt: now, lastSeenAt: now })
  const session = { schemaVersion: 2, protocolVersion: '0.2', id, workspace: root, providers, createdAt: existing?.createdAt ?? now, updatedAt: now }
  await runtime.contracts.validate('HairnessSession', session)
  await runtime.overlay.write('current.json', { id })
  return runtime.overlay.write(`sessions/${id}.json`, session)
}

async function current(root, flags, runtime) {
  if (flags.id) return runtime.overlay.read(`sessions/${flags.id}.json`, null)
  const session = await localSession(root, runtime)
  const { host, providerId } = providerFrom(flags)
  if (!host || !providerId) return { ...session, status: 'active', limits: ['provider-session-unbound'], routes: ['hairness session reconcile --host <host> --provider-session <id>'] }
  const bound = session.providers.some((item) => item.host === host && item.sessionId === providerId)
  return { ...session, status: 'active', limits: bound ? [] : ['provider-session-unbound'], routes: bound ? [] : ['hairness session reconcile'] }
}

async function digest(root, flags, runtime) {
  const session = await current(root, flags, runtime)
  const preferences = await runtime.distribution.preferences()
  let input = null
  if (flags.inbox) {
    if (!preferences.session?.transcript) throw new Error('Transcript input is disabled by local preference.')
    const inboxRoot = resolve(root, '.overlay', 'extensions-state', 'hairness', 'session-intelligence', 'inbox')
    const inbox = resolve(flags.inbox)
    if (relative(inboxRoot, inbox).startsWith('..')) throw new Error('Transcript inbox must be inside the extension inbox.')
    input = await readFile(inbox, 'utf8')
  }
  const value = flags.file ? JSON.parse(await readFile(flags.file, 'utf8')) : { summary: flags.summary ?? 'Session handoff recorded.', decisions: flags.decision ? [flags.decision] : [], proof: [], limits: input ? ['Digest summary was provided by the caller; transcript content was not persisted.'] : [], routes: [] }
  const document = { schemaVersion: 2, protocolVersion: '0.2', sessionId: session.id, summary: value.summary, decisions: value.decisions ?? [], proof: value.proof ?? [], limits: value.limits ?? [], routes: value.routes ?? [] }
  await runtime.contracts.validate('SessionDigest', document)
  const revision = `digest-${Date.now().toString(36)}`
  const artifact = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    id: `handoff/${session.id}`,
    type: 'session-handoff',
    owner: 'hairness/session-intelligence',
    metadata: { labels: ['handoff'], signals: ['session-resume'], relations: [{ type: 'session-handoff-for', target: { kind: 'session', id: session.id } }], freshness: { policy: 'manual' }, provenance: { kind: 'extension', id: 'hairness/session-intelligence', version: '0.2.0-alpha.0' } },
    revision,
    runId: revision,
    summary: document.summary,
    payload: { sessionId: document.sessionId, summary: document.summary, decisions: document.decisions, proof: document.proof, limits: document.limits, routes: document.routes },
    createdAt: new Date().toISOString(),
  }
  await runtime.artifacts.stage(revision, artifact)
  await runtime.artifacts.promote(revision)
  await runtime.overlay.write(`digests/${session.id}.json`, document)
  if (flags.inbox) await rm(resolve(flags.inbox), { force: true })
  return { summary: 'Session handoff promoted; no transcript was stored.', status: 'digested', digest: document, artifact: { id: artifact.id, revision }, limits: document.limits, routes: document.routes }
}

export async function attentionSignals({ runtime }) {
  const digests = await runtime.overlay.list('digests')
  return digests.length ? [] : [{ state: 'active', priority: 35, summary: 'No durable session handoff exists yet.', route: 'hairness session digest' }]
}

export async function sessionContributions({ root, runtime, manifest, input }) {
  const session = await current(root, { host: input.host }, runtime)
  return [{ owner: manifest.id, section: 'session', priority: 60, summary: `${session.id}${session.limits?.length ? ' · provider unbound' : ''}`, data: { id: session.id, providerBound: !(session.limits ?? []).includes('provider-session-unbound') }, routes: session.routes ?? [], limits: session.limits ?? [], freshness: session.updatedAt, byteSize: 0 }]
}

export async function handleCommand({ root, target, flags, runtime }) {
  const mode = target ?? 'status'
  if (mode === 'status' || mode === 'open') return current(root, flags, runtime)
  if (mode === 'reconcile') return reconcile(root, flags, runtime)
  if (mode === 'digest') return digest(root, flags, runtime)
  throw new Error(`Unknown session action: ${mode}`)
}
