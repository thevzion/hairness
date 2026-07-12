import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { command as testCommand } from './testing/runner.mjs'
import { command as evalCommand } from './testing/evals.mjs'

const exec = promisify(execFile)
async function git(root, args) {
  try { return (await exec('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15_000 })).stdout.trim() } catch { return '' }
}

async function decisionChecks(root) {
  const index = await readFile(join(root, 'docs/README.md'), 'utf8')
  const checks = []
  for (const name of (await readdir(join(root, 'docs/decisions'))).filter((value) => value.endsWith('.md')).sort()) {
    const document = await readFile(join(root, 'docs/decisions', name), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(document)?.[1] ?? ''
    const required = ['id:', 'status:', 'owners:', 'signals:', 'paths:']
    checks.push({ name: `decision:${name}`, ok: required.every((field) => frontmatter.split('\n').some((line) => line.startsWith(field))) && index.includes(`decisions/${name}`) })
  }
  return checks
}

function statusItems(body) {
  const items = []
  let current = null
  for (const line of body.split('\n')) {
    const start = /^- `([a-z0-9][a-z0-9-]*)`\s*$/.exec(line)
    if (start) { current = { id: start[1] }; items.push(current); continue }
    const field = /^\s{2}- (Outcome|State|Gate|Evidence):\s*(.+)$/.exec(line)
    if (field && current) current[field[1].toLowerCase()] = field[2]
  }
  return items
}

function statusSections(document) {
  const values = {}
  for (const match of document.matchAll(/^## (Now|Next|Blocked|Release gates|References)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) values[match[1]] = match[2].trim()
  return values
}

export async function projectStatus({ root, runtime }) {
  const document = await readFile(join(root, 'STATUS.md'), 'utf8')
  const sections = statusSections(document)
  const now = statusItems(sections.Now ?? '')
  const next = statusItems(sections.Next ?? '')
  const blocked = statusItems(sections.Blocked ?? '')
  const required = [...now, ...next, ...blocked]
  const work = await runtime.extensions.call('hairness/work-controls', 'state').catch(() => null)
  const activeSegment = work?.segments?.find((segment) => segment.id === work.activeSegmentId) ?? null
  const checks = [
    { name: 'now-limit', ok: now.length <= 1 },
    { name: 'next-limit', ok: next.length <= 3 },
    { name: 'unique-ids', ok: new Set(required.map((item) => item.id)).size === required.length },
    { name: 'required-fields', ok: required.every((item) => ['outcome', 'state', 'gate', 'evidence'].every((field) => item[field])) },
    { name: 'work-alignment', ok: !now.length || activeSegment?.id === now[0].id },
    { name: 'release-gates', ok: /^- /m.test(sections['Release gates'] ?? '') },
    { name: 'references', ok: /^- /m.test(sections.References ?? '') },
  ]
  return { schemaVersion: 2, protocolVersion: '0.2', status: checks.every((check) => check.ok) ? 'ready' : 'blocked', now, next, blocked, activeSegmentId: activeSegment?.id ?? null, checks, limits: checks.filter((check) => !check.ok).map((check) => check.name), routes: checks.every((check) => check.ok) ? [] : ['align STATUS.md with the active work segment'] }
}

export async function changeImpact({ root, runtime, files }) {
  let source = files ?? (await git(root, ['diff', '--name-only', 'HEAD'])).split('\n').filter(Boolean)
  if (!files && source.length === 0) source = (await git(root, ['diff', '--name-only', 'HEAD^', 'HEAD'])).split('\n').filter(Boolean)
  const dimensions = new Set()
  if (source.some((path) => path.startsWith('src/') || path.startsWith('schemas/'))) dimensions.add('protocol')
  if (source.some((path) => path.startsWith('extensions/') || path.startsWith('providers/') || path.startsWith('src/providers/'))) dimensions.add('provider')
  if (source.some((path) => ['package.json', 'package-lock.json', 'scripts/check-pack.mjs'].includes(path))) dimensions.add('packaging')
  if (source.some((path) => path.startsWith('docs/') || ['README.md', 'SPEC.md', 'ROADMAP.md', 'STATUS.md'].includes(path))) dimensions.add('docs')
  if (source.some((path) => path.startsWith('tests/') || path.includes('/tests/'))) dimensions.add('tests')
  const routes = []
  let decision = 'clear'
  if (dimensions.has('protocol') && !dimensions.has('docs')) { decision = 'must-update'; routes.push('Update SPEC.md or the owning protocol document.') }
  else if (dimensions.has('provider') && !dimensions.has('tests')) { decision = 'review-required'; routes.push('Add provider parity proof or justify with Impact-Review footer.') }
  else if (source.length > 200) { decision = 'needs-split'; routes.push('Split the change into bounded owner commits.') }
  else if (source.length > 80) { decision = 'review-required'; routes.push('Justify why the owner-coherent change remains atomic with an Impact-Review footer.') }
  return runtime.contracts.validate('ChangeImpactReport', { schemaVersion: 2, protocolVersion: '0.2', decision, dimensions: [...dimensions], summary: source.length ? `${source.length} changed path(s) affect ${dimensions.size || 0} maintenance dimension(s).` : 'No working-tree impact detected.', routes })
}

export async function attentionSignals(context) {
  const impact = await changeImpact(context)
  const status = await projectStatus(context).catch(() => null)
  const signals = status?.now[0] ? [{ state: status.status === 'ready' ? 'active' : 'blocked', priority: status.status === 'ready' ? 55 : 75, summary: `${status.now[0].id}: ${status.now[0].gate}`, route: 'hairness maintain status' }] : []
  if (impact.decision !== 'clear') signals.push({ state: impact.decision === 'must-update' ? 'blocked' : 'active', priority: 60, summary: impact.summary, route: 'hairness maintain impact' })
  return signals
}

export async function handleCommand({ root, target, action, rest, flags, runtime }) {
  const mode = target ?? 'check'
  if (mode === 'test') return testCommand({ repositoryRoot: root, runtime, action, rest, flags })
  if (mode === 'eval') return evalCommand({ root, runtime, action, rest, flags })
  if (mode === 'impact') return changeImpact({ root, runtime, files: flags.files?.split(',').filter(Boolean) })
  if (mode === 'status') return projectStatus({ root, runtime })
  if (mode === 'metrics') {
    const runs = await runtime.runs.list()
    const invocations = await runtime.invocations.list()
    const streams = await Promise.all(invocations.map((item) => runtime.invocations.events(item.id)))
    const latencies = streams.map((events) => {
      const start = events.find((event) => event.type === 'requested')
      const preview = events.find((event) => event.type === 'previewed')
      return start && preview ? Date.parse(preview.at) - Date.parse(start.at) : null
    }).filter((value) => value !== null)
    const build = JSON.parse(await readFile(join(root, 'hairness.build.json'), 'utf8'))
    const instructionOutputs = build.outputs.filter((item) => item.path.endsWith('/SKILL.md'))
    const rejected = streams.filter((events) => events.some((event) => event.type === 'result-rejected')).length
    const acceptedFirstPass = streams.filter((events) => events.some((event) => event.type === 'result-accepted') && !events.some((event) => event.type === 'result-rejected')).length
    const metrics = {
      invocations: invocations.length,
      gaps: invocations.filter((item) => item.preview.gaps.length).length,
      resolverReuses: invocations.reduce((total, item) => total + item.preview.resolved.resolverOwners.length, 0),
      resolutionLatencyMs: { samples: latencies.length, average: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : null },
      providerInstructions: { count: instructionOutputs.length, totalBytes: instructionOutputs.reduce((total, item) => total + item.byteSize, 0), maxBytes: Math.max(0, ...instructionOutputs.map((item) => item.byteSize)) },
      resultGate: { acceptedFirstPass, corrected: rejected },
    }
    return { summary: `${invocations.length} invocation(s), ${runs.length} run(s).`, metrics, runs, limits: ['Provider tool calls and model latency are recorded only by explicit eval attempts.'], routes: ['hairness maintain eval list'] }
  }
  if (mode === 'check') {
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const distribution = await runtime.distribution.read()
    const extensions = await runtime.extensions.list()
    const status = await projectStatus({ root, runtime })
    const checks = [{ name: 'protocol-version', ok: packageJson.version === '0.2.0-alpha.0' }, { name: distribution.role === 'forge' ? 'package-public' : 'package-private', ok: distribution.role === 'forge' ? packageJson.private === false : packageJson.private === true }, { name: 'package-license', ok: typeof packageJson.license === 'string' && packageJson.license.length > 0 }, { name: 'project-status', ok: status.status === 'ready', error: status.limits.join(', ') }, ...await decisionChecks(root), ...extensions.map((extension) => ({ name: extension.id, ok: extension.valid || extension.ignored, error: extension.ignored ? undefined : extension.error }))]
    return { summary: checks.every((item) => item.ok) ? 'Maintenance gates are ready.' : 'Maintenance gates found blocking checks.', status: checks.every((item) => item.ok) ? 'ready' : 'blocked', checks, limits: checks.filter((item) => !item.ok).map((item) => item.error ?? item.name), routes: checks.every((item) => item.ok) ? [] : ['npm run check'] }
  }
  if (mode === 'changelog-preview') {
    const lines = (await git(root, ['log', '--format=%s', '--no-merges'])).split('\n').filter(Boolean)
    const groups = { feat: [], fix: [], docs: [], other: [] }
    for (const line of lines) groups[/^(feat|fix|docs)(?:\([^)]+\))?!?:/.exec(line)?.[1] ?? 'other'].push(line)
    return { summary: 'Changelog preview derived from Conventional Commits.', groups, limits: ['No CHANGELOG.md file was mutated.'], routes: [] }
  }
  throw new Error(`Unknown maintain action: ${mode}`)
}
