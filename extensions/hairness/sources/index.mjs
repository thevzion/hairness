import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const extensionRoot = dirname(fileURLToPath(import.meta.url))

function safePath(root, path) {
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new Error(`${path} escapes the sources extension.`)
  return target
}

async function availableDrivers(manifest, runtime) {
  const values = []
  for (const source of manifest.sourceDrivers ?? []) {
    const path = safePath(extensionRoot, source)
    const value = JSON.parse(await readFile(path, 'utf8'))
    await runtime.contracts.validate('SourceDriver', value)
    const root = dirname(path)
    const modulePath = safePath(root, value.module)
    values.push({ ...value, root, modulePath })
  }
  return values
}

async function selectedDrivers(manifest, runtime) {
  const distribution = await runtime.distribution.read()
  const available = await availableDrivers(manifest, runtime)
  return distribution.sources.map((selected) => ({ ...selected, driver: available.find((driver) => driver.id === selected.id) ?? null }))
}

async function loadDriver(driver) {
  const module = await import(`${pathToFileURL(driver.modulePath).href}?driver=${Date.now()}`)
  return module.operations ?? {}
}

async function list({ manifest, runtime }) {
  return (await selectedDrivers(manifest, runtime)).map(({ id, requirement, driver }) => driver
    ? { id: driver.id, requirement, transport: driver.transport, operations: driver.operations }
    : { id, requirement, missing: true })
}

function sanitizeIdentity(value) {
  const forbidden = /token|secret|password|credential|cookie|private.?key/i
  function clean(input) {
    if (Array.isArray(input)) return input.slice(0, 32).map(clean)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input).filter(([key]) => !forbidden.test(key)).slice(0, 64).map(([key, child]) => [key, clean(child)]))
  }
  const output = clean(value)
  return Buffer.byteLength(JSON.stringify(output)) > 4096 ? { summary: 'Identity evidence exceeded the local storage budget.', truncated: true } : output
}

async function doctor({ manifest, runtime, source }) {
  const selected = await selectedDrivers(manifest, runtime)
  const filtered = source ? selected.filter((item) => item.driver?.id === source || (!item.driver && item.id === source)) : selected
  const checks = await Promise.all(filtered.map(async ({ id, requirement, driver }) => {
    let executable = false
    if (driver) {
      try { await exec(driver.executable, ['--version'], { encoding: 'utf8', timeout: 10_000 }); executable = true }
      catch { try { await exec(driver.executable, ['version'], { encoding: 'utf8', timeout: 10_000 }); executable = true } catch {} }
    }
    return { name: driver?.id ?? id, requirement, declared: Boolean(driver), executable, ok: Boolean(driver) && executable }
  }))
  const blocked = checks.some((check) => check.requirement === 'required' && !check.ok)
  return { schemaVersion: 2, protocolVersion: '0.2', subject: source ? `source:${source}` : 'sources', status: blocked ? 'blocked' : checks.every((check) => check.ok) ? 'ready' : 'partial', checks, limits: checks.filter((check) => !check.ok).map((check) => `${check.name} is ${check.requirement} but unavailable`), routes: blocked ? ['hairness onboarding next'] : [] }
}

async function read({ root, manifest, runtime, source, operation, input = {} }) {
  const selected = await selectedDrivers(manifest, runtime)
  const driver = selected.find((item) => item.driver?.id === source)?.driver
  if (!driver) throw new Error(`Unknown or unselected source: ${source}`)
  const declared = driver.operations.find((item) => item.id === operation)
  if (!declared) throw new Error(`${source} does not declare ${operation}.`)
  if (declared.access !== 'read') throw new Error('Source drivers cannot execute effects.')
  const operations = await loadDriver(driver)
  if (typeof operations[operation] !== 'function') throw new Error(`${source}.${operation} has no driver implementation.`)
  let data
  try { data = await operations[operation]({ root, input }) }
  catch (error) { throw new Error(`${source}.${operation} could not produce evidence: ${error.message}`) }
  return runtime.contracts.validate('SourceEvidence', { schemaVersion: 2, protocolVersion: '0.2', source, operation, transport: driver.transport, observedAt: new Date().toISOString(), summary: `${source}.${operation} produced live evidence.`, data, proof: [`cli:${driver.transport}`], limits: [] })
}

export const services = {
  list: ({ manifest, runtime }) => list({ manifest, runtime }),
  doctor: ({ input, manifest, runtime }) => doctor({ manifest, runtime, source: input.source }),
  read: ({ root, input, manifest, runtime }) => read({ root, manifest, runtime, ...input }),
}

export async function onboardingContributions({ phase, input, manifest, runtime, root }) {
  const distribution = await runtime.distribution.read()
  if (phase === 'questions') return {
    questions: distribution.sources.flatMap((source) => [
      { id: `source.${source.id}`, question: `Enable the ${source.id} source (${source.requirement})?`, source: source.id, requirement: source.requirement, options: [{ value: 'enable', label: 'Enable' }, { value: 'later', label: 'Configure later' }] },
      { id: `identity.${source.id}`, question: `Record the current non-secret ${source.id} identity locally?`, source: source.id, options: [{ value: 'detect', label: 'Detect after checkpoint' }, { value: 'later', label: 'Do not record it' }] },
    ])
  }
  const enabled = Object.fromEntries(distribution.sources.map((source) => [source.id, { enabled: input.answers[`source.${source.id}`] === 'enable', requirement: source.requirement }]))
  if (phase === 'plan') return {
    actions: distribution.sources.filter((source) => input.answers[`identity.${source.id}`] === 'detect').map((source) => ({ type: 'read-source-identity', target: source.id })),
    data: { enabled },
  }
  if (phase !== 'apply') return {}
  const identities = {}
  const limits = []
  for (const source of distribution.sources) if (input.answers[`identity.${source.id}`] === 'detect') {
    try { identities[source.id] = sanitizeIdentity((await read({ root, manifest, runtime, source: source.id, operation: 'identity', input: {} })).data) }
    catch (error) { limits.push(`${source.id}-identity-unavailable: ${error.message}`) }
  }
  return { config: { sources: enabled, identities }, limits }
}

export async function handleCommand({ target, action, rest, flags, manifest, runtime, root }) {
  const mode = target ?? 'list'
  if (mode === 'list') return { sources: await list({ manifest, runtime }) }
  if (mode === 'doctor') return doctor({ manifest, runtime, source: action })
  if (mode === 'read') {
    if (!action || !rest[0]) throw new Error('Usage: hairness source read <source> <operation> [--input JSON]')
    return read({ root, manifest, runtime, source: action, operation: rest[0], input: flags.input ? JSON.parse(flags.input) : {} })
  }
  throw new Error(`Unknown source action: ${mode}`)
}

export async function sessionContributions({ root, manifest, runtime }) {
  const selected = await selectedDrivers(manifest, runtime)
  const git = selected.find((item) => item.driver?.id === 'git')?.driver
  if (!git?.sessionOperation) return [{ owner: manifest.id, section: 'sources', priority: 50, summary: `${selected.filter((item) => item.driver).length} source driver(s) selected.`, data: { selected: selected.map((item) => item.driver?.id ?? item.id) }, routes: [], limits: [], freshness: new Date().toISOString(), byteSize: 0 }]
  const evidence = await read({ root, manifest, runtime, source: git.id, operation: git.sessionOperation, input: {} }).catch(() => null)
  const value = evidence?.data
  return [{ owner: manifest.id, section: 'sources', priority: 70, summary: value ? `${value.branch}${value.dirty ? ` · ${value.dirty} dirty` : ''}${value.ahead ? ` · ${value.ahead} ahead` : ''}` : 'Selected source status unavailable.', data: value ? { source: 'git', branch: value.branch, upstream: value.upstream, ahead: value.ahead, behind: value.behind, dirty: value.dirty } : {}, routes: [], limits: value ? [] : ['source-status-unavailable'], freshness: evidence?.observedAt ?? new Date().toISOString(), byteSize: 0 }]
}
